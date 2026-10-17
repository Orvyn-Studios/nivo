use super::*;
use ::windows::{
    core::{implement, Interface, Ref, BOOL, GUID, PCWSTR, PWSTR},
    Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Foundation::PROPERTYKEY,
        Media::Audio::{Endpoints::*, *},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
            CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        },
    },
};
use std::{ptr, sync::atomic::Ordering};

fn session_token(identifier: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    identifier.hash(&mut hash);
    format!("session:{:016x}", hash.finish())
}

fn application_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };
    // Query only the executable's public image name; never inspect process memory.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;
        let success = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            buffer.as_mut_ptr(),
            &mut length,
        );
        CloseHandle(handle);
        if success == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        path.rsplit('\\')
            .next()
            .map(|name| text(name.trim_end_matches(".exe").to_owned()))
    }
}

fn error(context: &str, error: ::windows::core::Error) -> String {
    format!("{context} (Windows 0x{:08X}).", error.code().0 as u32)
}
fn text(value: String) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(256)
        .collect()
}
unsafe fn owned_string(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let result = unsafe { value.to_string() }.unwrap_or_default();
    unsafe {
        CoTaskMemFree(Some(value.0.cast()));
    }
    result
}
unsafe fn device_id(device: &IMMDevice) -> ::windows::core::Result<String> {
    let value = unsafe { device.GetId()? };
    let result = unsafe { value.to_string() };
    unsafe {
        CoTaskMemFree(Some(value.0.cast()));
    }
    Ok(result?)
}
unsafe fn name(device: &IMMDevice) -> String {
    let read = || -> ::windows::core::Result<String> {
        unsafe {
            let properties = device.OpenPropertyStore(STGM_READ)?;
            let mut value = properties.GetValue(&PKEY_Device_FriendlyName)?;
            let result = PropVariantToStringAlloc(&value).map(|value| text(owned_string(value)));
            let _ = PropVariantClear(&mut value);
            result
        }
    };
    read().unwrap_or_else(|_| "Dispositivo de audio".into())
}

// Callbacks do not touch COM, Tauri or user data. They only coalesce a worker wake.
#[implement(
    IMMNotificationClient,
    IAudioEndpointVolumeCallback,
    IAudioSessionNotification,
    IAudioSessionEvents
)]
struct Notify {
    shared: Arc<Shared>,
}
impl IMMNotificationClient_Impl for Notify_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        _: EDataFlow,
        _: ERole,
        _: &PCWSTR,
    ) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
}
impl IAudioEndpointVolumeCallback_Impl for Notify_Impl {
    fn OnNotify(&self, _: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> ::windows::core::Result<()> {
        self.shared.wake(false);
        Ok(())
    }
}
impl IAudioSessionNotification_Impl for Notify_Impl {
    fn OnSessionCreated(&self, _: Ref<IAudioSessionControl>) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
}
impl IAudioSessionEvents_Impl for Notify_Impl {
    fn OnDisplayNameChanged(&self, _: &PCWSTR, _: *const GUID) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnIconPathChanged(&self, _: &PCWSTR, _: *const GUID) -> ::windows::core::Result<()> {
        Ok(())
    }
    fn OnSimpleVolumeChanged(
        &self,
        _: f32,
        _: BOOL,
        _: *const GUID,
    ) -> ::windows::core::Result<()> {
        self.shared.wake(false);
        Ok(())
    }
    fn OnChannelVolumeChanged(
        &self,
        _: u32,
        _: *const f32,
        _: u32,
        _: *const GUID,
    ) -> ::windows::core::Result<()> {
        self.shared.wake(false);
        Ok(())
    }
    fn OnGroupingParamChanged(
        &self,
        _: *const GUID,
        _: *const GUID,
    ) -> ::windows::core::Result<()> {
        Ok(())
    }
    fn OnStateChanged(&self, _: AudioSessionState) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
    fn OnSessionDisconnected(
        &self,
        _: AudioSessionDisconnectReason,
    ) -> ::windows::core::Result<()> {
        self.shared.wake(true);
        Ok(())
    }
}
struct Endpoint {
    id: String,
    name: String,
    volume: IAudioEndpointVolume,
    notify: IAudioEndpointVolumeCallback,
}
impl Endpoint {
    unsafe fn open(
        device: &IMMDevice,
        notify: &IMMNotificationClient,
    ) -> ::windows::core::Result<Self> {
        unsafe {
            let id = device_id(device)?;
            let name = name(device);
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            let callback = notify.cast()?;
            volume.RegisterControlChangeNotify(&callback)?;
            Ok(Self {
                id,
                name,
                volume,
                notify: callback,
            })
        }
    }
    unsafe fn snapshot(&self) -> ::windows::core::Result<AudioEndpoint> {
        unsafe {
            Ok(AudioEndpoint {
                id: self.id.clone(),
                name: self.name.clone(),
                volume: self.volume.GetMasterVolumeLevelScalar()?,
                muted: self.volume.GetMute()?.as_bool(),
            })
        }
    }
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        unsafe {
            let _ = self.volume.UnregisterControlChangeNotify(&self.notify);
        }
    }
}
struct Session {
    id: String,
    name: String,
    control: IAudioSessionControl,
    volume: ISimpleAudioVolume,
    notify: IAudioSessionEvents,
}
impl Drop for Session {
    fn drop(&mut self) {
        unsafe {
            let _ = self
                .control
                .UnregisterAudioSessionNotification(&self.notify);
        }
    }
}
struct SessionManager {
    manager: IAudioSessionManager2,
    notify: IAudioSessionNotification,
}
impl Drop for SessionManager {
    fn drop(&mut self) {
        unsafe {
            let _ = self.manager.UnregisterSessionNotification(&self.notify);
        }
    }
}
struct Bindings {
    output: Option<Endpoint>,
    input: Option<Endpoint>,
    sessions: Vec<Session>,
    manager: Option<SessionManager>,
    devices: Vec<AudioDevice>,
}
impl Bindings {
    unsafe fn open(
        enumerator: &IMMDeviceEnumerator,
        notify: &IMMNotificationClient,
    ) -> ::windows::core::Result<Self> {
        unsafe {
            let mut result = Self {
                output: None,
                input: None,
                sessions: vec![],
                manager: None,
                devices: vec![],
            };
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for index in 0..devices.GetCount()?.min(16) {
                let device = devices.Item(index)?;
                result.devices.push(AudioDevice {
                    id: device_id(&device)?,
                    name: name(&device),
                });
            }
            if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                result.output = Some(Endpoint::open(&device, notify)?);
                let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
                let callback: IAudioSessionNotification = notify.cast()?;
                manager.RegisterSessionNotification(&callback)?;
                result.manager = Some(SessionManager {
                    manager: manager.clone(),
                    notify: callback,
                });
                let enumeration = manager.GetSessionEnumerator()?;
                // GetCount activates session notifications; register before enumerating.
                for index in 0..enumeration.GetCount()?.min(24) {
                    let control = enumeration.GetSession(index)?;
                    if control.GetState()? == AudioSessionStateExpired {
                        continue;
                    }
                    let extended: IAudioSessionControl2 = control.cast()?;
                    let identifier = owned_string(extended.GetSessionInstanceIdentifier()?);
                    if identifier.is_empty() || identifier.len() > 2048 {
                        continue;
                    }
                    let id = session_token(&identifier);
                    let system_sounds =
                        extended.IsSystemSoundsSession() == ::windows::core::HRESULT(0);
                    let mut display_name = if system_sounds {
                        "Sonidos del sistema".into()
                    } else {
                        text(owned_string(control.GetDisplayName()?))
                    };
                    if display_name.is_empty() {
                        let pid = extended.GetProcessId()?;
                        display_name = application_name(pid)
                            .unwrap_or_else(|| format!("Aplicación · PID {pid}"));
                    }
                    let volume = control.cast()?;
                    let callback = notify.cast()?;
                    control.RegisterAudioSessionNotification(&callback)?;
                    result.sessions.push(Session {
                        id,
                        name: display_name,
                        control,
                        volume,
                        notify: callback,
                    });
                }
            }
            if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) {
                result.input = Endpoint::open(&device, notify).ok();
            }
            Ok(result)
        }
    }
    unsafe fn snapshot(&self) -> ::windows::core::Result<AudioSnapshot> {
        unsafe {
            let mut result = AudioSnapshot::empty("ready");
            result.output = self
                .output
                .as_ref()
                .map(|value| value.snapshot())
                .transpose()?;
            result.input = self
                .input
                .as_ref()
                .map(|value| value.snapshot())
                .transpose()?;
            result.devices = self.devices.clone();
            for session in &self.sessions {
                let state = session.control.GetState()?;
                if state == AudioSessionStateExpired {
                    continue;
                }
                result.sessions.push(AudioSession {
                    id: session.id.clone(),
                    name: session.name.clone(),
                    volume: session.volume.GetMasterVolume()?,
                    muted: session.volume.GetMute()?.as_bool(),
                    active: state == AudioSessionStateActive,
                });
            }
            Ok(result)
        }
    }
    unsafe fn control(&self, action: AudioAction) -> Result<(), String> {
        unsafe {
            let stale =
                || "La sesión o el dispositivo ha cambiado. Actualiza el panel.".to_string();
            let result = match action {
                AudioAction::OutputVolume { id, value } => self
                    .output
                    .as_ref()
                    .filter(|endpoint| endpoint.id == id)
                    .ok_or_else(stale)?
                    .volume
                    .SetMasterVolumeLevelScalar(value, ptr::null()),
                AudioAction::OutputMute { id, muted } => self
                    .output
                    .as_ref()
                    .filter(|endpoint| endpoint.id == id)
                    .ok_or_else(stale)?
                    .volume
                    .SetMute(muted, ptr::null()),
                AudioAction::InputMute { id, muted } => self
                    .input
                    .as_ref()
                    .filter(|endpoint| endpoint.id == id)
                    .ok_or_else(stale)?
                    .volume
                    .SetMute(muted, ptr::null()),
                AudioAction::SessionVolume { id, value } => self
                    .sessions
                    .iter()
                    .find(|session| session.id == id)
                    .ok_or_else(stale)?
                    .volume
                    .SetMasterVolume(value, ptr::null()),
                AudioAction::SessionMute { id, muted } => self
                    .sessions
                    .iter()
                    .find(|session| session.id == id)
                    .ok_or_else(stale)?
                    .volume
                    .SetMute(muted, ptr::null()),
            };
            result.map_err(|value| error("Windows no aceptó el control de audio", value))
        }
    }
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub(super) fn run(shared: Arc<Shared>, rx: mpsc::Receiver<Request>) {
    if let Err(value) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() } {
        let mut snapshot = AudioSnapshot::empty("unavailable");
        snapshot.error = Some(error("Core Audio no disponible", value));
        shared.publish(shared.epoch.load(Ordering::Acquire), snapshot);
        return;
    }
    let _apartment = Apartment;
    let enumerator: Result<IMMDeviceEnumerator, _> =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) };
    let enumerator = match enumerator {
        Ok(value) => value,
        Err(value) => {
            let mut snapshot = AudioSnapshot::empty("unavailable");
            snapshot.error = Some(error("Dispositivos no disponibles", value));
            shared.publish(shared.epoch.load(Ordering::Acquire), snapshot);
            return;
        }
    };
    let notify: IMMNotificationClient = Notify {
        shared: shared.clone(),
    }
    .into();
    let mut registered = false;
    let mut bindings: Option<Bindings> = None;
    shared.wake(true);
    while let Ok(request) = rx.recv() {
        shared.wake_pending.store(false, Ordering::Release);
        if shared.stopped.load(Ordering::Acquire) {
            break;
        }
        let epoch = shared.epoch.load(Ordering::Acquire);
        let enabled = shared.enabled.load(Ordering::Acquire);
        if !enabled {
            bindings = None;
            if registered {
                unsafe {
                    let _ = enumerator.UnregisterEndpointNotificationCallback(&notify);
                }
                registered = false;
            }
            if let Request::Control(_, _, _, reply) = request {
                let _ = reply.try_send(Err("Audio desactivado.".into()));
            }
            continue;
        }
        let update = || -> ::windows::core::Result<Bindings> {
            unsafe { Bindings::open(&enumerator, &notify) }
        };
        if shared.topology_dirty.swap(false, Ordering::AcqRel) || bindings.is_none() {
            bindings = None;
            if !registered {
                registered =
                    unsafe { enumerator.RegisterEndpointNotificationCallback(&notify) }.is_ok();
            }
            match update() {
                Ok(value) => bindings = Some(value),
                Err(value) => {
                    let mut snapshot = AudioSnapshot::empty("unavailable");
                    snapshot.error = Some(error("Core Audio no disponible", value));
                    shared.publish(epoch, snapshot);
                }
            };
        }
        if let Request::Control(request_epoch, deadline, action, reply) = request {
            if request_epoch != shared.epoch.load(Ordering::Acquire)
                || std::time::Instant::now() > deadline
            {
                let _ = reply.try_send(Err("Control de audio obsoleto.".into()));
                continue;
            }
            let result = bindings
                .as_ref()
                .ok_or_else(|| "Core Audio no disponible.".into())
                .and_then(|value| unsafe { value.control(action) });
            let _ = reply.try_send(result);
        }
        if let Some(bindings) = &bindings {
            match unsafe { bindings.snapshot() } {
                Ok(snapshot) => shared.publish(epoch, snapshot),
                Err(value) => {
                    let mut snapshot = AudioSnapshot::empty("unavailable");
                    snapshot.error = Some(error("No se pudo actualizar audio", value));
                    shared.publish(epoch, snapshot);
                }
            };
        }
    }
    drop(bindings);
    if registered {
        unsafe {
            let _ = enumerator.UnregisterEndpointNotificationCallback(&notify);
        }
    }
}

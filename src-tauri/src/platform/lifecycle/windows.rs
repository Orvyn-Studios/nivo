use super::{ObserverState, SystemEvent};
use std::{
    cell::Cell,
    io,
    panic::{catch_unwind, AssertUnwindSafe},
    ptr,
    sync::{atomic::Ordering, mpsc::SyncSender, Arc},
};
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM},
    System::{
        LibraryLoader::GetModuleHandleW,
        RemoteDesktop::{
            WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
            NOTIFY_FOR_THIS_SESSION,
        },
        Threading::GetCurrentThreadId,
    },
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
        GetMessageW, GetWindowLongPtrW, IsWindow, KillTimer, PeekMessageW, PostMessageW,
        PostQuitMessage, PostThreadMessageW, RegisterClassExW, SetTimer, SetWindowLongPtrW,
        TranslateMessage, UnregisterClassW, CREATESTRUCTW, GWLP_USERDATA, MSG,
        PBT_APMPOWERSTATUSCHANGE, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND,
        PM_NOREMOVE, WM_APP, WM_CLOSE, WM_DISPLAYCHANGE, WM_NCCREATE, WM_NCDESTROY, WM_NULL,
        WM_POWERBROADCAST, WM_QUIT, WM_TIMER, WM_WTSSESSION_CHANGE, WNDCLASSEXW, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_POPUP, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
    },
};

const FLUSH_DISPLAY: u32 = WM_APP + 41;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL, VK_NUMLOCK};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
const CURSOR_FRAME: usize = 42;
type Callback = Box<dyn Fn(SystemEvent) + Send + Sync>;

fn last_error(operation: &str) -> String {
    format!("{operation}: {}", io::Error::last_os_error())
}

pub(super) fn wake(thread_id: u32, quit: bool) -> Result<(), String> {
    // SAFETY: this id was published by our own worker after creating its queue;
    // only an ordinary no-op/WM_QUIT is posted, never input or another app's HWND.
    if thread_id == 0
        || unsafe { PostThreadMessageW(thread_id, if quit { WM_QUIT } else { WM_NULL }, 0, 0) } == 0
    {
        Err(last_error("No se pudo despertar el observador de Windows"))
    } else {
        Ok(())
    }
}

struct Context {
    shared: Arc<ObserverState>,
    callback: Callback,
    suspended: Cell<Option<bool>>,
    locked: Cell<Option<bool>>,
    display_pending: Cell<bool>,
    keyboard_registered: Cell<bool>,
    cursor_registered: Cell<bool>,
    cursor_pending: Cell<bool>,
    lock_states: Cell<[Option<bool>; 2]>,
}

impl Context {
    fn cursor_settings(&self, hwnd: HWND) {
        let enabled = self.shared.cursor_enabled.load(Ordering::Acquire)
            && self.locked.get() != Some(true)
            && self.suspended.get() != Some(true);
        if enabled == self.cursor_registered.get() {
            return;
        }
        let device = RAWINPUTDEVICE {
            usUsagePage: 1,
            usUsage: 2,
            dwFlags: if enabled {
                RIDEV_INPUTSINK
            } else {
                RIDEV_REMOVE
            },
            hwndTarget: if enabled { hwnd } else { ptr::null_mut() },
        };
        // Observe movements in the background; never capture/suppress mouse input.
        if unsafe { RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32) } == 0 {
            self.shared
                .error(last_error("No se pudo actualizar la mirada de Nivo"));
            return;
        }
        self.cursor_registered.set(enabled);
        if !enabled {
            unsafe { KillTimer(hwnd, CURSOR_FRAME) };
            self.cursor_pending.set(false);
        }
    }

    fn cursor_frame(&self, hwnd: HWND) {
        // One shot, armed only by real mouse movement. No timer runs in idle.
        unsafe { KillTimer(hwnd, CURSOR_FRAME) };
        self.cursor_pending.set(false);
        if !self.cursor_registered.get() || !self.shared.cursor_enabled.load(Ordering::Acquire) {
            return;
        }
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) } != 0 {
            self.emit(SystemEvent::CursorMoved {
                x: point.x,
                y: point.y,
            });
        }
    }

    fn keyboard_settings(&self, hwnd: HWND) {
        let enabled = self.shared.caps_enabled.load(Ordering::Acquire)
            || self.shared.num_enabled.load(Ordering::Acquire);
        if enabled == self.keyboard_registered.get() {
            return;
        }
        let device = RAWINPUTDEVICE {
            usUsagePage: 1,
            usUsage: 6,
            dwFlags: if enabled {
                RIDEV_INPUTSINK
            } else {
                RIDEV_REMOVE
            },
            hwndTarget: if enabled { hwnd } else { ptr::null_mut() },
        };
        // No NOLEGACY/NOHOTKEYS: Nivo never consumes or suppresses keyboard input.
        if unsafe { RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32) } == 0 {
            self.shared
                .error(last_error("No se pudo actualizar el indicador de teclas"));
            return;
        }
        self.keyboard_registered.set(enabled);
        self.lock_states.set(if enabled {
            unsafe {
                [
                    Some(GetKeyState(i32::from(VK_CAPITAL)) & 1 != 0),
                    Some(GetKeyState(i32::from(VK_NUMLOCK)) & 1 != 0),
                ]
            }
        } else {
            [None, None]
        });
    }

    fn input(&self, hwnd: HWND, handle: HRAWINPUT) {
        let mut raw = RAWINPUT::default();
        let mut bytes = size_of::<RAWINPUT>() as u32;
        if unsafe {
            GetRawInputData(
                handle,
                RID_INPUT,
                (&mut raw as *mut RAWINPUT).cast(),
                &mut bytes,
                size_of::<RAWINPUTHEADER>() as u32,
            )
        } == u32::MAX
        {
            return;
        }
        if raw.header.dwType == RIM_TYPEMOUSE {
            let mouse = unsafe { raw.data.mouse };
            if self.cursor_registered.get()
                && (mouse.lLastX != 0 || mouse.lLastY != 0)
                && !self.cursor_pending.get()
            {
                // Coalesce high-rate devices to at most ~30 updates/s, retaining
                // the final cursor position even when the mouse stops immediately.
                if unsafe { SetTimer(hwnd, CURSOR_FRAME, 33, None) } != 0 {
                    self.cursor_pending.set(true);
                }
            }
            return;
        }
        if raw.header.dwType != RIM_TYPEKEYBOARD || !self.keyboard_registered.get() {
            return;
        }
        let key = unsafe { raw.data.keyboard };
        // Discard every other virtual key immediately. Never convert scan codes to text.
        let index = if key.VKey == VK_CAPITAL {
            0
        } else if key.VKey == VK_NUMLOCK {
            1
        } else {
            return;
        };
        if key.Message != 0x0101 && key.Message != 0x0105 {
            return;
        } // key-up only; no repeat notices
        let enabled = unsafe { GetKeyState(i32::from(key.VKey)) & 1 != 0 };
        let mut states = self.lock_states.get();
        let previous = states[index];
        states[index] = Some(enabled);
        self.lock_states.set(states);
        let allowed = if index == 0 {
            &self.shared.caps_enabled
        } else {
            &self.shared.num_enabled
        };
        if previous.is_some_and(|previous| previous != enabled) && allowed.load(Ordering::Acquire) {
            self.emit(SystemEvent::LockKey {
                caps: index == 0,
                enabled,
            });
        }
    }
    fn emit(&self, event: SystemEvent) {
        if self.shared.stopped.load(Ordering::Acquire) {
            return;
        }
        // A callback must never unwind through the Windows ABI boundary.
        if catch_unwind(AssertUnwindSafe(|| (self.callback)(event))).is_err() {
            self.shared
                .error("Falló el procesamiento de un evento de Windows.".into());
            self.shared.stopped.store(true, Ordering::Release);
            // SAFETY: called on the thread owning this message loop.
            unsafe { PostQuitMessage(1) };
        }
    }

    fn power(&self, suspended: bool) {
        if self.suspended.get() != Some(suspended) {
            self.suspended.set(Some(suspended));
            self.emit(if suspended {
                SystemEvent::Suspended
            } else {
                SystemEvent::Resumed
            });
        }
    }

    fn session(&self, locked: bool) {
        if self.locked.get() != Some(locked) {
            self.locked.set(Some(locked));
            self.emit(if locked {
                SystemEvent::SessionLocked
            } else {
                SystemEvent::SessionUnlocked
            });
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // SAFETY: this WndProc is used solely by our registered class. On create,
    // Windows provides our lpParam; Context stays boxed until after DestroyWindow.
    unsafe {
        if message == WM_NCCREATE {
            let creation = lparam as *const CREATESTRUCTW;
            if creation.is_null() || (*creation).lpCreateParams.is_null() {
                return 0;
            }
            SetLastError(0);
            let previous =
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*creation).lpCreateParams as isize);
            if previous == 0 && GetLastError() != 0 {
                return 0;
            }
            return 1;
        }
        let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Context;
        if message == WM_NCDESTROY {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }
        if context.is_null() {
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }
        let context = &*context;
        match message {
            WM_DISPLAYCHANGE => {
                if !context.display_pending.get() {
                    context.display_pending.set(true);
                    if PostMessageW(hwnd, FLUSH_DISPLAY, 0, 0) == 0 {
                        context.display_pending.set(false);
                        context
                            .shared
                            .error(last_error("No se pudo agrupar un cambio de pantalla"));
                        context.emit(SystemEvent::DisplayChanged);
                    }
                }
                0
            }
            FLUSH_DISPLAY => {
                if context.display_pending.replace(false) {
                    context.emit(SystemEvent::DisplayChanged);
                }
                0
            }
            WM_POWERBROADCAST => {
                match wparam as u32 {
                    PBT_APMPOWERSTATUSCHANGE => context.emit(SystemEvent::PowerChanged),
                    PBT_APMSUSPEND => context.power(true),
                    PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => context.power(false),
                    _ => return DefWindowProcW(hwnd, message, wparam, lparam),
                }
                1
            }
            0x00ff => {
                // WM_INPUT: DefWindowProc performs the required foreground cleanup.
                context.input(hwnd, lparam as HRAWINPUT);
                DefWindowProcW(hwnd, message, wparam, lparam)
            }
            WM_TIMER if wparam == CURSOR_FRAME => {
                context.cursor_frame(hwnd);
                0
            }
            WM_WTSSESSION_CHANGE => {
                match wparam as u32 {
                    WTS_SESSION_LOCK => context.session(true),
                    WTS_SESSION_UNLOCK => context.session(false),
                    _ => {}
                }
                0
            }
            WM_CLOSE => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

struct Resources {
    hwnd: HWND,
    instance: HINSTANCE,
    class_name: Vec<u16>,
    registered_wts: bool,
    context: Box<Context>,
}

impl Drop for Resources {
    fn drop(&mut self) {
        // SAFETY: all calls run on the creating thread. Context and UTF-16 class
        // storage remain live until the window/class no longer use them.
        unsafe {
            if self.context.keyboard_registered.get() {
                let device = RAWINPUTDEVICE {
                    usUsagePage: 1,
                    usUsage: 6,
                    dwFlags: RIDEV_REMOVE,
                    hwndTarget: ptr::null_mut(),
                };
                RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32);
            }
            KillTimer(self.hwnd, CURSOR_FRAME);
            if self.context.cursor_registered.get() {
                let device = RAWINPUTDEVICE {
                    usUsagePage: 1,
                    usUsage: 2,
                    dwFlags: RIDEV_REMOVE,
                    hwndTarget: ptr::null_mut(),
                };
                RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32);
            }
            if self.registered_wts && WTSUnRegisterSessionNotification(self.hwnd) == 0 {
                self.context
                    .shared
                    .error(last_error("No se pudieron cancelar los eventos de sesión"));
            }
            if !self.hwnd.is_null() && IsWindow(self.hwnd) != 0 && DestroyWindow(self.hwnd) == 0 {
                self.context
                    .shared
                    .error(last_error("No se pudo cerrar la ventana del observador"));
            }
            if UnregisterClassW(self.class_name.as_ptr(), self.instance) == 0 {
                self.context
                    .shared
                    .error(last_error("No se pudo liberar la clase del observador"));
            }
        }
    }
}

fn create(shared: Arc<ObserverState>, callback: Callback) -> Result<Resources, String> {
    // SAFETY: NULL requests this executable's loaded module, without loading DLLs.
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    if instance.is_null() {
        return Err(last_error("No se pudo consultar el módulo de Nivo"));
    }
    let thread_id = unsafe { GetCurrentThreadId() };
    let class_name: Vec<u16> = format!("Orvyn.Nivo.Lifecycle.{}.{}", std::process::id(), thread_id)
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let class = WNDCLASSEXW {
        cbSize: size_of::<WNDCLASSEXW>() as u32,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name.as_ptr(),
        ..Default::default()
    };
    // SAFETY: every pointer targets owned live data and our one WndProc.
    if unsafe { RegisterClassExW(&class) } == 0 {
        return Err(last_error("No se pudo registrar la clase del observador"));
    }
    let mut resources = Resources {
        hwnd: ptr::null_mut(),
        instance,
        class_name,
        registered_wts: false,
        context: Box::new(Context {
            shared,
            callback,
            suspended: Cell::new(None),
            locked: Cell::new(None),
            display_pending: Cell::new(false),
            keyboard_registered: Cell::new(false),
            cursor_registered: Cell::new(false),
            cursor_pending: Cell::new(false),
            lock_states: Cell::new([None, None]),
        }),
    };
    // A hidden TOP-LEVEL window receives broadcasts; HWND_MESSAGE does not.
    // No WS_VISIBLE, no activation, no input, no taskbar or Alt+Tab entry.
    resources.hwnd = unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            resources.class_name.as_ptr(),
            ptr::null(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            instance,
            (&mut *resources.context as *mut Context).cast(),
        )
    };
    if resources.hwnd.is_null() {
        return Err(last_error("No se pudo crear la ventana del observador"));
    }
    if unsafe { WTSRegisterSessionNotification(resources.hwnd, NOTIFY_FOR_THIS_SESSION) } == 0 {
        return Err(last_error(
            "No se pudieron registrar los eventos de bloqueo de esta sesión",
        ));
    }
    resources.registered_wts = true;
    Ok(resources)
}

pub(super) fn run(
    shared: Arc<ObserverState>,
    callback: Callback,
    ready: SyncSender<Result<(), String>>,
) {
    struct Completion(Arc<ObserverState>);
    impl Drop for Completion {
        fn drop(&mut self) {
            self.0.finished.store(true, Ordering::Release);
        }
    }
    let _completion = Completion(shared.clone());
    // SAFETY: creates only this thread's message queue before publishing its id.
    let mut message = MSG::default();
    unsafe { PeekMessageW(&mut message, ptr::null_mut(), 0, 0, PM_NOREMOVE) };
    shared
        .thread_id
        .store(unsafe { GetCurrentThreadId() }, Ordering::Release);
    let resources = match create(shared.clone(), callback) {
        Ok(resources) => resources,
        Err(error) => {
            shared.error(error.clone());
            let _ = ready.try_send(Err(error));
            return;
        }
    };
    let _ = ready.try_send(Ok(()));
    while !shared.stopped.load(Ordering::Acquire) {
        // SAFETY: initialized MSG belongs to this worker. No polling: GetMessage
        // sleeps until a Windows broadcast, health check or shutdown message.
        let result = unsafe { GetMessageW(&mut message, ptr::null_mut(), 0, 0) };
        if result == 0 {
            break;
        }
        if result == -1 {
            shared.error(last_error("Falló la recepción de eventos de Windows"));
            break;
        }
        unsafe {
            resources.context.keyboard_settings(resources.hwnd);
            resources.context.cursor_settings(resources.hwnd);
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    drop(resources);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn duplicate_power_and_session_states_emit_once_and_start_unknown() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let output = events.clone();
        let context = Context {
            shared: Arc::new(ObserverState {
                thread_id: 0.into(),
                stopped: false.into(),
                finished: false.into(),
                caps_enabled: false.into(),
                num_enabled: false.into(),
                cursor_enabled: false.into(),
                error: Mutex::new(None),
            }),
            callback: Box::new(move |event| output.lock().unwrap().push(event)),
            suspended: Cell::new(None),
            locked: Cell::new(None),
            display_pending: Cell::new(false),
            keyboard_registered: Cell::new(false),
            cursor_registered: Cell::new(false),
            cursor_pending: Cell::new(false),
            lock_states: Cell::new([None, None]),
        };
        assert!(events.lock().unwrap().is_empty());
        context.power(true);
        context.power(true);
        context.power(false);
        context.power(false);
        context.session(true);
        context.session(true);
        context.session(false);
        context.session(false);
        assert_eq!(
            *events.lock().unwrap(),
            [
                SystemEvent::Suspended,
                SystemEvent::Resumed,
                SystemEvent::SessionLocked,
                SystemEvent::SessionUnlocked
            ]
        );
    }
}

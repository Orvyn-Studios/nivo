use crate::{
    display, events,
    fullscreen::{FullscreenObservation, PhysicalRect},
    placement, platform,
    settings::{Settings, SettingsStore},
    visibility::{Blocker, VisibilityPolicy},
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{App, Manager, WebviewWindow};

#[derive(Clone, Default)]
struct NativeVisibility {
    policy: VisibilityPolicy,
    ready: bool,
    reported: Option<bool>,
    observation: Option<FullscreenObservation>,
}

#[derive(Default)]
pub struct IslandState {
    expanded: AtomicBool,
    surface_epoch: AtomicU64,
    last_surface: Mutex<Option<placement::SurfaceSample>>,
    last_region: Mutex<Option<placement::SurfaceRegion>>,
    tray_available: AtomicBool,
    visibility: Mutex<NativeVisibility>,
}

impl IslandState {
    pub fn surface_epoch(&self) -> u64 {
        self.surface_epoch.load(Ordering::Acquire)
    }
    pub fn expanded(&self) -> bool {
        self.expanded.load(Ordering::Relaxed)
    }
    pub fn set_expanded(&self, expanded: bool) {
        self.expanded.store(expanded, Ordering::Relaxed);
    }
    pub fn prepare_surface(&self, expanded: bool) -> Result<placement::SurfaceSnapshot, String> {
        let sample = self
            .last_surface
            .lock()
            .map_err(|_| "La superficie no está disponible.")?;
        let epoch = self.surface_epoch.fetch_add(1, Ordering::AcqRel) + 1;
        self.set_expanded(expanded);
        Ok(placement::SurfaceSnapshot {
            epoch,
            sample: *sample,
        })
    }
    pub fn set_tray_available(&self, available: bool) {
        self.tray_available.store(available, Ordering::Relaxed);
    }
    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::Relaxed)
    }
    pub fn paused(&self) -> Result<bool, String> {
        self.visibility
            .lock()
            .map(|state| state.policy.paused())
            .map_err(|_| "El estado de visibilidad de Nivo no está disponible.".into())
    }
}

pub fn require_island(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "island" {
        return Err("Ventana no permitida.".into());
    }
    Ok(())
}

pub fn place(window: &WebviewWindow, expanded: bool, settings: &Settings) -> Result<(), String> {
    require_island(window)?;
    settings.validate()?;
    let monitor = display::selected(window, settings.monitor_name.as_deref())?;
    let area = monitor.work_area();
    let p = placement::fit(
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        monitor.scale_factor(),
        expanded,
        settings.horizontal_position,
        settings.top_gap,
    )
    .map_err(str::to_owned)?;
    let cached = window
        .state::<IslandState>()
        .last_surface
        .lock()
        .map_err(|_| "La superficie no está disponible.")?
        .map(|sample| sample.shape);
    let region = placement::retained_region(&p, cached, expanded).map_err(str::to_owned)?;
    window
        .state::<IslandState>()
        .surface_epoch
        .fetch_add(1, Ordering::AcqRel);
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    if position.x != p.x || position.y != p.y || size.width != p.width || size.height != p.height {
        platform::set_bounds(window, &p)?;
    }
    platform::set_surface_region(window, &region)?;
    platform::set_app_occlusion(window, settings.hide_behind_apps)?;
    let state = window.state::<IslandState>();
    *state
        .last_region
        .lock()
        .map_err(|_| "La región no está disponible.")? = Some(region);
    *state
        .last_surface
        .lock()
        .map_err(|_| "La superficie no está disponible.")? = Some(placement::SurfaceSample {
        shape: placement::SurfaceGeometry {
            left: f64::from(region.left) / p.scale,
            top: f64::from(region.top) / p.scale,
            width: f64::from(region.right - region.left) / p.scale,
            height: f64::from(region.bottom - region.top) / p.scale,
            radius: f64::from(region.diameter) / p.scale / 2.0,
        },
        velocity: placement::SurfaceVelocity::default(),
    });
    let state = window
        .app_handle()
        .try_state::<IslandState>()
        .ok_or("El estado de Nivo no está disponible.")?;
    let bounds = monitor_rect(&monitor)?;
    change_visibility(window, &state, |next| {
        update_fullscreen(next, settings, bounds)
    })?;
    refresh_fullscreen(window);
    Ok(())
}

pub fn set_surface_geometry(
    window: &WebviewWindow,
    state: &IslandState,
    epoch: u64,
    shape: placement::SurfaceGeometry,
    velocity: placement::SurfaceVelocity,
) -> Result<bool, String> {
    require_island(window)?;
    if !velocity.valid() {
        return Err("Velocidad visual no válida.".into());
    }
    let mut previous = state
        .last_surface
        .lock()
        .map_err(|_| "La superficie no está disponible.")?;
    if epoch != state.surface_epoch() {
        return Ok(false);
    }
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let region = placement::animated_region((size.width, size.height), scale, shape)
        .map_err(str::to_owned)?;
    let mut last_region = state
        .last_region
        .lock()
        .map_err(|_| "La región no está disponible.")?;
    if last_region.as_ref() != Some(&region) {
        platform::set_surface_region(window, &region)?;
        *last_region = Some(region);
    }
    *previous = Some(placement::SurfaceSample { shape, velocity });
    Ok(true)
}

pub fn show(
    window: &WebviewWindow,
    state: &IslandState,
    settings: &Settings,
) -> Result<(), String> {
    present(window, state, settings, true)
}

/// Frontend readiness is not a new show request: a webview recovery must not
/// discard Hide/Pause chosen earlier from the tray or bypass system blockers.
pub fn ready(
    window: &WebviewWindow,
    state: &IslandState,
    settings: &Settings,
) -> Result<(), String> {
    present(window, state, settings, false)
}

fn present(
    window: &WebviewWindow,
    state: &IslandState,
    settings: &Settings,
    request_show: bool,
) -> Result<(), String> {
    require_island(window)?;
    let configured =
        platform::initialize(window).and_then(|_| place(window, state.expanded(), settings));
    // A placement failure must leave an accessible UI, but is still returned
    // to the caller instead of being presented as a successful native startup.
    change_visibility(window, state, |next| {
        next.ready = true;
        if request_show {
            next.policy.show();
        }
        // Each explicit presentation/readiness handshake publishes current
        // visibility, including if a previous webview listener was not ready.
        next.reported = None;
    })?;
    configured
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    require_island(window)?;
    let state = window.app_handle().state::<IslandState>();
    change_visibility(window, &state, |next| next.policy.hide())
}

fn set_physical_visibility(window: &WebviewWindow, visible: bool) -> Result<(), String> {
    if visible {
        platform::show_without_activation(window)
    } else {
        // Match the direct Win32 show path; Tao retains its initial hidden flag.
        platform::hide_without_activation(window)
    }
}

/// A failed native action or IPC delivery never commits candidate intent or
/// blockers. Rollback restores actual visibility without taking keyboard focus.
fn change_visibility(
    window: &WebviewWindow,
    state: &IslandState,
    change: impl FnOnce(&mut NativeVisibility),
) -> Result<(), String> {
    let mut current = state
        .visibility
        .lock()
        .map_err(|_| "El estado de visibilidad de Nivo no está disponible.")?;
    let mut next = current.clone();
    change(&mut next);
    let visible = next.ready && next.policy.visible();
    let previous = window.is_visible().map_err(|error| error.to_string())?;
    if visible != previous {
        set_physical_visibility(window, visible)?;
    }
    // No delivery is remembered before ready: the frontend registers first,
    // so even a fullscreen-suppressed launch receives its initial false.
    if next.ready && next.reported != Some(visible) {
        if let Err(error) = events::visibility(window, visible) {
            if let Err(rollback) = set_physical_visibility(window, previous) {
                return Err(format!(
                    "{error} Tampoco se pudo restaurar la visibilidad: {rollback}"
                ));
            }
            if let Err(rollback) = events::visibility(window, previous) {
                return Err(format!(
                    "{error} La ventana se restauró, pero falló su comunicación: {rollback}"
                ));
            }
            return Err(error);
        }
        next.reported = Some(visible);
    }
    *current = next;
    drop(current);
    if let Some(github) = window
        .app_handle()
        .try_state::<Arc<crate::github::GithubService>>()
    {
        github.inner().set_active(visible);
    }
    Ok(())
}

pub fn toggle_pause(window: &WebviewWindow) -> Result<(), String> {
    require_island(window)?;
    let state = window.app_handle().state::<IslandState>();
    change_visibility(window, &state, |next| next.policy.toggle_pause())
}

pub fn set_system_blocker(
    window: &WebviewWindow,
    blocker: Blocker,
    active: bool,
) -> Result<(), String> {
    require_island(window)?;
    let state = window.app_handle().state::<IslandState>();
    change_visibility(window, &state, |next| {
        next.policy.set_blocker(blocker, active)
    })
}

fn monitor_rect(monitor: &tauri::Monitor) -> Result<PhysicalRect, String> {
    let origin = monitor.position();
    let size = monitor.size();
    let rect = PhysicalRect {
        left: origin.x,
        top: origin.y,
        right: i32::try_from(i64::from(origin.x) + i64::from(size.width))
            .map_err(|_| "Coordenadas de monitor fuera de rango.")?,
        bottom: i32::try_from(i64::from(origin.y) + i64::from(size.height))
            .map_err(|_| "Coordenadas de monitor fuera de rango.")?,
    };
    if !rect.is_valid() {
        return Err("Geometría de monitor no válida.".into());
    }
    Ok(rect)
}

fn update_fullscreen(next: &mut NativeVisibility, settings: &Settings, selected: PhysicalRect) {
    if !settings.hide_in_fullscreen {
        next.policy.set_blocker(Blocker::Fullscreen, false);
    } else if let Some(observation) = next.observation {
        next.policy.set_blocker(
            Blocker::Fullscreen,
            observation.covered && observation.monitor_rect == selected,
        );
    }
    // Unknown retains prior suppression, never claims a fullscreen ended.
}

fn observe_fullscreen(
    window: &WebviewWindow,
    observation: Option<FullscreenObservation>,
) -> Result<(), String> {
    let settings = window.app_handle().state::<SettingsStore>().snapshot()?;
    let selected = display::selected(window, settings.monitor_name.as_deref())?;
    let bounds = monitor_rect(&selected)?;
    let state = window.app_handle().state::<IslandState>();
    change_visibility(window, &state, |next| {
        next.observation = observation;
        update_fullscreen(next, &settings, bounds);
    })
}

#[derive(Default)]
struct PendingObservation {
    latest: Option<Option<FullscreenObservation>>,
    scheduled: bool,
    stopping: bool,
}

pub struct FullscreenService {
    #[cfg(windows)]
    observer: Mutex<Option<platform::FullscreenObserver>>,
    pending: Arc<Mutex<PendingObservation>>,
}

impl FullscreenService {
    pub fn refresh(&self) {
        #[cfg(windows)]
        if let Some(observer) = self
            .observer
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
        {
            observer.refresh();
        }
    }

    pub fn shutdown(&self) {
        {
            let mut pending = self
                .pending
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            pending.stopping = true;
            pending.latest = None;
        }
        #[cfg(windows)]
        {
            let observer = self
                .observer
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take();
            drop(observer);
        }
    }
}

impl Drop for FullscreenService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn refresh_fullscreen(window: &WebviewWindow) {
    if let Some(service) = window.app_handle().try_state::<FullscreenService>() {
        service.refresh();
    }
}

pub fn install_fullscreen(app: &App) -> Result<FullscreenService, String> {
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("La observación de pantalla completa requiere Windows.".into())
    }
    #[cfg(windows)]
    {
        let app = app.handle().clone();
        let pending = Arc::new(Mutex::new(PendingObservation::default()));
        let callback_pending = Arc::clone(&pending);
        let observer = platform::FullscreenObserver::start(move |observation| {
            {
                let mut pending = callback_pending
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                if pending.stopping {
                    return;
                }
                pending.latest = Some(observation);
                if pending.scheduled {
                    return;
                }
                pending.scheduled = true;
            }
            let delivery = Arc::clone(&callback_pending);
            let ui = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                let latest = {
                    let mut pending = delivery.lock().unwrap_or_else(|error| error.into_inner());
                    pending.scheduled = false;
                    if pending.stopping {
                        return;
                    }
                    pending.latest.take()
                };
                if let (Some(observation), Some(window)) = (latest, ui.get_webview_window("island"))
                {
                    if let Err(error) = observe_fullscreen(&window, observation) {
                        eprintln!("Nivo fullscreen: {error}");
                    }
                }
            }) {
                callback_pending
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .scheduled = false;
                eprintln!("No se pudo entregar la observación de pantalla completa: {error}");
            }
        })?;
        Ok(FullscreenService {
            observer: Mutex::new(Some(observer)),
            pending,
        })
    }
}

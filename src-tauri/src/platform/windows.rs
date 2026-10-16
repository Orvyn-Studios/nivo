use crate::placement::{Placement, SurfaceRegion};
use std::{io, ptr};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, HWND},
    Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn},
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    },
};

fn hwnd(window: &WebviewWindow) -> Result<HWND, String> {
    window
        .hwnd()
        .map(|handle| handle.0 as HWND)
        .map_err(|error| error.to_string())
}

fn last_error(operation: &str) -> String {
    format!("{operation}: {}", io::Error::last_os_error())
}

pub fn initialize(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    // SAFETY: hwnd belongs to this live Tauri window; only its documented
    // extended-style slot is read/written. Existing unrelated bits are kept.
    unsafe {
        SetLastError(0);
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style == 0 && GetLastError() != 0 {
            return Err(last_error("Consultar estilo de Nivo"));
        }
        let style = (style | WS_EX_TOOLWINDOW as isize) & !(WS_EX_APPWINDOW as isize);
        SetLastError(0);
        let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        if previous == 0 && GetLastError() != 0 {
            return Err(last_error("Aplicar ventana de herramienta"));
        }
        if SetWindowPos(
            hwnd,
            ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        ) == 0
        {
            return Err(last_error("Actualizar estilo de Nivo"));
        }
    }
    // NOACTIVATE is deliberately not permanent: intentional keyboard access
    // and assistive technology must remain possible.
    Ok(())
}

pub fn show_without_activation(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    // SAFETY: the live owned HWND is shown without moving/resizing, changing
    // z-order or activating it. SetWindowPos reports actual operation failure.
    let result = unsafe {
        SetWindowPos(
            hwnd,
            ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW,
        )
    };
    if result == 0 {
        Err(last_error("Mostrar Nivo sin activar"))
    } else {
        Ok(())
    }
}

pub fn set_bounds(window: &WebviewWindow, placement: &Placement) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    let width = i32::try_from(placement.width).map_err(|_| "Anchura fuera de rango.")?;
    let height = i32::try_from(placement.height).map_err(|_| "Altura fuera de rango.")?;
    // SAFETY: one operation updates physical position and size together on
    // our own HWND without activation, eliminating intermediate geometry.
    let result = unsafe {
        SetWindowPos(
            hwnd,
            ptr::null_mut(),
            placement.x,
            placement.y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
    };
    if result == 0 {
        Err(last_error("Posicionar Nivo"))
    } else {
        Ok(())
    }
}

pub fn set_surface_region(window: &WebviewWindow, region: &SurfaceRegion) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    // SAFETY: region coordinates are finite physical pixels validated by
    // placement. CreateRoundRectRgn returns an owned GDI region or NULL.
    let handle = unsafe {
        CreateRoundRectRgn(
            region.left,
            region.top,
            region.right,
            region.bottom,
            region.diameter,
            region.diameter,
        )
    };
    if handle.is_null() {
        return Err(last_error("Crear región interactiva de Nivo"));
    }
    // SAFETY: both handles remain live during this call. On success Windows
    // takes ownership of the region; on failure it remains ours to destroy.
    let result = unsafe { SetWindowRgn(hwnd, handle, 1) };
    if result == 0 {
        let error = last_error("Aplicar región interactiva de Nivo");
        unsafe {
            DeleteObject(handle as _);
        }
        return Err(error);
    }
    Ok(())
}

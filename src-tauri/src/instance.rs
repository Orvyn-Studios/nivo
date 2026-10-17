//! One desktop island per Windows logon session, even across copied executables.
#[cfg(windows)]
pub struct InstanceGuard(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl InstanceGuard {
    fn named(name: &str) -> Result<Option<Self>, String> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        };
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        // The kernel atomically creates/opens the named object. Hold the handle
        // for the desktop lifetime; no polling, ownership waits or stale lock file.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(format!(
                "No se pudo proteger la instancia de Nivo: {}",
                std::io::Error::last_os_error()
            ));
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { CloseHandle(handle) };
            return Ok(None);
        }
        Ok(Some(Self(handle)))
    }

    pub fn acquire() -> Result<Option<Self>, String> {
        Self::named("Local\\Orvyn.Nivo.Desktop.v1")
    }
}

#[cfg(windows)]
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(not(windows))]
pub struct InstanceGuard;
#[cfg(not(windows))]
impl InstanceGuard {
    pub fn acquire() -> Result<Option<Self>, String> {
        Ok(Some(Self))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn duplicate_is_rejected_and_normal_shutdown_releases_the_guard() {
        let name = format!("Local\\Orvyn.Nivo.Test.{}", std::process::id());
        let first = InstanceGuard::named(&name).unwrap().unwrap();
        assert!(InstanceGuard::named(&name).unwrap().is_none());
        drop(first);
        assert!(InstanceGuard::named(&name).unwrap().is_some());
    }
}

//! A single private credential target. No generic secret-get command exists.
use zeroize::{Zeroize, Zeroizing};
const TARGET: &str = "Orvyn.Nivo.GitHub.PAT.v1";
pub fn read() -> Result<Option<Zeroizing<String>>, String> {
    read_at(TARGET)
}
pub fn write(token: &str) -> Result<(), String> {
    write_at(TARGET, token)
}
pub fn clear() -> Result<(), String> {
    clear_at(TARGET)
}

#[cfg(windows)]
fn write_at(target: &str, token: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::*;
    if token.len() > 1024 {
        return Err("Credencial demasiado larga.".into());
    }
    let mut name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let mut user: Vec<u16> = "GitHub".encode_utf16().chain(Some(0)).collect();
    // SAFETY: all pointers refer to owned buffers valid for the synchronous call.
    // Generic credentials are per current Windows user; LOCAL_MACHINE is persistence,
    // not machine-wide access. No credential is ever returned through IPC.
    let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = name.as_mut_ptr();
    credential.UserName = user.as_mut_ptr();
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.CredentialBlobSize = token.len() as u32;
    credential.CredentialBlob = token.as_ptr() as *mut u8;
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err("Windows no pudo guardar la credencial de GitHub.".into());
    }
    Ok(())
}
#[cfg(windows)]
fn read_at(target: &str) -> Result<Option<Zeroizing<String>>, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    let name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let mut credential = std::ptr::null_mut();
    // SAFETY: CredRead allocates the complete output. It is scrubbed then freed exactly once.
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
            return if GetLastError() == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err("Windows no pudo leer la credencial de GitHub.".into())
            };
        }
        let entry = &mut *credential;
        let result = if entry.CredentialBlobSize > 1024 || entry.CredentialBlob.is_null() {
            Err("La credencial guardada no es válida.".into())
        } else {
            let blob = std::slice::from_raw_parts_mut(
                entry.CredentialBlob,
                entry.CredentialBlobSize as usize,
            );
            let result = std::str::from_utf8(blob)
                .map(|v| Some(Zeroizing::new(v.to_owned())))
                .map_err(|_| "La credencial guardada no es válida.".into());
            blob.zeroize();
            result
        };
        CredFree(credential.cast());
        result
    }
}
#[cfg(windows)]
fn clear_at(target: &str) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    let name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    // SAFETY: only our fixed generic target (or an isolated cfg(test) target) is removed.
    if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
        && unsafe { GetLastError() } != ERROR_NOT_FOUND
    {
        return Err(
            "No se pudo eliminar la credencial de GitHub. La sincronización se ha detenido.".into(),
        );
    }
    Ok(())
}
#[cfg(not(windows))]
fn read_at(_: &str) -> Result<Option<Zeroizing<String>>, String> {
    Err("Requiere Windows Credential Manager.".into())
}
#[cfg(not(windows))]
fn write_at(_: &str, _: &str) -> Result<(), String> {
    Err("Requiere Windows Credential Manager.".into())
}
#[cfg(not(windows))]
fn clear_at(_: &str) -> Result<(), String> {
    Err("Requiere Windows Credential Manager.".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn isolated_real_credential_roundtrip_and_delete() {
        let target = format!("Orvyn.Nivo.Test.GitHub.{}", std::process::id());
        let secret = Zeroizing::new("github_pat_test_not_a_real_token".to_string());
        clear_at(&target).unwrap();
        write_at(&target, &secret).unwrap();
        let read = read_at(&target).unwrap().unwrap();
        clear_at(&target).unwrap();
        assert_eq!(read.as_str(), secret.as_str());
        assert!(read_at(&target).unwrap().is_none());
    }
}

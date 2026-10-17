//! Optional, per-user startup registration. Call `set_enabled` only after a user action.
//! The Run entry does not override Windows startup policy or Startup Apps preferences.
//! https://learn.microsoft.com/windows/win32/setupapi/run-and-runonce-registry-keys

#[cfg(any(windows, test))]
fn quote_executable(path: &[u16]) -> Result<Vec<u16>, String> {
    let text = String::from_utf16(path)
        .map_err(|_| "La ruta del ejecutable contiene UTF-16 no válido.".to_string())?;
    let bytes = text.as_bytes();
    // Only a local, drive-rooted path. No relative, UNC, device, or alternate-stream paths.
    if bytes.len() < 4
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || !text.to_ascii_lowercase().ends_with(".exe")
        || text[3..].contains(':')
        || text
            .chars()
            .any(|c| c.is_control() || "\"<>|?*/".contains(c))
        || text[3..].split('\\').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.ends_with([' ', '.'])
        })
    {
        return Err(
            "El inicio automático requiere una ruta local absoluta a un archivo .exe.".into(),
        );
    }
    // Run has a documented 260-character command limit. Include quotes and NUL conservatively.
    if path.len() > 257 {
        return Err(
            "La ruta del ejecutable es demasiado larga para el inicio automático de Windows."
                .into(),
        );
    }
    let mut command = Vec::with_capacity(path.len() + 3);
    command.push(u16::from(b'"'));
    command.extend_from_slice(path);
    command.extend_from_slice(&[u16::from(b'"'), 0]);
    Ok(command)
}

#[cfg(windows)]
mod windows {
    use super::quote_executable;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS, REG_SZ,
    };

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "Orvyn.Nivo";
    const MAX_VALUE_BYTES: usize = 16 * 1024;

    struct RegistryKey(HKEY);

    impl Drop for RegistryKey {
        fn drop(&mut self) {
            // SAFETY: this handle is owned, was returned by RegOpen/CreateKey, and closes once.
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn registry_error(operation: &str, code: u32) -> String {
        format!(
            "No se ha podido {operation} el inicio automático de Nivo: {}",
            std::io::Error::from_raw_os_error(code as i32)
        )
    }

    fn open(access: REG_SAM_FLAGS) -> Result<Option<RegistryKey>, String> {
        let mut handle = null_mut();
        let path = wide(RUN_KEY);
        // SAFETY: fixed NUL-terminated path; output handle is valid only after ERROR_SUCCESS.
        let result =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, access, &mut handle) };
        match result {
            ERROR_SUCCESS => Ok(Some(RegistryKey(handle))),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            code => Err(registry_error("consultar", code)),
        }
    }

    fn current_command() -> Result<Vec<u16>, String> {
        let path = std::env::current_exe()
            .map_err(|error| format!("No se ha podido localizar el ejecutable de Nivo: {error}"))?;
        quote_executable(&path.as_os_str().encode_wide().collect::<Vec<_>>())
    }

    fn read_own_value(key: &RegistryKey) -> Result<Option<Vec<u16>>, String> {
        let name = wide(VALUE_NAME);
        let mut value_type = 0;
        // Fixed, bounded, correctly aligned buffer avoids a query-size/read race.
        let mut data = vec![0u16; MAX_VALUE_BYTES / 2];
        let mut byte_count = MAX_VALUE_BYTES as u32;
        // SAFETY: only our fixed value is queried; buffer capacity matches byte_count.
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                null(),
                &mut value_type,
                data.as_mut_ptr().cast(),
                &mut byte_count,
            )
        };
        match result {
            ERROR_FILE_NOT_FOUND => return Ok(None),
            ERROR_MORE_DATA => {
                return Err("La entrada de inicio de Nivo supera el límite permitido.".into())
            }
            ERROR_SUCCESS => {}
            code => return Err(registry_error("leer", code)),
        }
        if value_type != REG_SZ
            || byte_count < 2
            || byte_count as usize > MAX_VALUE_BYTES
            || !byte_count.is_multiple_of(2)
        {
            return Err("La entrada de inicio de Nivo tiene un formato no válido.".into());
        }
        data.truncate(byte_count as usize / 2);
        // RegQueryValueExW does not guarantee NUL termination, even for REG_SZ.
        if data.last() != Some(&0) || data[..data.len() - 1].contains(&0) {
            return Err("La entrada de inicio de Nivo no es una cadena válida.".into());
        }
        String::from_utf16(&data[..data.len() - 1])
            .map_err(|_| "La entrada de inicio de Nivo contiene UTF-16 no válido.".to_string())?;
        Ok(Some(data))
    }

    /// Whether this exact executable is registered. Windows may independently prevent startup.
    pub fn status() -> Result<bool, String> {
        let Some(key) = open(KEY_QUERY_VALUE)? else {
            return Ok(false);
        };
        let Some(command) = read_own_value(&key)? else {
            return Ok(false);
        };
        Ok(command == current_command()?)
    }

    /// Register the current executable, or remove only Nivo's own value. Never elevates rights.
    pub fn set_enabled(enabled: bool) -> Result<bool, String> {
        let name = wide(VALUE_NAME);
        if enabled {
            let command = current_command()?;
            let path = wide(RUN_KEY);
            let mut handle = null_mut();
            // SAFETY: fixed HKCU path, minimum write access, inherited default security.
            let result = unsafe {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    path.as_ptr(),
                    0,
                    null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE,
                    null(),
                    &mut handle,
                    null_mut(),
                )
            };
            if result != ERROR_SUCCESS {
                return Err(registry_error("registrar", result));
            }
            let key = RegistryKey(handle);
            // SAFETY: validated UTF-16 command includes its NUL; byte count fits the Run limit.
            let result = unsafe {
                RegSetValueExW(
                    key.0,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    command.as_ptr().cast(),
                    (command.len() * 2) as u32,
                )
            };
            if result != ERROR_SUCCESS {
                return Err(registry_error("guardar", result));
            }
        } else if let Some(key) = open(KEY_SET_VALUE)? {
            // SAFETY: only the constant Orvyn.Nivo value is removed; no keys or other apps.
            let result = unsafe { RegDeleteValueW(key.0, name.as_ptr()) };
            if result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND {
                return Err(registry_error("desactivar", result));
            }
        }
        status()
    }
}

#[cfg(windows)]
pub use windows::{set_enabled, status};

#[cfg(not(windows))]
pub fn status() -> Result<bool, String> {
    Err("El inicio automático de Nivo solo está disponible en Windows.".into())
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> Result<bool, String> {
    Err("El inicio automático de Nivo solo está disponible en Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::quote_executable;

    fn encode(path: &str) -> Vec<u16> {
        path.encode_utf16().collect()
    }

    #[test]
    fn quotes_spaces_unicode_and_only_the_executable() {
        let path = "C:\\Users\\Ángel\\Mi aplicación\\nivo-desktop.EXE";
        let command = quote_executable(&encode(path)).unwrap();
        assert_eq!(command.last(), Some(&0));
        assert_eq!(
            String::from_utf16(&command[..command.len() - 1]).unwrap(),
            format!("\"{path}\"")
        );
        assert_eq!(
            command
                .iter()
                .filter(|unit| **unit == u16::from(b'"'))
                .count(),
            2
        );
    }

    #[test]
    fn rejects_relative_network_device_shell_and_ambiguous_paths() {
        for path in [
            "nivo.exe",
            "C:nivo.exe",
            "\\nivo.exe",
            "C:\\nivo.cmd",
            "\\\\server\\share\\nivo.exe",
            "\\\\?\\C:\\nivo.exe",
            "\\\\.\\device.exe",
            "C:\\nivo.exe\" --argument",
            "C:\\nivo.exe\0",
            "C:\\bad\npath\\nivo.exe",
            "C:\\file.exe:other.exe",
            "C:\\folder\\..\\nivo.exe",
            "C:\\folder.\\nivo.exe",
        ] {
            assert!(
                quote_executable(&encode(path)).is_err(),
                "accepted {path:?}"
            );
        }
    }

    #[test]
    fn rejects_unpaired_utf16_surrogates() {
        let mut path = encode("C:\\");
        path.push(0xd800);
        path.extend(encode("\\nivo.exe"));
        assert!(quote_executable(&path).is_err());
    }

    #[test]
    fn run_limit_counts_utf16_units_quotes_and_terminator() {
        let accepted = format!("C:\\{}.exe", "a".repeat(250));
        assert_eq!(quote_executable(&encode(&accepted)).unwrap().len(), 260);
        let oversized = format!("C:\\{}.exe", "a".repeat(251));
        assert!(quote_executable(&encode(&oversized)).is_err());
        let supplementary = format!("C:\\{}.exe", "😀".repeat(126));
        assert!(quote_executable(&encode(&supplementary)).is_err());
    }
}

//! User-authored draft only. mailto cannot attach files or confirm delivery.
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub recipient: String,
    pub subject: String,
    pub body: String,
}
fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(byte as char)
        } else {
            use std::fmt::Write;
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}
fn uri(draft: &Draft) -> Result<String, String> {
    let invalid = || "Revisa el destinatario y la longitud del borrador.".to_string();
    let Some((local, domain)) = draft.recipient.split_once('@') else {
        return Err(invalid());
    };
    if draft.recipient.len() > 254
        || local.is_empty()
        || local.len() > 64
        || domain.is_empty()
        || local.starts_with('.')
        || local.ends_with('.')
        || draft.recipient.contains("..")
        || !local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
        || !domain
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
        || domain.starts_with('.')
        || domain.ends_with('.')
        || draft.subject.len() > 640
        || draft.subject.chars().any(char::is_control)
        || draft.body.len() > 6000
        || draft
            .body
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
    {
        return Err(invalid());
    }
    let value = format!(
        "mailto:{}?subject={}&body={}",
        encode(&draft.recipient),
        encode(&draft.subject),
        encode(&draft.body)
    );
    if value.len() > 8192 {
        return Err("El borrador es demasiado largo para el cliente de correo.".into());
    }
    Ok(value)
}
pub fn open(draft: Draft, owner: isize) -> Result<(), String> {
    let value = uri(&draft)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let action: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let target: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        // SAFETY: finite validated mailto, owned HWND and live UTF-16 buffers.
        let result = unsafe {
            ShellExecuteW(
                owner as _,
                action.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            return Err("Windows no pudo abrir el cliente de correo. Comprueba tu aplicación predeterminada.".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (value, owner);
        Err("Requiere Nivo para Windows.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn draft_escapes_unicode_headers_and_never_adds_attachment_parameters() {
        let draft = Draft {
            recipient: "name+fixture@example.com".into(),
            subject: "Diseño & revisión".into(),
            body: "Hola\nAdjunta el archivo manualmente.".into(),
        };
        let result = uri(&draft).unwrap();
        assert!(result.contains("Dise%C3%B1o%20%26%20revisi%C3%B3n"));
        assert!(result.contains("%0A"));
        assert!(!result.contains("attach="));
        for recipient in [
            "a@example.com?bcc=other",
            "a@example.com\r\nBcc:x@y",
            "a@b@c",
            "",
            "file:///x",
        ] {
            assert!(uri(&Draft {
                recipient: recipient.into(),
                subject: String::new(),
                body: String::new()
            })
            .is_err())
        }
    }
}

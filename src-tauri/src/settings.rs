use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const SCHEMA_VERSION: u8 = 1;
const MAX_SETTINGS_BYTES: u64 = 16 * 1024;
fn battery_thresholds() -> [u8; 3] {
    [20, 10, 5]
}
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Motion {
    #[default]
    System,
    Reduced,
    Full,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u8,
    pub theme: Theme,
    pub motion: Motion,
    pub mascot_enabled: bool,
    pub privacy_mode: bool,
    pub media_enabled: bool,
    #[serde(default)]
    pub audio_enabled: bool,
    #[serde(default)]
    pub battery_enabled: bool,
    #[serde(default)]
    pub battery_full_notice: bool,
    #[serde(default)]
    pub caps_lock_enabled: bool,
    #[serde(default)]
    pub num_lock_enabled: bool,
    #[serde(default)]
    pub integrations_enabled: bool,
    #[serde(default = "battery_thresholds")]
    pub battery_thresholds: [u8; 3],
    pub notifications_enabled: bool,
    pub hide_in_fullscreen: bool,
    pub monitor_name: Option<String>,
    pub horizontal_position: f64,
    pub top_gap: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            theme: Theme::System,
            motion: Motion::System,
            mascot_enabled: true,
            privacy_mode: true,
            media_enabled: true,
            audio_enabled: false,
            battery_enabled: false,
            battery_full_notice: false,
            caps_lock_enabled: false,
            num_lock_enabled: false,
            integrations_enabled: false,
            battery_thresholds: battery_thresholds(),
            notifications_enabled: true,
            hide_in_fullscreen: true,
            monitor_name: None,
            horizontal_position: 0.5,
            top_gap: 8,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        let [low, important, critical] = self.battery_thresholds;
        if low > 80 || critical == 0 || !(critical < important && important < low) {
            return Err(
                "Umbrales de batería no válidos: usa crítica < importante < baja (1–80 %).".into(),
            );
        }
        if self.schema_version != SCHEMA_VERSION {
            return Err(
                "Versión de preferencias no compatible; se conserva el archivo original.".into(),
            );
        }
        if !self.horizontal_position.is_finite() || !(0.0..=1.0).contains(&self.horizontal_position)
        {
            return Err("La posición horizontal debe estar entre 0 y 1.".into());
        }
        if self.top_gap > 128 {
            return Err("La separación superior debe estar entre 0 y 128 DIP.".into());
        }
        if let Some(name) = &self.monitor_name {
            if name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
                return Err("Identificador de pantalla no válido.".into());
            }
        }
        Ok(())
    }
}

fn decode(bytes: &[u8]) -> Result<Settings, String> {
    // Version is checked before deserializing the payload so future migrations
    // cannot accidentally interpret an unknown schema as the current format.
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("Preferencias JSON no válidas: {error}"))?;
    if value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(u64::from(SCHEMA_VERSION))
    {
        return Err(
            "Versión de preferencias no compatible; se conserva el archivo original.".into(),
        );
    }
    let settings: Settings = serde_json::from_value(value)
        .map_err(|error| format!("Formato de preferencias no válido: {error}"))?;
    settings.validate()?;
    Ok(settings)
}

pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<Settings>,
    // A load error must be surfaced to the UI, rather than silently pretending
    // that persisted preferences were restored.
    load_error: Option<String>,
}

impl SettingsStore {
    pub fn open(path: PathBuf) -> Self {
        match read_file(&path) {
            Ok(settings) => Self {
                path: Some(path),
                current: Mutex::new(settings),
                load_error: None,
            },
            Err(error) => Self {
                path: Some(path),
                current: Mutex::new(Settings::default()),
                load_error: Some(error),
            },
        }
    }

    pub fn unavailable(error: String) -> Self {
        Self {
            path: None,
            current: Mutex::new(Settings::default()),
            load_error: Some(error),
        }
    }

    pub fn snapshot(&self) -> Result<Settings, String> {
        self.current
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "No se pudo acceder a las preferencias.".into())
    }

    pub fn load_error(&self) -> Option<&str> {
        self.load_error.as_deref()
    }

    pub fn save(&self, settings: Settings) -> Result<Settings, String> {
        settings.validate()?;
        let path = self
            .path
            .as_ref()
            .ok_or("El directorio de preferencias no está disponible.")?;
        let mut current = self
            .current
            .lock()
            .map_err(|_| "No se pudo acceder a las preferencias.")?;
        atomic_write(path, &settings)?;
        *current = settings.clone();
        Ok(settings)
    }
}

fn read_file(path: &Path) -> Result<Settings, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::default())
        }
        Err(error) => return Err(format!("No se pudieron leer las preferencias: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("No se pudieron leer las preferencias: {error}"))?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("El archivo de preferencias supera el límite de 16 KiB.".into());
    }
    decode(&bytes)
}

fn atomic_write(path: &Path, settings: &Settings) -> Result<(), String> {
    let parent = path.parent().ok_or("Ruta de preferencias no válida.")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("No se pudo preparar el directorio de preferencias: {error}"))?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    let (temporary, mut file) = create_temporary(parent)?;
    let result = (|| -> Result<(), String> {
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("No se pudieron guardar las preferencias: {error}"))?;
        drop(file);
        replace_file(&temporary, path)
            .map_err(|error| format!("No se pudieron sustituir las preferencias: {error}"))
    })();
    if result.is_err() {
        // Only our own temporary file is eligible for cleanup. The destination
        // is never removed before replacement.
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn create_temporary(parent: &Path) -> Result<(PathBuf, File), String> {
    for _ in 0..16 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".settings-{}-{sequence}.tmp", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("No se pudo crear el archivo temporal: {error}")),
        }
    }
    Err("No se pudo reservar un archivo temporal de preferencias.".into())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both buffers are owned, NUL-terminated UTF-16 paths valid until
    // the synchronous call returns. Both files are in the same directory.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> PathBuf {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "nivo-settings-test-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn defaults_round_trip_without_unknown_fields() {
        let expected = Settings::default();
        assert_eq!(
            decode(&serde_json::to_vec(&expected).unwrap()).unwrap(),
            expected
        );
        let mut json = serde_json::to_value(expected).unwrap();
        json["shell_command"] = serde_json::json!("untrusted");
        assert!(decode(&serde_json::to_vec(&json).unwrap()).is_err());
    }

    #[test]
    fn older_settings_keep_existing_choices_without_enabling_audio() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("audio_enabled");
        value["mascot_enabled"] = serde_json::json!(false);
        let settings = decode(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(!settings.audio_enabled);
        assert!(!settings.mascot_enabled);
    }

    #[test]
    fn rejects_unsupported_schema_invalid_geometry_and_monitor_names() {
        let mut settings = Settings {
            schema_version: 2,
            ..Settings::default()
        };
        assert!(settings.validate().is_err());
        assert!(decode(&serde_json::to_vec(&settings).unwrap()).is_err());
        settings.schema_version = 1;
        settings.horizontal_position = f64::NAN;
        assert!(settings.validate().is_err());
        settings.horizontal_position = 0.5;
        settings.top_gap = 129;
        assert!(settings.validate().is_err());
        settings.top_gap = 8;
        settings.monitor_name = Some("display\nname".into());
        assert!(settings.validate().is_err());
    }

    #[test]
    fn replaces_existing_settings_and_restores_them_from_disk() {
        let directory = directory();
        let path = directory.join("settings.json");
        let store = SettingsStore::open(path.clone());
        let mut settings = Settings::default();
        store.save(settings.clone()).unwrap();
        settings.motion = Motion::Reduced;
        settings.monitor_name = Some("DISPLAY2".into());
        store.save(settings.clone()).unwrap();
        assert_eq!(
            SettingsStore::open(path.clone()).snapshot().unwrap(),
            settings
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn preserves_invalid_file_and_reports_load_error() {
        let directory = directory();
        let path = directory.join("settings.json");
        fs::write(&path, b"{ broken").unwrap();
        let store = SettingsStore::open(path.clone());
        assert!(store.load_error().is_some());
        assert_eq!(store.snapshot().unwrap(), Settings::default());
        assert_eq!(fs::read(&path).unwrap(), b"{ broken");
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn failed_write_keeps_runtime_settings_unchanged() {
        let directory = directory();
        let blocker = directory.join("file");
        fs::write(&blocker, b"not a directory").unwrap();
        let store = SettingsStore::open(blocker.join("settings.json"));
        let changed = Settings {
            privacy_mode: false,
            ..Settings::default()
        };
        assert!(store.save(changed).is_err());
        assert_eq!(store.snapshot().unwrap(), Settings::default());
        assert_eq!(fs::read(&blocker).unwrap(), b"not a directory");
        fs::remove_file(blocker).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn rejects_oversized_file_without_truncating_it() {
        let directory = directory();
        let path = directory.join("settings.json");
        fs::write(&path, vec![b' '; MAX_SETTINGS_BYTES as usize + 1]).unwrap();
        let store = SettingsStore::open(path.clone());
        assert!(store.load_error().unwrap().contains("16 KiB"));
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_SETTINGS_BYTES + 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}

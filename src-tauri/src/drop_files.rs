//! File capabilities originate only from a native drop, never a webview path.
use crate::actions::{ActionResult, Operation, Operations, Progress};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub id: String,
    pub name: String,
    pub size: u64,
}
#[derive(Clone)]
struct Entry {
    public: DroppedFile,
    path: PathBuf,
}
#[derive(Default)]
pub struct DropFiles {
    serial: AtomicU64,
    generation: AtomicU64,
    entries: Mutex<Vec<Entry>>,
    results: Mutex<Vec<Entry>>,
    pub operations: Operations,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DropAction {
    CopyPath,
    OpenFolder,
    Copy,
    Zip,
}
fn local_file(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
            && path.is_absolute()
    }
    #[cfg(not(windows))]
    {
        path.is_absolute()
    }
}
impl DropFiles {
    pub fn clear(&self) {
        self.operations.cancel_all();
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
        if let Ok(mut results) = self.results.lock() {
            self.generation.fetch_add(1, Ordering::AcqRel);
            results.clear();
        }
    }
    pub fn accept(&self, paths: &[PathBuf]) -> Result<Vec<DroppedFile>, String> {
        if self.operations.busy() {
            return Err("Espera o cancela la operación antes de soltar otros archivos.".into());
        }
        if paths.is_empty() || paths.len() > 16 {
            return Err("Suelta entre 1 y 16 archivos locales.".into());
        }
        let batch = self.serial.fetch_add(1, Ordering::Relaxed);
        let mut accepted = vec![];
        for (index, requested) in paths.iter().enumerate() {
            if !local_file(requested) {
                return Err(
                    "Nivo Drop acepta archivos de unidades locales, no rutas de red.".into(),
                );
            }
            let path = requested
                .canonicalize()
                .map_err(|_| "El archivo no está disponible.".to_string())?;
            if !local_file(&path) {
                return Err("La ruta de destino no es local.".into());
            }
            let metadata = std::fs::metadata(&path)
                .map_err(|_| "No se pudo leer la información del archivo.".to_string())?;
            if !metadata.is_file() {
                return Err(
                    "Por ahora, suelta archivos individuales; las carpetas no se modifican.".into(),
                );
            }
            let name = path
                .file_name()
                .ok_or("Nombre de archivo no disponible.")?
                .to_string_lossy()
                .into_owned();
            if name.chars().any(char::is_control) {
                return Err("Nombre de archivo no compatible.".into());
            }
            accepted.push(Entry {
                public: DroppedFile {
                    id: format!("drop:{batch}:{index}"),
                    name,
                    size: metadata.len(),
                },
                path,
            });
        }
        let snapshot = accepted.iter().map(|entry| entry.public.clone()).collect();
        *self
            .entries
            .lock()
            .map_err(|_| "Nivo Drop no está disponible.".to_string())? = accepted;
        Ok(snapshot)
    }
    pub fn snapshot(&self) -> Result<Vec<DroppedFile>, String> {
        self.entries
            .lock()
            .map(|entries| entries.iter().map(|entry| entry.public.clone()).collect())
            .map_err(|_| "Nivo Drop no está disponible.".into())
    }
    pub fn action(
        &self,
        action: DropAction,
        id: Option<String>,
        owner: isize,
        notify: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Result<ActionResult, String> {
        let operation = self.operations.begin(notify)?;
        let generation = self.generation.load(Ordering::Acquire);
        let entries = self
            .entries
            .lock()
            .map_err(|_| "Nivo Drop no está disponible.".to_string())?
            .clone();
        if entries.is_empty() {
            return Err("Suelta primero un archivo en Nivo.".into());
        }
        let results = self
            .results
            .lock()
            .map_err(|_| "Resultado no disponible.")?
            .clone();
        let selected = id.as_ref().and_then(|id| {
            entries
                .iter()
                .chain(results.iter())
                .find(|entry| &entry.public.id == id)
        });
        if (id.is_some() || !matches!(action, DropAction::Zip)) && selected.is_none() {
            return Err("Archivo no autorizado por esta operación de arrastre.".into());
        }
        #[cfg(windows)]
        {
            match action {
                DropAction::CopyPath => {
                    windows::copy_path(&selected.unwrap().path, owner)?;
                    Ok(operation.result("Ruta copiada.", None))
                }
                DropAction::OpenFolder => {
                    windows::open_folder(&selected.unwrap().path, owner)?;
                    Ok(operation.result("Carpeta abierta.", None))
                }
                DropAction::Copy => {
                    let source = selected.unwrap();
                    operation.progress("destination", 0, None);
                    let Some(destination) = windows::save_destination(&source.public.name, owner)?
                    else {
                        return Ok(crate::actions::ActionResult {
                            operation_id: operation.id.clone(),
                            outcome: "cancelled",
                            message: "Copia cancelada.".into(),
                            file: None,
                        });
                    };
                    let result = copy_new_progress(&source.path, &destination, Some(&operation));
                    if let Err(error) = result {
                        if operation.cancelled() {
                            return Ok(
                                operation.result("Copia cancelada. El original se conserva.", None)
                            );
                        }
                        return Err(error);
                    }
                    let file = self.register_result(destination, generation)?;
                    Ok(operation.result("Copia guardada. El original se conserva.", Some(file)))
                }
                DropAction::Zip => {
                    operation.progress("destination", 0, None);
                    let Some(destination) = windows::save_destination("Nivo.zip", owner)? else {
                        return Ok(crate::actions::ActionResult {
                            operation_id: operation.id.clone(),
                            outcome: "cancelled",
                            message: "ZIP cancelado.".into(),
                            file: None,
                        });
                    };
                    let selected_entries = if let Some(entry) = selected {
                        vec![entry.clone()]
                    } else {
                        entries
                    };
                    let result =
                        zip_new_progress(&selected_entries, &destination, Some(&operation));
                    if let Err(error) = result {
                        if operation.cancelled() {
                            return Ok(operation
                                .result("ZIP cancelado. Los originales se conservan.", None));
                        }
                        return Err(error);
                    }
                    let file = self.register_result(destination, generation)?;
                    Ok(operation.result("ZIP comprimido creado. Originales intactos.", Some(file)))
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (owner, selected, operation);
            Err("Requiere Windows.".into())
        }
    }
    fn register_result(&self, path: PathBuf, generation: u64) -> Result<DroppedFile, String> {
        let size = std::fs::metadata(&path)
            .map_err(|_| "No se pudo comprobar el resultado.")?
            .len();
        let name = path
            .file_name()
            .ok_or("Nombre no disponible.")?
            .to_string_lossy()
            .into_owned();
        let public = DroppedFile {
            id: format!("drop:{}:0", self.serial.fetch_add(1, Ordering::Relaxed)),
            name,
            size,
        };
        let mut results = self
            .results
            .lock()
            .map_err(|_| "Resultado no disponible.")?;
        if self.generation.load(Ordering::Acquire) != generation {
            return Err(
                "La operación se ha revocado. El destino elegido puede haberse completado.".into(),
            );
        }
        if results.len() >= 16 {
            results.remove(0);
        }
        results.push(Entry {
            public: public.clone(),
            path,
        });
        Ok(public)
    }
}
#[cfg(test)]
fn copy_new(source: &Path, destination: &Path) -> Result<(), String> {
    copy_new_progress(source, destination, None)
}
fn copy_new_progress(
    source: &Path,
    destination: &Path,
    operation: Option<&Operation<'_>>,
) -> Result<(), String> {
    if !local_file(destination) {
        return Err("Elige un destino local.".into());
    }
    let mut input = std::fs::File::open(source)
        .map_err(|_| "El archivo de origen ya no está disponible.".to_string())?;
    let metadata = input
        .metadata()
        .map_err(|_| "El origen no está disponible.")?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
        return Err("Elige un archivo de hasta 512 MiB.".into());
    }
    let total = metadata.len();
    let mut output = std::fs::File::create_new(destination).map_err(|_| {
        "No se creó el destino. No se sobrescriben archivos existentes.".to_string()
    })?;
    let result = stream_copy(&mut input, &mut output, 0, Some(total), operation).and_then(|_| {
        if let Some(op) = operation {
            op.check()?;
            op.progress("finalizing", total, Some(total));
        }
        output
            .sync_all()
            .map_err(|_| "No se pudo confirmar la copia.".to_string())
    });
    drop(output);
    if let Err(error) = result {
        let _ = std::fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}
fn stream_copy(
    input: &mut impl std::io::Read,
    output: &mut impl std::io::Write,
    initial: u64,
    total: Option<u64>,
    operation: Option<&Operation<'_>>,
) -> Result<u64, String> {
    let mut buffer = vec![0u8; 256 * 1024];
    let mut copied = 0u64;
    loop {
        if let Some(op) = operation {
            op.check()?;
        }
        let read = input
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo de origen.")?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| "No se pudo escribir el destino. Comprueba el espacio y los permisos.")?;
        copied += read as u64;
        if initial + copied > 512 * 1024 * 1024 {
            return Err("La operación supera el límite de 512 MiB.".into());
        }
        if let Some(op) = operation {
            op.progress(
                "running",
                initial + copied,
                total.filter(|v| *v >= initial + copied),
            );
        }
    }
    Ok(copied)
}
#[cfg(test)]
fn zip_new(entries: &[Entry], destination: &Path) -> Result<(), String> {
    zip_new_progress(entries, destination, None)
}
fn zip_new_progress(
    entries: &[Entry],
    destination: &Path,
    operation: Option<&Operation<'_>>,
) -> Result<(), String> {
    if !local_file(destination) {
        return Err("Elige un destino local.".into());
    }
    const LIMIT: u64 = 512 * 1024 * 1024;
    if entries
        .iter()
        .try_fold(0_u64, |sum, entry| sum.checked_add(entry.public.size))
        .is_none_or(|sum| sum > LIMIT)
    {
        return Err("Esta versión admite hasta 512 MiB por ZIP.".into());
    }
    let total = entries
        .iter()
        .try_fold(0u64, |sum, entry| {
            std::fs::metadata(&entry.path)
                .ok()
                .and_then(|m| sum.checked_add(m.len()))
        })
        .ok_or("Un archivo ya no está disponible.")?;
    if total > LIMIT {
        return Err("Esta versión admite hasta 512 MiB por ZIP.".into());
    }
    let output = std::fs::File::create_new(destination)
        .map_err(|_| "No se creó el ZIP. No se sobrescriben archivos existentes.".to_string())?;
    let result = (|| -> Result<(), String> {
        let mut archive = zip::ZipWriter::new(output);
        let mut names = std::collections::HashSet::new();
        let mut copied = 0;
        for entry in entries {
            let mut name = entry.public.name.clone();
            let mut suffix = 1;
            while !names.insert(name.clone()) {
                name = format!("{suffix}_{}", entry.public.name);
                suffix += 1;
            }
            archive
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated)
                        .compression_level(Some(3)),
                )
                .map_err(|_| "No se pudo preparar una entrada ZIP.".to_string())?;
            let mut input = std::fs::File::open(&entry.path)
                .map_err(|_| "Un archivo ya no está disponible.".to_string())?;
            copied += stream_copy(&mut input, &mut archive, copied, Some(total), operation)?;
            if copied > LIMIT {
                return Err("El tamaño real supera el límite de 512 MiB por ZIP.".into());
            }
        }
        if let Some(op) = operation {
            op.check()?;
            op.progress("finalizing", copied, Some(total));
        }
        archive
            .finish()
            .map_err(|_| "No se pudo finalizar el ZIP.".to_string())?
            .sync_all()
            .map_err(|_| "No se pudo guardar el ZIP.".to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}

#[cfg(windows)]
mod windows {
    use super::*;
    pub fn save_destination(name: &str, owner: isize) -> Result<Option<PathBuf>, String> {
        use ::windows::{
            core::PCWSTR,
            Win32::{
                Foundation::HWND,
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                    COINIT_APARTMENTTHREADED,
                },
                UI::Shell::{
                    FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT,
                    FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
                },
            },
        };
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
            .map_err(|_| "No se pudo abrir el selector de destino.".to_string())?;
        let _apartment = Apartment;
        let result = || -> ::windows::core::Result<Option<PathBuf>> {
            unsafe {
                let dialog: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_ALL)?;
                let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
                dialog.SetFileName(PCWSTR(name.as_ptr()))?;
                dialog.SetOptions(
                    (dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
                        & !FOS_OVERWRITEPROMPT,
                )?;
                if let Err(error) = dialog.Show(Some(HWND(owner as *mut _))) {
                    if error.code().0 as u32 == 0x800704c7 {
                        return Ok(None);
                    }
                    return Err(error);
                }
                let path = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let result = path.to_string();
                CoTaskMemFree(Some(path.0.cast()));
                Ok(Some(PathBuf::from(result?)))
            }
        };
        result().map_err(|_| "No se pudo elegir un destino local.".into())
    }
    pub fn open_folder(path: &Path, owner: isize) -> Result<(), String> {
        use ::windows::{
            core::PCWSTR,
            Win32::{
                Foundation::HWND,
                UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
            },
        };
        let parent = path.parent().ok_or("Carpeta no disponible.")?;
        let normal = parent.to_string_lossy();
        let normal = normal.strip_prefix(r"\\?\").unwrap_or(&normal);
        let wide: Vec<u16> = normal.encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                Some(HWND(owner as *mut _)),
                ::windows::core::w!("open"),
                PCWSTR(wide.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("No se pudo abrir la carpeta contenedora.".into());
        }
        Ok(())
    }
    pub fn copy_path(path: &Path, owner: isize) -> Result<(), String> {
        use windows_sys::Win32::{
            Foundation::GlobalFree,
            System::{
                DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            },
        };
        let path = path.to_string_lossy();
        let path = path.strip_prefix(r"\\?\").unwrap_or(&path);
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        struct Clipboard;
        impl Drop for Clipboard {
            fn drop(&mut self) {
                unsafe {
                    CloseClipboard();
                }
            }
        }
        unsafe {
            if OpenClipboard(owner as *mut _) == 0 {
                return Err("El portapapeles está ocupado.".into());
            }
            let _clipboard = Clipboard;
            let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
            if memory.is_null() {
                return Err("No se pudo preparar la ruta.".into());
            }
            let destination = GlobalLock(memory);
            if destination.is_null() {
                GlobalFree(memory);
                return Err("No se pudo preparar la ruta.".into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), destination.cast(), wide.len());
            GlobalUnlock(memory);
            if EmptyClipboard() == 0 || SetClipboardData(13, memory).is_null() {
                GlobalFree(memory);
                return Err("No se pudo copiar la ruta.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deflate_cancel_revocation_unicode_and_no_overwrite() {
        let directory =
            std::env::temp_dir().join(format!("nivo-actions-test-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let source = directory.join("diseño-ñ.txt");
        std::fs::write(&source, vec![b'x'; 1024 * 1024]).unwrap();
        let files = DropFiles::default();
        let snapshot = files.accept(std::slice::from_ref(&source)).unwrap();
        assert!(files
            .action(DropAction::Zip, Some("foreign".into()), 0, |_| {})
            .is_err());
        let destination = directory.join("comprimido.zip");
        zip_new(&files.entries.lock().unwrap(), &destination).unwrap();
        assert!(std::fs::metadata(&destination).unwrap().len() < 10_000);
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&destination).unwrap()).unwrap();
        assert_eq!(
            archive.by_index(0).unwrap().compression(),
            zip::CompressionMethod::Deflated
        );
        drop(archive);
        assert!(zip_new(&files.entries.lock().unwrap(), &destination).is_err());
        let operations = Operations::default();
        let op = operations.begin(|_| {}).unwrap();
        operations.cancel(&op.id).unwrap();
        let cancelled = directory.join("cancelada.txt");
        assert!(copy_new_progress(&source, &cancelled, Some(&op)).is_err());
        assert!(!cancelled.exists());
        let gen = files.generation.load(Ordering::Acquire);
        files.clear();
        assert!(files.register_result(destination.clone(), gen).is_err());
        assert!(files
            .action(
                DropAction::CopyPath,
                Some(snapshot[0].id.clone()),
                0,
                |_| {}
            )
            .is_err());
        assert_eq!(std::fs::metadata(&source).unwrap().len(), 1024 * 1024);
        std::fs::remove_file(source).unwrap();
        std::fs::remove_file(destination).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn drop_requires_native_capabilities_and_never_overwrites_originals() {
        let directory = std::env::temp_dir().join(format!("nivo-drop-test-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let source = directory.join("source.txt");
        std::fs::write(&source, b"original").unwrap();
        let files = DropFiles::default();
        assert!(files.accept(std::slice::from_ref(&directory)).is_err());
        let snapshot = files.accept(std::slice::from_ref(&source)).unwrap();
        assert_eq!(snapshot.len(), 1);
        assert!(files
            .action(DropAction::CopyPath, Some("untrusted".into()), 0, |_| {})
            .is_err());
        assert!(copy_new(&source, &source).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"original");
        let target = directory.join("copy.txt");
        copy_new(&source, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        let archive = directory.join("files.zip");
        zip_new(&files.entries.lock().unwrap(), &archive).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&archive).unwrap()).unwrap();
        assert_eq!(zip.len(), 1);
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut zip.by_index(0).unwrap(), &mut contents).unwrap();
        assert_eq!(contents, "original");
        drop(zip);
        for path in [source, target, archive] {
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_dir(directory).unwrap();
    }
}

@echo off
setlocal
cd /d "%~dp0.."
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo Nivo by Orvyn - dependencias de desarrollo
call npm ci --no-fund
if errorlevel 1 exit /b 1
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
if errorlevel 1 exit /b 1
echo Dependencias preparadas. Puedes volver a Codex.

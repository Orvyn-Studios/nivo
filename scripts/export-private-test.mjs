import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const inputs = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'src-tauri/src', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json', 'src-tauri/capabilities'];
if (git('status', '--porcelain', '--untracked-files=all', '--', ...inputs)) {
  throw new Error('Commit the reviewed application sources before exporting a traceable test build.');
}
const source = path.join(root, 'src-tauri', 'target', 'release', 'nivo-desktop.exe');
const builtFile = await stat(source);
const tracked = execFileSync('git', ['ls-files', '-z', '--', ...inputs], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
for (const input of tracked) {
  if ((await stat(path.join(root, input))).mtimeMs > builtFile.mtimeMs) {
    throw new Error(`Executable predates ${input}. Complete npm run build before exporting.`);
  }
}
const binary = await readFile(source);
const header = binary.length >= 64 ? binary.readUInt32LE(0x3c) : -1;
if (binary.toString('ascii', 0, 2) !== 'MZ' || header < 0 || header + 6 > binary.length ||
  binary.toString('ascii', header, header + 4) !== 'PE\0\0' || binary.readUInt16LE(header + 4) !== 0x8664) {
  throw new Error('Expected a compiled Windows x64 PE executable.');
}
const commit = git('rev-parse', 'HEAD');
const sha256 = createHash('sha256').update(binary).digest('hex');
// Use a unique path so a previous running test executable never blocks the next build.
const output = path.join(root, 'artifacts', 'private-test', `${commit.slice(0, 8)}-${sha256.slice(0, 8)}`);
await mkdir(output, { recursive: true });
const executable = path.join(output, 'Nivo.exe');
let existing;
try { existing = await readFile(executable); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing && createHash('sha256').update(existing).digest('hex') !== sha256) {
  throw new Error('Destination contains a different executable; refusing to overwrite it.');
}
if (!existing) await copyFile(source, executable);
const manifest = {
  schemaVersion: 1, status: 'private-test-not-beta-accepted', commit, sha256,
  bytes: binary.length, builtFileModifiedUtc: builtFile.mtime.toISOString(),
  exportedUtc: new Date().toISOString(), platform: 'Windows x64 + WebView2',
  sourceBranch: 'feature/nivo-mvp',
  runtimeAcceptance: 'Pending for this exact build. No CPU/RAM/FPS claims.',
};
await writeFile(path.join(output, 'build.json'), JSON.stringify(manifest, null, 2));
await writeFile(path.join(output, 'LEEME.txt'), [
  'Nivo by Orvyn — prueba privada de desarrollo',
  '',
  'Abre Nivo.exe en Windows x64 con WebView2 instalado. No necesita Node, Rust ni Vite para ejecutarse.',
  'No es una beta aceptada: faltan revisión visual, clics durante transición, sombra y medidas reales de rendimiento.',
  'La mascota se activa en Preferencias > Compañero de Nivo. Una preferencia anterior desactivada se respeta.',
  'La música necesita una sesión GSMTC compatible. No hay notificaciones ajenas ni agentes simulados.',
  'Puedes salir desde la bandeja o Preferencias. No habilita inicio automático por defecto.',
  '',
  `Fuente: ${commit}`, `SHA256: ${sha256}`, '',
  'La última prueba Cargo completa quedó bloqueada al ejecutar su harness vacío de main (4551); las 39 pruebas de biblioteca pasaron.',
  'No cambies protecciones de Windows para probar esta build. Consulta docs/VALIDATION.md en el repositorio.',
].join('\r\n'), 'utf8');
await copyFile(path.join(root, 'public', 'licenses', 'coucou-MIT.txt'), path.join(output, 'coucou-MIT.txt'));
console.log(JSON.stringify({ executable, ...manifest }, null, 2));

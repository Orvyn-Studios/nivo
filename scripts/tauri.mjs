import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
if (!existsSync(cli)) throw new Error('Falta la CLI local de Nivo. Ejecuta scripts/setup-windows.cmd.');
const cargoBin = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin');
const environment = { ...process.env };
if (existsSync(cargoBin)) environment.PATH = `${cargoBin}${path.delimiter}${process.env.PATH ?? ''}`;
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root, env: environment, shell: false, windowsHide: true, stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

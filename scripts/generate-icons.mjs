import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Use the installed, locked Tauri CLI. Generated platform extras stay in ignored artifacts.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'assets', 'brand', 'nivo-icon.svg');
const generated = path.join(root, 'artifacts', 'brand-icons');
const destination = path.join(root, 'src-tauri', 'icons');
mkdirSync(generated, { recursive: true });
mkdirSync(destination, { recursive: true });

const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
  'icon', source, '--output', generated,
], { cwd: root, stdio: 'inherit', windowsHide: true, shell: false });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Tauri icon generation failed (${result.status}).`);

const ico = readFileSync(path.join(generated, 'icon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
  throw new Error('Generated icon has an invalid ICO header.');
}
const count = ico.readUInt16LE(4);
if (ico.length < 6 + count * 16) throw new Error('Generated ICO directory is truncated.');
const sizes = [];
for (let i = 0; i < count; i++) {
  const offset = 6 + i * 16;
  const width = ico[offset] || 256;
  const height = ico[offset + 1] || 256;
  const length = ico.readUInt32LE(offset + 8);
  const start = ico.readUInt32LE(offset + 12);
  if (width !== height || start < 6 + count * 16 || start + length > ico.length) {
    throw new Error('Generated ICO contains an invalid image directory.');
  }
  sizes.push(width);
}
for (const required of [16, 32, 48, 256]) {
  if (!sizes.includes(required)) throw new Error(`Generated ICO is missing ${required}px.`);
}

const png = readFileSync(path.join(generated, 'icon.png'));
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) {
  throw new Error('Generated PNG must be a valid 512 by 512 icon.');
}

for (const name of ['icon.ico', 'icon.png']) {
  copyFileSync(path.join(generated, name), path.join(destination, name));
}
console.log(`Nivo icons verified: ICO ${sizes.join('/')}px; PNG 512x512.`);

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const webOnly = process.argv.includes('--web-only');
if (process.argv.slice(2).some(argument => argument !== '--web-only')) throw new Error('Only --web-only is supported.');
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error('Run with npm run verify or npm run verify:web.');
const cargoBin = path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin');
const environment = { ...process.env, PATH: `${cargoBin}${path.delimiter}${process.env.PATH ?? ''}` };
const cargo = process.platform === 'win32' ? path.join(cargoBin, 'cargo.exe') : 'cargo';
const manifest = ['--manifest-path', 'src-tauri/Cargo.toml'];
const npm = (id, script) => ({ id, executable: process.execPath, args: [npmCli, 'run', script] });
const steps = [npm('unit', 'test'), npm('web-build', 'build:web')];
if (!webOnly) steps.push(
  { id: 'rustfmt', executable: cargo, args: ['fmt', ...manifest, '--check'] },
  { id: 'rust-tests', executable: cargo, args: ['test', '--locked', ...manifest] },
  { id: 'clippy', executable: cargo, args: ['clippy', '--locked', ...manifest, '--all-targets', '--', '-D', 'warnings'] },
  npm('desktop-build', 'build'),
);
const report = { schemaVersion: 1, scope: webOnly ? 'web' : 'desktop-build', status: 'running', startedUtc: new Date().toISOString(), node: process.version, steps: [] };
const reportPath = path.join(artifacts, webOnly ? 'verify-web.json' : 'verify-desktop.json');

function run(step) {
  console.log(`\nNivo verification: ${step.id}`);
  return new Promise(resolve => {
    const log = createWriteStream(path.join(artifacts, `verify-${step.id}.log`));
    const startedAt = performance.now();
    const child = spawn(step.executable, step.args, { cwd: root, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let launchError;
    child.on('error', error => { launchError = error.message; console.error(error.message); log.write(error.message); });
    child.stdout.on('data', data => { process.stdout.write(data); log.write(data); });
    child.stderr.on('data', data => { process.stderr.write(data); log.write(data); });
    child.on('close', (code, signal) => log.end(() => resolve({ id: step.id, status: code === 0 && !launchError ? 'passed' : 'failed', exitCode: code, signal, durationMs: Math.round(performance.now() - startedAt), ...(launchError ? { error: launchError } : {}) })));
  });
}

await writeFile(reportPath, JSON.stringify(report, null, 2));
for (const step of steps) {
  const result = await run(step);
  report.steps.push(result);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  if (result.status === 'failed') { report.status = 'failed'; process.exitCode = 1; break; }
}
if (report.status !== 'failed') report.status = 'passed';
report.finishedUtc = new Date().toISOString();
report.limits = 'Build verification only. Browser, native focus/input/tray/fullscreen/media and CPU/RAM acceptance are separate checks.';
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Verification ${report.status} (${report.scope}). Report: ${reportPath}`);

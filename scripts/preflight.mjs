import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const isPresent = async file => {
  try { await access(file, constants.F_OK); return true; }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
};
const runVersion = async (file, args) => {
  const result = await execute(file, args, {
    timeout: 10000, windowsHide: true, maxBuffer: 256 * 1024,
    env: { ...process.env, RUSTUP_AUTO_INSTALL: '0', CARGO_NET_OFFLINE: 'true' }
  });
  return result.stdout.trim();
};

export function supportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  return major >= 24;
}

function versionOrder(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export async function inspectPrerequisites(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const executable = options.execPath ?? process.execPath;
  const exists = options.exists ?? isPresent;
  const list = options.readdir ?? readdir;
  const run = options.run ?? runVersion;
  const nodeVersion = options.nodeVersion ?? process.version;
  const checks = [];
  const add = (id, status, detail, extra = {}) => checks.push({ id, status, detail, ...extra });

  add('node', supportedNode(nodeVersion) ? 'ok' : 'missing', `Node ${nodeVersion}; requiere >=24.0.0 para las pruebas TypeScript nativas.`, { path: executable });
  const npmCli = path.join(path.dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  try {
    if (await exists(npmCli)) {
      const version = await run(executable, [npmCli, '--version']);
      if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw Error('La salida no contiene una versión npm reconocible.');
      add('npm', 'ok', `npm ${version}`, { path: npmCli });
    } else add('npm', 'missing', 'No se encontró npm-cli.js junto a Node. Instala Node con npm o comprueba su instalación.');
  } catch (error) { add('npm', 'error', `No se pudo comprobar npm: ${error.message}`); }

  if (platform !== 'win32') {
    for (const id of ['rustc', 'cargo', 'msvc', 'webview2']) add(id, 'unsupported', 'La aplicación nativa y esta comprobación requieren Windows.');
    return { schemaVersion: 1, platform, architecture: process.arch, ready: false, checks };
  }

  const findTool = async name => {
    const directories = [...new Set([
      ...(env.PATH ?? env.Path ?? '').split(path.delimiter).map(value => value.replace(/^"|"$/g, '')).filter(Boolean),
      ...(env.CARGO_HOME ? [path.join(env.CARGO_HOME, 'bin')] : []),
      ...(env.USERPROFILE ? [path.join(env.USERPROFILE, '.cargo', 'bin')] : [])
    ])];
    let accessError;
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      try { if (await exists(candidate)) return candidate; }
      catch (error) { accessError = error; }
    }
    if (accessError) throw accessError;
    return undefined;
  };

  for (const [id, name] of [['rustc', 'rustc.exe'], ['cargo', 'cargo.exe']]) {
    let file;
    try {
      file = await findTool(name);
      if (!file) { add(id, 'missing', `${name} no está en PATH ni en la carpeta de Cargo del usuario.`); continue; }
      const output = await run(file, id === 'rustc' ? ['-vV'] : ['--version']);
      if (id === 'rustc') {
        const host = /^host:\s*(\S+)$/m.exec(output)?.[1];
        if (!host?.endsWith('-pc-windows-msvc')) {
          add(id, 'error', `Rust no usa un host MSVC de Windows: ${host ?? 'host desconocido'}.`, { path: file, version: output });
        } else add(id, 'ok', `Rust disponible (${host}).`, { path: file, version: output });
      } else {
        if (!/^cargo \d+\.\d+\.\d+\b/.test(output)) throw Error('La salida no contiene una versión Cargo reconocible.');
        add(id, 'ok', output, { path: file });
      }
    } catch (error) { add(id, 'error', `No se pudo comprobar ${name}: ${error.message}`, { ...(file ? { path: file } : {}) }); }
  }

  const programFiles = env['ProgramFiles(x86)'] ?? env.ProgramFiles;
  const vswhere = programFiles && path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  try {
    if (!vswhere || !await exists(vswhere)) add('msvc', 'missing', 'No se encontró vswhere para comprobar las herramientas C++ de Visual Studio.');
    else {
      const output = await run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-format', 'json', '-utf8']);
      const installations = JSON.parse(output);
      const installation = installations.find(item => item.isComplete && typeof item.installationPath === 'string');
      if (!installation) add('msvc', 'missing', 'Visual Studio no informa de una instalación completa con las herramientas C++ x86/x64.');
      else {
        const tools = path.join(installation.installationPath, 'VC', 'Tools', 'MSVC');
        const versions = (await list(tools)).filter(name => /^\d+(\.\d+)+$/.test(name)).sort(versionOrder);
        let compiler;
        for (const version of versions) {
          const candidate = path.join(tools, version, 'bin', 'Hostx64', 'x64', 'cl.exe');
          if (await exists(candidate)) { compiler = candidate; break; }
        }
        if (compiler) add('msvc', 'ok', 'Compilador C++ MSVC x64 presente; la compilación comprobará SDK y enlazador.', { path: compiler });
        else add('msvc', 'missing', 'Visual Studio declara C++ pero no se encontró el compilador x64.');
      }
    }
  } catch (error) { add('msvc', 'error', `No se pudieron comprobar las herramientas C++: ${error.message}`); }

  const runtimeRoots = [...new Set([
    env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA
  ].filter(Boolean).map(directory => path.join(directory, 'Microsoft', 'EdgeWebView', 'Application')))];
  let runtime, runtimeError;
  for (const directory of runtimeRoots) {
    try {
      if (!await exists(directory)) continue;
      const versions = (await list(directory)).filter(name => /^\d+(\.\d+)+$/.test(name)).sort(versionOrder);
      for (const version of versions) {
        const candidate = path.join(directory, version, 'msedgewebview2.exe');
        if (await exists(candidate)) { runtime = { path: candidate, version }; break; }
      }
      if (runtime) break;
    } catch (error) { runtimeError = error.message; }
  }
  if (runtime) add('webview2', 'ok', `WebView2 ${runtime.version} presente.`, runtime);
  else add('webview2', runtimeError ? 'error' : 'missing', runtimeError ? `No se pudo consultar WebView2: ${runtimeError}` : 'No se encontró el runtime Evergreen WebView2 en las ubicaciones estándar.');

  return { schemaVersion: 1, platform, architecture: process.arch, ready: checks.every(check => check.status === 'ok'), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Uso: node scripts/preflight.mjs [--json]\nComprueba prerrequisitos locales sin instalar software ni compilar el proyecto.');
  } else if (args.some(argument => argument !== '--json')) {
    console.error('Argumento no permitido. Usa --help.'); process.exitCode = 2;
  } else {
    const report = await inspectPrerequisites();
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      for (const check of report.checks) console.log(`[${check.status}] ${check.id}: ${check.detail}`);
      console.log(report.ready ? 'Prerrequisitos detectados. Falta compilar y ejecutar las pruebas nativas.' : 'Faltan prerrequisitos o verificaciones. No se ha instalado software.');
    }
    if (!report.ready) process.exitCode = 1;
  }
}

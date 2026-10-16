import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { inspectPrerequisites, supportedNode } from '../scripts/preflight.mjs';

test('preflight enforces the Node floor and rejects malformed versions', () => {
  for (const version of ['24.0.0', 'v24.20.0', 'v26.1.1']) assert.equal(supportedNode(version), true);
  for (const version of ['22.12.0', 'v22.13.1', '23.11.0', '20.99.0', 'garbage']) assert.equal(supportedNode(version), false);
});

test('missing native tools are reported without inventing versions or running projects', async () => {
  const calls = [];
  const report = await inspectPrerequisites({
    platform: 'win32', env: {}, execPath: path.resolve('node.exe'), nodeVersion: 'v24.20.0',
    exists: async () => false,
    run: async (...args) => { calls.push(args); throw Error('must not execute'); }
  });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.id === 'node').status, 'ok');
  for (const id of ['npm', 'rustc', 'cargo', 'msvc', 'webview2']) assert.equal(report.checks.find(check => check.id === id).status, 'missing');
  assert.deepEqual(calls, []);
});

test('detected Rust execution failures are errors rather than successful installations', async () => {
  const report = await inspectPrerequisites({
    platform: 'win32', env: { USERPROFILE: path.resolve('user') }, execPath: path.resolve('node.exe'),
    exists: async file => file.endsWith('rustc.exe'),
    run: async () => { throw Error('access denied'); }
  });
  const rust = report.checks.find(check => check.id === 'rustc');
  assert.equal(rust.status, 'error'); assert.match(rust.detail, /access denied/);
  assert.equal(report.ready, false);
});

test('non-Windows hosts cannot claim native readiness', async () => {
  const report = await inspectPrerequisites({ platform: 'linux', exists: async () => false });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.id === 'msvc').status, 'unsupported');
});

test('full readiness requires a real MSVC host, compiler and WebView2 executable', async () => {
  const env = { USERPROFILE: path.resolve('user'), 'ProgramFiles(x86)': path.resolve('program-files') };
  const installation = path.resolve('visual-studio');
  const runs = [];
  const report = await inspectPrerequisites({
    platform: 'win32', env, execPath: path.resolve('node.exe'), nodeVersion: 'v24.20.0',
    exists: async () => true,
    readdir: async directory => directory.endsWith('MSVC') ? ['14.9.0', '14.51.1'] : ['SetupMetrics', '155.0.4283.45'],
    run: async (file, args) => {
      runs.push([file, args]);
      if (file.endsWith('rustc.exe')) return 'rustc 1.99.1\nhost: x86_64-pc-windows-msvc';
      if (file.endsWith('cargo.exe')) return 'cargo 1.99.1';
      if (file.endsWith('vswhere.exe')) return JSON.stringify([{ isComplete: true, installationPath: installation }]);
      return '11.19.0';
    }
  });
  assert.equal(report.ready, true);
  assert.match(report.checks.find(check => check.id === 'msvc').path, /14\.51\.1/);
  assert.equal(report.checks.find(check => check.id === 'webview2').version, '155.0.4283.45');
  assert.equal(runs.length, 4);
  assert.ok(runs.every(([, args]) => !args.includes('install') && !args.includes('build')));
});

test('GNU Rust and inaccessible files do not become missing or ready results', async () => {
  const report = await inspectPrerequisites({
    platform: 'win32', env: { USERPROFILE: path.resolve('user') }, execPath: path.resolve('node.exe'),
    exists: async file => {
      if (file.endsWith('npm-cli.js')) throw Object.assign(Error('access denied'), { code: 'EACCES' });
      return file.endsWith('rustc.exe');
    },
    run: async () => 'rustc 1.99.1\nhost: x86_64-pc-windows-gnu'
  });
  assert.equal(report.checks.find(check => check.id === 'npm').status, 'error');
  assert.equal(report.checks.find(check => check.id === 'rustc').status, 'error');
  assert.equal(report.ready, false);
});

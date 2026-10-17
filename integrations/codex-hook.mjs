import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Discards prompts, tool input, paths and assistant messages at the hook boundary. */
export function hookEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const status = { UserPromptSubmit: 'working', PermissionRequest: 'review', Stop: 'complete', Interrupt: 'waiting' }[payload.hook_event_name];
  if (!status || typeof payload.session_id !== 'string' || payload.session_id.length > 256) return null;
  if (payload.hook_event_name === 'Stop' && payload.stop_hook_active === true) return null;
  const turn = typeof payload.turn_id === 'string' && payload.turn_id.length <= 256 ? payload.turn_id : '';
  return { kind: 'agent', taskId: createHash('sha256').update(`${payload.session_id}:${turn}`).digest('hex').slice(0, 32), status };
}

export async function sendEvent(event, directory = join(process.env.APPDATA ?? '', 'com.orvyn.nivo', 'integrations')) {
  const path = join(directory, 'connection.json');
  const contents = await readFile(path); if (contents.length > 16384) return false;
  const credentials = JSON.parse(contents);
  if (!/^\\\\\.\\pipe\\Orvyn\.Nivo\.[a-f0-9]{24}$/.test(credentials.pipe) || !/^[a-f0-9]{64}$/.test(credentials.token)) return false;
  return new Promise(resolve => {
    const socket = createConnection(credentials.pipe); let response = '';
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200, () => finish(false)); socket.on('error', () => finish(false));
    socket.on('connect', () => socket.write(`${JSON.stringify({ token: credentials.token, event })}\n`));
    socket.on('data', bytes => { response += bytes; if (response.length > 128) finish(false); else if (response.includes('\n')) finish(response.trim() === '{"ok":true}'); });
    socket.on('end', () => finish(false));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Hooks are observational: no output, decisions, approvals or transcript reads.
  try {
    const chunks = []; let length = 0;
    for await (const chunk of process.stdin) { length += chunk.length; if (length > 1048576) break; chunks.push(chunk); }
    if (length <= 1048576) { const event = hookEvent(JSON.parse(Buffer.concat(chunks).toString('utf8'))); if (event) await sendEvent(event); }
  } catch { /* Nivo absent/disabled must never block or alter Codex. */ }
}

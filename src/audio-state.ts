import type { IslandNotification } from './domain/event-coordinator.ts';
export interface AudioEndpoint { id: string; name: string; volume: number; muted: boolean }
export interface AudioDevice { id: string; name: string }
export interface AudioSession extends AudioEndpoint { active: boolean }
export interface AudioSnapshot {
  sequence: number; status: 'disabled' | 'connecting' | 'ready' | 'unavailable';
  output: AudioEndpoint | null; input: AudioEndpoint | null;
  devices: AudioDevice[]; sessions: AudioSession[]; error: string | null;
}
export type AudioAction =
  | { kind: 'outputVolume' | 'sessionVolume'; id: string; value: number }
  | { kind: 'outputMute' | 'inputMute' | 'sessionMute'; id: string; muted: boolean };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max) : '';
function device(value: unknown): AudioDevice | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 2048 || /[\u0000-\u001f]/.test(value.id)) return null;
  return { id: value.id, name: label(value.name, 256) };
}
function endpoint(value: unknown): AudioEndpoint | null {
  const info = device(value);
  if (!info || !record(value) || typeof value.volume !== 'number' || !Number.isFinite(value.volume)
    || value.volume < 0 || value.volume > 1 || typeof value.muted !== 'boolean') return null;
  return { ...info, volume: value.volume, muted: value.muted };
}
export const emptyAudio = (status: AudioSnapshot['status'] = 'disabled', sequence = 0): AudioSnapshot => ({
  sequence, status, output: null, input: null, devices: [], sessions: [], error: null,
});
export function parseAudioSnapshot(value: unknown): AudioSnapshot | null {
  if (!record(value) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || !['disabled', 'connecting', 'ready', 'unavailable'].includes(value.status as string)
    || !Array.isArray(value.sessions) || value.sessions.length > 24 || !Array.isArray(value.devices) || value.devices.length > 16) return null;
  const result = emptyAudio(value.status as AudioSnapshot['status'], value.sequence as number);
  result.error = label(value.error, 280) || null;
  if (result.status !== 'ready') return result;
  result.output = endpoint(value.output); result.input = endpoint(value.input);
  result.devices = value.devices.map(device).filter((value): value is AudioDevice => value !== null);
  const seen = new Set<string>();
  for (const item of value.sessions) {
    const parsed = endpoint(item);
    if (!parsed || !record(item) || seen.has(parsed.id) || typeof item.active !== 'boolean') continue;
    seen.add(parsed.id); result.sessions.push({ ...parsed, active: item.active });
  }
  return result;
}

/** Snapshot diffs never announce initial enumeration, fake levels or microphone use. */
export function audioActivity(previous: AudioSnapshot | undefined, next: AudioSnapshot): IslandNotification[] {
  if (!previous || previous.status !== 'ready' || next.status !== 'ready') return [];
  const events: IslandNotification[] = [];
  const create = (kind: IslandNotification['kind'], title: string, body: string, extra: Partial<IslandNotification> = {}) =>
    events.push({ id: `audio:${next.sequence}:${kind}`, source: 'Windows · Audio', title, body, kind,
      groupKey: `audio:${kind}`, durationMs: 2400, reaction: 'attention', ...extra });
  if (previous.output?.id !== next.output?.id) {
    create('device', next.output ? 'Salida de audio cambiada' : 'Salida de audio no disponible', next.output?.name ?? previous.output?.name ?? '',
      { priority: !next.output && previous.sessions.some(value => value.active) ? 'high' : 'normal', reaction: 'device' });
  } else if (next.output && previous.output && (Math.round(previous.output.volume * 100) !== Math.round(next.output.volume * 100) || previous.output.muted !== next.output.muted)) {
    create('volume', next.output.muted ? 'Silencio' : `${Math.round(next.output.volume * 100)} %`, next.output.name,
      { compact: true, progress: next.output.volume });
  }
  if (previous.output?.id === next.output?.id) {
    const added = next.devices.find(device => !previous.devices.some(old => old.id === device.id));
    const removed = previous.devices.find(device => !next.devices.some(current => current.id === device.id));
    if (added || removed) create('device', added ? 'Salida de audio disponible' : 'Salida de audio retirada', (added ?? removed)!.name, { reaction: 'device' });
  }
  if (previous.input?.id === next.input?.id && next.input && previous.input?.muted !== next.input.muted) {
    create('microphone', next.input.muted ? 'Micrófono silenciado' : 'Micrófono sin silencio', next.input.name);
  } else if (previous.input?.id !== next.input?.id) {
    create('microphone', next.input ? 'Entrada de audio cambiada' : 'Entrada de audio no disponible', next.input?.name ?? previous.input?.name ?? '', { reaction: 'device' });
  }
  return events;
}

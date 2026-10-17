import { parsePreferences, type Preferences } from './domain/index.ts';
import { parseMediaSnapshot, type MediaAction, type MediaSnapshot } from './media-state.ts';
import { parseDisplays, type Display } from './display-state.ts';
import type { SurfaceGeometry } from './native-surface.ts';
import { emptyAudio, parseAudioSnapshot, type AudioSnapshot, type AudioAction } from './audio-state.ts';
import { parsePowerSnapshot, type PowerSnapshot } from './power-state.ts';
import { parseIntegrationEvent, type IntegrationEvent } from './integration-state.ts';
export type { Display } from './display-state.ts';

type Core = { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
type EventApi = { listen<T>(name: string, handler: (event: { payload: T }) => void, options?: { target: string }): Promise<() => void> };
declare global { interface Window { __TAURI__?: { core: Core; event: EventApi } } }
const core = window.__TAURI__?.core;
export const isNative = Boolean(core);
let surfaceEpoch = 0;
export const bridge = {
  onIntegration: (handler: (event: IntegrationEvent) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<unknown>('nivo://integration', event => {
      const value = parseIntegrationEvent(event.payload); if (value) handler(value);
    }, { target: 'island' });
  },
  onLockKey: (handler: (value: { caps: boolean; enabled: boolean }) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<{ caps?: unknown; enabled?: unknown }>('nivo://lock-key', ({ payload }) => {
      if (payload && typeof payload.caps === 'boolean' && typeof payload.enabled === 'boolean') handler({ caps: payload.caps, enabled: payload.enabled });
    }, { target: 'island' });
  },
  async power(): Promise<PowerSnapshot | null> { return core ? parsePowerSnapshot(await core.invoke('get_power_snapshot')) : null; },
  onPower: (handler: (snapshot: PowerSnapshot) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<unknown>('nivo://power', event => {
      const value = parsePowerSnapshot(event.payload); if (value) handler(value);
    }, { target: 'island' });
  },
  ready: () => core?.invoke<void>('ready') ?? Promise.resolve(),
  async resize(expanded: boolean): Promise<void> {
    if (core) surfaceEpoch = await core.invoke<number>('set_expanded', { expanded });
  },
  surfaceEpoch: () => surfaceEpoch,
  surface: (shape: SurfaceGeometry, epoch: number) => core?.invoke<boolean>('set_surface_geometry', { shape, epoch }) ?? Promise.resolve(true),
  async audio(): Promise<AudioSnapshot> {
    if (!core) return emptyAudio('unavailable');
    const value = parseAudioSnapshot(await core.invoke('get_audio_snapshot'));
    if (!value) throw new Error('Windows devolvió audio no válido.');
    return value;
  },
  onAudio: (handler: (snapshot: AudioSnapshot) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<unknown>('nivo://audio', event => {
      const value = parseAudioSnapshot(event.payload); if (value) handler(value);
    }, { target: 'island' });
  },
  controlAudio: (action: AudioAction) => core ? core.invoke<void>('audio_control', { action }) : Promise.reject(new Error('Requiere Nivo para Windows.')),
  soundSettings: () => core ? core.invoke<void>('open_sound_settings') : Promise.reject(new Error('Los ajustes requieren Windows.')),
  hide: () => core?.invoke<void>('hide_island') ?? Promise.resolve(),
  quit: () => core?.invoke<void>('quit_app') ?? Promise.resolve(),
  autostart: () => core ? core.invoke<boolean>('get_autostart') : Promise.resolve(false),
  setAutostart: (enabled: boolean) => core ? core.invoke<boolean>('set_autostart', { enabled })
    : Promise.reject(new Error('El inicio automático requiere la aplicación Windows.')),
  onDisplays: (handler: (displays: Display[]) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<unknown>('nivo://displays', event => {
      const displays = parseDisplays(event.payload);
      if (displays) handler(displays);
    }, { target: 'island' });
  },
  onVisibility: (handler: (visible: boolean) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<{ visible: boolean }>('nivo://visibility', event => {
      if (typeof event.payload?.visible === 'boolean') handler(event.payload.visible);
    }, { target: 'island' });
  },
  onMedia: (handler: (snapshot: MediaSnapshot) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<unknown>('nivo://media', event => {
      const snapshot = parseMediaSnapshot(event.payload);
      if (snapshot) handler(snapshot);
    }, { target: 'island' });
  },
  onView: (handler: () => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<{ view: unknown }>('nivo://view', event => {
      if (event.payload?.view === 'preferences') handler();
    }, { target: 'island' });
  },
  async media(): Promise<MediaSnapshot> {
    if (!core) return { sequence: 0, status: 'unavailable', sessions: [], activeSessionId: null, error: 'Abre la aplicación Windows para conectar un reproductor real.' };
    const snapshot = parseMediaSnapshot(await core.invoke('get_media_snapshot'));
    if (!snapshot) throw new Error('Windows devolvió un estado multimedia no válido.');
    return snapshot;
  },
  controlMedia: (sessionId: string, action: MediaAction) => core
    ? core.invoke<void>('media_control', { sessionId, action })
    : Promise.reject(new Error('El control multimedia requiere la aplicación Windows.')),
  selectMedia: (sessionId: string) => core
    ? core.invoke<void>('select_media_session', { sessionId })
    : Promise.reject(new Error('La selección multimedia requiere la aplicación Windows.')),
  async settings(): Promise<Preferences> {
    if (core) return parsePreferences(await core.invoke('get_settings'));
    try { return parsePreferences(JSON.parse(localStorage.getItem('nivo:preferences:v1') ?? 'null')); }
    catch { return parsePreferences(null); }
  },
  async save(settings: Preferences): Promise<Preferences> {
    if (core) return parsePreferences(await core.invoke('save_settings', { settings }));
    localStorage.setItem('nivo:preferences:v1', JSON.stringify(settings));
    return settings;
  },
  async displays(): Promise<Display[]> {
    const displays = parseDisplays(core ? await core.invoke('get_displays') : []);
    if (!displays) throw new Error('Windows devolvió una lista de pantallas no válida.');
    return displays;
  },
};

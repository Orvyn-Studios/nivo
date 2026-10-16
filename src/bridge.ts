import { parsePreferences, type Preferences } from './domain/index.ts';

type Core = { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
type EventApi = { listen<T>(name: string, handler: (event: { payload: T }) => void, options?: { target: string }): Promise<() => void> };
declare global { interface Window { __TAURI__?: { core: Core; event: EventApi } } }
export interface Display { name: string | null; x: number; y: number; width: number; height: number; work_x: number; work_y: number; work_width: number; work_height: number; scale_factor: number; primary: boolean }
const core = window.__TAURI__?.core;
export const isNative = Boolean(core);
export const bridge = {
  ready: () => core?.invoke<void>('ready') ?? Promise.resolve(),
  resize: (expanded: boolean) => core?.invoke<void>('set_expanded', { expanded }) ?? Promise.resolve(),
  hide: () => core?.invoke<void>('hide_island') ?? Promise.resolve(),
  quit: () => core?.invoke<void>('quit_app') ?? Promise.resolve(),
  onVisibility: (handler: (visible: boolean) => void): Promise<() => void> => {
    if (!core) return Promise.resolve(() => {});
    return window.__TAURI__!.event.listen<{ visible: boolean }>('nivo://visibility', event => {
      if (typeof event.payload?.visible === 'boolean') handler(event.payload.visible);
    }, { target: 'island' });
  },
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
  displays: () => core?.invoke<Display[]>('get_displays') ?? Promise.resolve([]),
};

import { parsePreferences, type Preferences } from './domain/index.ts';
import { parseMediaSnapshot, type MediaAction, type MediaSnapshot } from './media-state.ts';
import { parseDisplays, type Display } from './display-state.ts';
import type { SurfaceGeometry, SurfaceVelocity, SurfaceSnapshot } from './native-surface.ts';
import {parseActionResult,parseActionProgress,type ActionResult,type ActionProgress} from './actions.ts';
import { emptyAudio, parseAudioSnapshot, type AudioSnapshot, type AudioAction } from './audio-state.ts';
import { parsePowerSnapshot, type PowerSnapshot } from './power-state.ts';
import { parseIntegrationEvent, type IntegrationEvent } from './integration-state.ts';
import { parseDroppedFiles, type DroppedFile, type DropAction } from './drop-state.ts';
import {emptyGithub,parseGithub,parseGithubConnection,parseGithubNotices,type GithubOptions,type GithubConnection,type GithubSnapshot,type GithubNotice} from './github-state.ts';
export type { Display } from './display-state.ts';

type Core = { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
type EventApi = { listen<T>(name: string, handler: (event: { payload: T }) => void, options?: { target: string }): Promise<() => void> };
declare global { interface Window { __TAURI__?: { core: Core; event: EventApi } } }
const core = window.__TAURI__?.core;
export const isNative = Boolean(core);
let surfaceEpoch = 0;
let surfaceSnapshot: SurfaceSnapshot | undefined;
export const bridge = {
  onGithubOpen:(handler:()=>void):Promise<()=>void>=>core?window.__TAURI__!.event.listen('nivo://github-open',handler,{target:'island'}):Promise.resolve(()=>{}),
  github:async():Promise<GithubSnapshot>=>{const value=core?await core.invoke('get_github_snapshot'):undefined;if(value===undefined)return emptyGithub();const state=parseGithub(value);if(!state)throw new Error('Estado de GitHub no válido.');return state;},
  githubConnection:async():Promise<GithubConnection>=>{const value=core?await core.invoke('get_github_connection'):undefined;if(value===undefined)return{snapshot:emptyGithub(),repositories:[],truncated:false};const state=parseGithubConnection(value);if(!state)throw new Error('Conexión de GitHub no válida.');return state;},
  connectGithub:async(token:string):Promise<GithubConnection>=>{if(!core)throw new Error('Requiere Nivo para Windows.');const state=parseGithubConnection(await core.invoke('connect_github',{token}));if(!state)throw new Error('Conexión de GitHub no válida.');return state;},
  configureGithub:async(options:GithubOptions):Promise<GithubConnection>=>{if(!core)throw new Error('Requiere Nivo para Windows.');const state=parseGithubConnection(await core.invoke('configure_github',{options}));if(!state)throw new Error('Configuración no válida.');return state;},
  disconnectGithub:async():Promise<GithubConnection>=>{if(!core)throw new Error('Requiere Nivo para Windows.');const state=parseGithubConnection(await core.invoke('disconnect_github'));if(!state)throw new Error('Estado no válido.');return state;},
  refreshGithub:async()=>{if(core)await core.invoke('refresh_github');},
  openGithubItem:(id:string)=>core?.invoke<void>('open_github_item',{id})??Promise.reject(new Error('Requiere Nivo para Windows.')),
  onGithub:async(handler:(snapshot:GithubSnapshot,notices:GithubNotice[])=>void):Promise<()=>void>=>core?window.__TAURI__!.event.listen<unknown>('nivo://github',({payload})=>{if(!payload||typeof payload!=='object')return;const v=payload as Record<string,unknown>,snapshot=parseGithub(v.snapshot);if(snapshot)handler(snapshot,parseGithubNotices(v.notices))},{target:location.pathname.includes('preferences')?'preferences':'island'}):()=>{},
  trackCursor: (enabled: boolean) => core?.invoke<void>('set_companion_tracking', { enabled }) ?? Promise.resolve(),
  onCursor: (handler: (point: { x: number; y: number }) => void): Promise<() => void> => core
    ? window.__TAURI__!.event.listen<{ x: number; y: number }>('nivo://cursor', ({ payload }) => {
      if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y)) handler(payload);
    }, { target: 'island' }) : Promise.resolve(() => {}),
  closePreferences: () => core ? core.invoke<void>('close_preferences') : Promise.resolve(window.close()),
  openPreferences: () => core ? core.invoke<void>('open_preferences') : Promise.resolve(window.open('/preferences.html', 'nivo-preferences', 'width=820,height=620')).then(() => {}),
  onSettings: (handler: (settings: Preferences) => void): Promise<() => void> => core
    ? window.__TAURI__!.event.listen<unknown>('nivo://settings', event => handler(parsePreferences(event.payload)), { target: 'island' }) : Promise.resolve(() => {}),
  dropAction: async(action:DropAction,id?:string):Promise<ActionResult>=>{
    if(!core)throw new Error('Requiere Nivo para Windows.');
    return parseActionResult(await core.invoke('drop_action',{action,id:id??null}));
  },
  cancelDropAction:(operationId:string)=>core?.invoke<boolean>('cancel_drop_action',{operationId})??Promise.resolve(false),
  onActionProgress:(handler:(progress:ActionProgress)=>void):Promise<()=>void>=>core
    ?window.__TAURI__!.event.listen<unknown>('nivo://action-progress',event=>{const value=parseActionProgress(event.payload);if(value)handler(value)},{target:'island'}):Promise.resolve(()=>{}),
  onDrop: async (files: (value: DroppedFile[]) => void, phase: (value: 'enter' | 'leave' | 'drop') => void, error: (value: unknown) => void): Promise<() => void> => {
    if (!core) return () => {};
    const cleanups: (() => void)[] = [];
    try {
      cleanups.push(await window.__TAURI__!.event.listen<unknown>('nivo://drop-files', event => {
        const value = parseDroppedFiles(event.payload); if (value) files(value);
      }, { target: 'island' }));
      cleanups.push(await window.__TAURI__!.event.listen<unknown>('nivo://drop-phase', event => {
        if (event.payload === 'enter' || event.payload === 'leave' || event.payload === 'drop') phase(event.payload);
      }, { target: 'island' }));
      cleanups.push(await window.__TAURI__!.event.listen<unknown>('nivo://drop-error', event => {
        if (typeof event.payload === 'string') error(event.payload.slice(0, 280));
      }, { target: 'island' }));
      return () => cleanups.forEach(cleanup => cleanup());
    } catch (error) { cleanups.forEach(cleanup => cleanup()); throw error; }
  },
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
    if (core) {
      const value=await core.invoke<number|SurfaceSnapshot>('set_expanded',{expanded});
      if(typeof value==='number'){surfaceEpoch=value;surfaceSnapshot=undefined;}
      else if(value&&Number.isSafeInteger(value.epoch)&&value.epoch>=surfaceEpoch){surfaceEpoch=value.epoch;surfaceSnapshot=value;}
    }
  },
  surfaceEpoch: () => surfaceEpoch,
  surfaceSnapshot: () => surfaceSnapshot,
  surface: (shape: SurfaceGeometry, epoch: number, velocity?:SurfaceVelocity) => core?.invoke<boolean>('set_surface_geometry', { shape, epoch, velocity:velocity??null }) ?? Promise.resolve(true),
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
    }, { target: location.pathname.includes('preferences') ? 'preferences' : 'island' });
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

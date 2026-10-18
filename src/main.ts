import {
  createIslandState, reduceIsland, presentation, shouldReduceMotion,
  type IslandEvent, type Preferences,
} from './domain/index.ts';
import { bridge, isNative } from './bridge.ts';
import { IslandMotion } from './motion.ts';
import { createTransitionController } from './transition.ts';
import { transitionMetrics } from './metrics.ts';
import { activeMedia, MediaInbox, type MediaSnapshot } from './media-state.ts';
import { createMediaView } from './components/media.ts';
import { createCompanion } from './components/companion.ts';
import { companionPose } from './companion-state.ts';
import { audioActivity, emptyAudio, type AudioSnapshot } from './audio-state.ts';
import { createAudioView } from './components/audio.ts';
import { PowerInbox, type PowerSnapshot } from './power-state.ts';
import { IntegrationInbox } from './integration-state.ts';
import { renderIntegrations } from './components/integrations.ts';
import { createDropView } from './components/drop.ts';
import type { DroppedFile } from './drop-state.ts';
import { contextGeometry, type Context } from './geometry.ts';
import { icon, mountIcons } from './components/icons.ts';
import {createGithubView} from './components/github.ts';
import {emptyGithub,type GithubSnapshot,type GithubNotice} from './github-state.ts';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing interface element: ${id}`);
  return value as T;
}
const island = element('island');
const panel = element('island-panel');
const toggle = element<HTMLButtonElement>('toggle');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = createIslandState();
let clockTimeout: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let unlistenCursor: (() => void) | undefined;
let cursorReady = false;
let requestedTracking = false;
let trackingCommand = Promise.resolve();
let lastReportAt = 0;
let celebratedEvent: string | undefined;
let unlistenVisibility: (() => void) | undefined;
let unlistenMedia: (() => void) | undefined;
let unlistenView: (() => void) | undefined;
let unlistenAudio: (() => void) | undefined;
let audioSnapshot: AudioSnapshot | undefined;
let audioSequence = -1;
let requestedAudio: boolean | undefined;
const powerInbox = new PowerInbox();
let unlistenPower: (() => void) | undefined;
let unlistenLockKey: (() => void) | undefined;
let lockSerial = 0;
let unlistenIntegration: (() => void) | undefined;
const integrationInbox = new IntegrationInbox();
let integrationOptOut = false;
let dropOptOut = false;
let droppedFiles: DroppedFile[] = [];
let dropReturn: typeof state.base | undefined;
let unlistenDrop: (() => void) | undefined;
let unlistenActionProgress:(()=>void)|undefined;
let unlistenDisplays: (() => void) | undefined;
let unlistenGithub:(()=>void)|undefined,unlistenGithubOpen:(()=>void)|undefined;
let githubSnapshot=emptyGithub(),githubReturn:typeof state.base|undefined;
let observedTransition: Promise<boolean> | undefined;
let geometryDirty = false;
let mediaDirty = false;
let integrationsDirty = true;
const mediaInbox = new MediaInbox();
let requestedMedia: boolean | undefined;
const motion = new IslandMotion(island, panel, element('toggle-identity'), isNative ? {
  send: bridge.surface, epoch: bridge.surfaceEpoch, snapshot:bridge.surfaceSnapshot, recover:bridge.resize, onError: report,
} : undefined);
toggle.disabled = true;
document.body.dataset.environment = isNative ? 'native' : 'preview';
document.title = isNative ? 'Nivo by Orvyn' : 'Nivo by Orvyn · desarrollo';
const mediaView = createMediaView({ control: bridge.controlMedia });
const audioView = createAudioView({ control: bridge.controlAudio, refresh: async () => {
  const snapshot = await bridge.audio();
  return state.preferences.audio_enabled && requestedAudio !== false ? snapshot : emptyAudio();
}, settings: bridge.soundSettings }, report);
const companionInput = { desktop: isNative, pointerTarget: document };
const companion = createCompanion(element('nivo-companion'), toggle, companionInput);
const welcomeCompanion = createCompanion(element('companion-welcome'), element('media-empty'), companionInput);
const eventFace = element('nivo-companion').cloneNode(true) as SVGElement;
eventFace.id = 'event-companion'; eventFace.classList.add('companion-welcome'); eventFace.removeAttribute('hidden');
const eventCompanion = createCompanion(eventFace, element('notification'), companionInput);
const agentFace = eventFace.cloneNode(true) as SVGElement; agentFace.id = 'agent-companion';
element('integration-activity').prepend(agentFace);
const agentCompanion = createCompanion(agentFace, element('integration-activity'), companionInput);
const dropFace=eventFace.cloneNode(true) as SVGElement;dropFace.id='drop-companion';
element('drop').querySelector('.section-heading')!.prepend(dropFace);
const dropCompanion=createCompanion(dropFace,element('drop'),companionInput);
const companions = [companion, welcomeCompanion, eventCompanion, agentCompanion,dropCompanion];
const dropView = createDropView({run:bridge.dropAction,cancel:bridge.cancelDropAction,close:restoreDrop,reduced:()=>shouldReduceMotion(state.preferences,systemMotion.matches),changed:()=>{
  if(state.base.kind==='expanded'&&state.base.view==='drop'){motion.captureLayout();geometryDirty=true;dispatch({type:'advance',now:Date.now()});}
}});
const githubView=createGithubView({reduced:()=>shouldReduceMotion(state.preferences,systemMotion.matches),close:()=>{
 const previous=githubReturn??{kind:'compact'};githubReturn=undefined;dispatch(previous.kind==='compact'?{type:'collapse'}:{type:'expand',view:previous.view});
}});
function openGithub(){if(state.base.kind!=='expanded'||state.base.view!=='github')githubReturn=state.base;githubView.render(githubSnapshot,state.preferences.privacy_mode);dispatch({type:'expand',view:'github'});}
function receiveGithub(snapshot:GithubSnapshot,notices:GithubNotice[]=[]){
 if(snapshot.revision<githubSnapshot.revision)return;githubSnapshot=snapshot;githubView.render(snapshot,state.preferences.privacy_mode);
 if(!snapshot.options.enabled||!snapshot.options.notifications){dispatch({type:'cancel-event-group',groupKey:'github',now:Date.now()});return;}
 for(const n of notices)dispatch({type:'notify',now:Date.now(),notification:{id:n.id,source:'GitHub',title:n.title,body:n.body,kind:'system',sensitive:true,groupKey:'github',priority:n.failure?'high':'normal',reaction:n.failure?'error':'attention',action:{provider:'github',id:n.actionId,label:n.actionLabel}}});
}
function restoreDrop():void{
  const previous=dropReturn??{kind:'compact'};dropReturn=undefined;
  dispatch(previous.kind==='compact'?{type:'collapse'}:{type:'expand',view:previous.view});
}
mountIcons();

function applyPreferences(preferences: Preferences): void {
  githubView.render(githubSnapshot,preferences.privacy_mode);
  motion.captureLayout(); geometryDirty = true;
  integrationOptOut = !preferences.integrations_enabled;
  dropOptOut = !preferences.drop_enabled;
  requestedAudio = preferences.audio_enabled ? undefined : false;
  requestedMedia = preferences.media_enabled ? undefined : false;
  if (integrationOptOut) integrationInbox.clear();
  if (dropOptOut) { droppedFiles = []; dropReturn = undefined; dropView.render([], preferences.privacy_mode); }
  else dropView.render(droppedFiles, preferences.privacy_mode);
  renderIntegrations(integrationInbox, preferences.privacy_mode);
  integrationsDirty=false;
  if (!preferences.audio_enabled) { audioSnapshot = undefined; audioView.render(emptyAudio()); }
  if (!preferences.media_enabled) mediaView.render(mediaInbox.setEnabled(false));
  dispatch({ type: 'preferences', value: preferences });
  void bridge.audio().then(value => receiveAudio(value, true)).catch(report);
  void bridge.media().then(value => receiveMedia(value, true)).catch(report);
}

function syncCompanion(): void {
  const value = {
    enabled: state.preferences.mascot_enabled,
    visible: !disposed && !state.hidden && !document.hidden,
    reduced: shouldReduceMotion(state.preferences, systemMotion.matches),
    pose: companionPose(activeMedia(mediaInbox.snapshot)?.playback, {
      reaction: state.notification?.notification.reaction ?? (state.base.kind==='expanded'&&state.base.view==='drop'?dropView.reaction:[...integrationInbox.agents.values()].includes('working') ? 'working' : undefined),
      expanded: state.base.kind === 'expanded' || state.notification !== null,
      hovered: state.hovered,
      // Browser preview and an empty player are normal; only a native failure worries Nivo.
      unavailable: isNative && state.preferences.media_enabled && mediaInbox.snapshot.status === 'unavailable',
    }),
  };
  const expanded = state.base.kind === 'expanded' || state.notification !== null;
  const hasMedia = activeMedia(mediaInbox.snapshot) !== null;
  companion.update({ ...value, visible: value.visible && (!hasMedia || expanded) });
  welcomeCompanion.update({ ...value, visible: value.visible && expanded && !hasMedia
    && !state.notification && state.base.kind === 'expanded' && state.base.view === 'activity' });
  eventCompanion.update({ ...value, visible: value.visible && state.notification?.notification.kind === 'agent' });
  const working = [...integrationInbox.agents.values()].includes('working');
  agentFace.toggleAttribute('hidden', !working || hasMedia || !state.preferences.mascot_enabled);
  agentCompanion.update({ ...value, pose: working ? 'working' : value.pose, visible: value.visible && working && !hasMedia });
  const inDrop=state.base.kind==='expanded'&&state.base.view==='drop'&&!state.notification;
  dropFace.toggleAttribute('hidden',!inDrop||!value.enabled);
  dropCompanion.update({...value,visible:value.visible&&inDrop});
  const tracking = cursorReady && value.enabled && value.visible && !value.reduced && (!hasMedia || expanded);
  if (tracking !== requestedTracking) {
    requestedTracking = tracking;
    trackingCommand = trackingCommand.then(() => bridge.trackCursor(tracking)).catch(report);
  }
}

function receiveMedia(snapshot: MediaSnapshot, reconcile = false): void {
  mediaInbox.setEnabled(state.preferences.media_enabled && requestedMedia !== false);
  if (!mediaInbox.receive(snapshot, reconcile)) return;
  mediaDirty = true;
  // Revoke private contents immediately, but defer ordinary visual updates while hidden.
  if (!mediaInbox.enabled) { mediaView.render(mediaInbox.snapshot); mediaDirty = false; }
  if (mediaInbox.enabled) dispatch({ type: 'media', sequence: snapshot.sequence, session: activeMedia(snapshot) });
}

function receiveAudio(snapshot: AudioSnapshot, reconcile = false): void {
  if (snapshot.sequence < audioSequence || (snapshot.sequence === audioSequence && !reconcile)) return;
  audioSequence = snapshot.sequence;
  if (!state.preferences.audio_enabled || requestedAudio === false) { audioSnapshot = undefined; audioView.render(emptyAudio()); return; }
  const events = audioActivity(audioSnapshot, snapshot);
  audioSnapshot = snapshot;
  if (!state.hidden && !document.hidden && state.base.kind === 'expanded' && state.base.view === 'audio') audioView.render(snapshot);
  for (const notification of events) dispatch({ type: 'notify', notification, now: Date.now() });
}

function receivePower(snapshot: PowerSnapshot): void {
  const events = powerInbox.receive(snapshot, state.preferences);
  const visible = state.preferences.battery_enabled && snapshot.present === true;
  element('battery-status').hidden = !visible;
  if (visible) element('battery-status').textContent = snapshot.percent === null ? 'Batería · nivel no disponible'
    : `Batería ${snapshot.percent} %${snapshot.charging === true ? ' · Cargando' : ''}`;
  for (const notification of events) dispatch({ type: 'notify', notification, now: Date.now() });
}

function report(error: unknown): void {
  element('bridge-status').textContent = (error instanceof Error ? error.message : String(error)).slice(0, 280);
  const now = Date.now();
  if (now - lastReportAt < 5000) return;
  lastReportAt = now;
  dispatch({ type: 'notify', now, notification: { id: `error:${now}`, source: 'Nivo', kind: 'system',
    title: 'No se pudo completar', body: 'Vuelve a intentarlo en un momento.', reaction: 'error', groupKey: 'error' } });
}
const transition = createTransitionController({
  // Ready allocates one backing surface. Each leg only acquires an epoch/sample;
  // its HRGN is the visible silhouette as well as the interactive region.
  resize: async () => {},
  prepare: isNative ? bridge.resize : undefined,
  cancelAnimation: () => motion.cancel(),
  setInteractive: (expanded: boolean) => { panel.inert = !expanded; },
  commit: (expanded: boolean) => {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Cerrar Nivo' : 'Abrir Nivo');
    panel.hidden = !expanded;
    if (!expanded) {
      island.dataset.expanded = 'false';
      render(); geometryDirty=false;
    }
  },
  animate: async (expanded: boolean) => {
    if (!expanded && document.hasFocus() && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    if (expanded) panel.hidden = false;
    await motion.to(expanded, shouldReduceMotion(state.preferences, systemMotion.matches));
    const event = state.notification?.notification;
    if (expanded && event?.kind === 'agent' && event.reaction === 'complete' && event.id !== celebratedEvent) {
      celebratedEvent = event.id; eventCompanion.celebrate();
    }
  },
  onError: error => {
    motion.settle();
    island.dataset.expanded = String(transition.expanded);
    report(error);
  },
});

function render(): void {
  mediaView.setMotion(shouldReduceMotion(state.preferences, systemMotion.matches) || state.hidden || document.hidden);
  syncCompanion();
  if (mediaDirty) { mediaView.render(mediaInbox.snapshot); mediaDirty = false; }
  if (integrationsDirty && state.base.kind === 'expanded' && state.base.view === 'activity') {
    renderIntegrations(integrationInbox, state.preferences.privacy_mode);integrationsDirty=false;
  }
  const now = Date.now();
  const view = presentation(state, now);
  const notification = view.kind === 'notification';
  const retainOutgoing = !notification && state.base.kind==='compact' && !panel.hidden;
  const currentMedia = activeMedia(mediaInbox.snapshot);
  const downloads = [...integrationInbox.downloads.values()].filter(value => value.state === 'active' || value.state === 'activity');
  const agent = [...integrationInbox.agents.values()].some(value => ['working', 'waiting', 'review'].includes(value));
  const context: Context = notification ? (['volume', 'microphone', 'device', 'keyboard', 'battery', 'agent'].includes(view.notification.kind ?? 'notice') ? view.notification.kind as Context : 'notice')
    : state.base.kind === 'expanded' && state.base.view === 'audio' ? 'audio'
    : state.base.kind === 'expanded' && state.base.view === 'drop' ? 'drop'
    : state.base.kind === 'expanded' && state.base.view === 'github' ? 'github'
    : currentMedia ? 'music' : downloads.length ? 'downloads' : agent ? 'agent' : 'summary';
  const semanticGeometry = contextGeometry(context, context === 'drop' ? droppedFiles.length
    : context === 'audio' ? audioSnapshot?.status === 'ready' ? 2 + audioSnapshot.sessions.length : 0 : downloads.length,
    currentMedia?.positionMs != null && currentMedia.durationMs != null && currentMedia.durationMs > 0);
  const geometry=context==='drop'?{...semanticGeometry,height:dropView.height()}:notification&&view.notification.action?{...semanticGeometry,height:148}:semanticGeometry;
  const key = `${context}:${geometry.width}:${geometry.height}`;
  if (!retainOutgoing && island.dataset.geometry !== key) {
    if(!panel.hidden)motion.captureLayout(); geometryDirty = true; island.dataset.geometry = key;
    island.style.setProperty('--context-width', `${geometry.width}px`);
    island.style.setProperty('--context-height', `${geometry.height}px`);
    island.style.setProperty('--context-radius', `${geometry.radius}px`);
    island.style.setProperty('--context-duration', String(geometry.duration));
  }
  if(!retainOutgoing) island.dataset.context = context;
  // One shared action group, moved rather than cloned between the two layouts.
  const actionSlot = element((retainOutgoing?island.dataset.context:context) === 'music' ? 'media-actions-slot' : 'activity-actions-slot');
  const actions = element('activity-footer');
  if (actions.parentElement !== actionSlot) actionSlot.append(actions);
  if(!retainOutgoing) island.dataset.overlay = String(notification);
  island.dataset.notice = 'false';
  island.dataset.hovered = String(state.hovered);
  island.dataset.companion = String(state.preferences.mascot_enabled);
  element('nivo-companion').toggleAttribute('hidden', !state.preferences.mascot_enabled);
  element('companion-welcome').toggleAttribute('hidden', !state.preferences.mascot_enabled);
  document.querySelector('.media-empty-mark')?.toggleAttribute('hidden', state.preferences.mascot_enabled);
  if(!retainOutgoing){
    element('notification').hidden = !notification;
    element('activity').hidden = notification || (state.base.kind === 'expanded' && state.base.view !== 'activity');
    element('audio').hidden = notification || state.base.kind !== 'expanded' || state.base.view !== 'audio';
    element('drop').hidden = notification || state.base.kind !== 'expanded' || state.base.view !== 'drop';
    element('github').hidden = notification || state.base.kind !== 'expanded' || state.base.view !== 'github';
  }
  element('media-widget').hidden = !currentMedia && (agent || downloads.length > 0);
  if (!currentMedia) { element('media-empty-title').textContent = 'Todo en calma'; element('media-empty-description').textContent = 'Un momento para ti.'; }
  element('activity-footer').hidden = notification || context==='drop'||context==='github';
  if (view.kind === 'notification' && notification) {
    element('notification-source').textContent = view.notification.source;
    element('notification-title').textContent = view.notification.title;
    element('notification-body').textContent = view.notification.body ?? '';
    element('notification-icon').replaceChildren(view.notification.kind === 'agent' && state.preferences.mascot_enabled ? eventFace : icon(view.notification.kind ?? 'notice'));
    const progress = element<HTMLProgressElement>('notification-progress');
    progress.hidden = view.notification.progress === undefined; progress.value = view.notification.progress ?? 0;
    const action=element<HTMLButtonElement>('notification-action');action.hidden=!view.notification.action;action.textContent=view.notification.action?.label??'';
  }
  const notice = view.kind === 'notification' ? view.notification : undefined;
  element('compact-label').textContent = notice?.compact ? notice.title
    : currentMedia ? (currentMedia.title || (currentMedia.playback === 'playing' ? 'Música' : 'En pausa'))
    : [...integrationInbox.agents.values()].includes('working') ? 'Codex'
    : [...integrationInbox.downloads.values()].some(value => value.state === 'active') ? 'Descarga' : 'Nivo';
  toggle.title = notice?.compact ? `${notice.title}${notice.body ? ` · ${notice.body}` : ''}` : currentMedia?.title ?? '';
  toggle.setAttribute('aria-label', `${transition.expanded ? 'Cerrar' : 'Abrir'} Nivo${notice ? `, ${notice.title}` : currentMedia ? `, ${currentMedia.title || 'reproductor multimedia'}` : ''}`);
  const progress = element<HTMLProgressElement>('compact-event-progress');
  progress.hidden = notice?.progress === undefined;
  progress.value = notice?.progress ?? 0;
  element('pause-events').textContent = state.eventsPaused ? 'Reanudar avisos' : 'Pausar avisos';

}

function scheduleClock(): void {
  clearTimeout(clockTimeout);
  if (disposed) return;
  const now = Date.now();
  const delays: number[] = [];
  if (state.notification) delays.push(Math.max(1, state.notification.expiresAtMs - now));
  if (delays.length) clockTimeout = setTimeout(() => dispatch({ type: 'advance', now: Date.now() }), Math.min(...delays, 2_147_483_647));
}

function dispatch(event: IslandEvent): void {
  const previous=state;
  try { state = reduceIsland(state, event); }
  catch (error) { report(error); return; }
  if(state===previous&&!geometryDirty&&!mediaDirty&&!integrationsDirty)return;
  if(shouldReduceMotion(state.preferences,systemMotion.matches)||state.hidden||document.hidden)dropView.settle();
  if(shouldReduceMotion(state.preferences,systemMotion.matches)||state.hidden||document.hidden)githubView.settle();
  mediaView.setMotion(shouldReduceMotion(state.preferences, systemMotion.matches) || state.hidden || document.hidden);
  if (state.hidden || document.hidden) syncCompanion();
  if (!state.hidden && !document.hidden) render();
  const desired = state.notification !== null || state.base.kind === 'expanded';
  if (!state.hidden) {
    const operation = transition.set(desired, geometryDirty);
    geometryDirty = false;
    // Provider updates share one observer during a slow native resize.
    if (operation !== observedTransition) {
      observedTransition = operation;
      void operation.then(confirmed => {
        if (observedTransition !== operation) return;
        observedTransition = undefined;
        const currentDesired = state.notification !== null || state.base.kind === 'expanded';
        if (confirmed !== currentDesired && !state.notification && transition.desired === confirmed) {
          state = reduceIsland(state, confirmed ? { type: 'expand' } : { type: 'collapse' });
          if (!state.hidden && !document.hidden) render();
        }
      });
    }
  }
  scheduleClock();
}

// WebView2 can retain :focus-visible after keyboard/programmatic focus restoration.
document.addEventListener('pointerdown', () => { island.dataset.input = 'pointer'; }, { capture: true });
toggle.addEventListener('click', () => {
  if (state.notification) dispatch({ type: 'dismiss-notification', now: Date.now() });
  else if(state.base.kind==='expanded'&&state.base.view==='drop')dropView.close();
  else dispatch(state.base.kind === 'expanded' ? { type: 'collapse' } : { type: 'expand' });
});
island.addEventListener('pointerenter', () => dispatch({ type: 'hover', active: true }));
island.addEventListener('pointerleave', () => dispatch({ type: 'hover', active: false }));
document.addEventListener('keydown', event => {
  island.dataset.input = 'keyboard';
  if (event.key === 'Escape') {
    if (state.notification) dispatch({ type: 'dismiss-notification', now: Date.now() });
    else if(state.base.kind==='expanded'&&state.base.view==='drop')dropView.close();
    else dispatch({ type: 'collapse' });
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.view === 'audio') audioView.render(audioSnapshot ?? emptyAudio());
  dispatch({ type: 'expand', view: button.dataset.view === 'preferences' ? 'preferences' : button.dataset.view === 'audio' ? 'audio' : 'activity' });
}));
element('open-audio').addEventListener('click', () => { audioView.render(audioSnapshot ?? emptyAudio()); dispatch({ type: 'expand', view: 'audio' }); });
element('open-preferences').addEventListener('click', () => void bridge.openPreferences().catch(report));
window.addEventListener('storage', event => { if (event.key === 'nivo:preferences:v1') void bridge.settings().then(applyPreferences).catch(report); });

element('pause-events').addEventListener('click', () => dispatch({ type: 'pause-events', paused: !state.eventsPaused }));

element('notification-dismiss').addEventListener('click', () => dispatch({ type: 'dismiss-notification', now: Date.now() }));
element('notification-action').addEventListener('click',()=>{
 const action=state.notification?.notification.action;if(!action)return;
 void bridge.openGithubItem(action.id).then(()=>dispatch({type:'dismiss-notification',now:Date.now()})).catch(report);
});
systemMotion.addEventListener('change', () => { if (systemMotion.matches) {motion.settle();dropView.settle();} mediaView.setMotion(shouldReduceMotion(state.preferences, systemMotion.matches) || state.hidden || document.hidden); syncCompanion(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {motion.settle();dropView.settle();}
  dispatch({ type: 'advance', now: Date.now() });
});
window.addEventListener('focus', () => dispatch({ type: 'advance', now: Date.now() }));
window.addEventListener('pageshow', () => { disposed = false; dispatch({ type: 'advance', now: Date.now() }); });
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(clockTimeout); motion.settle();dropView.settle(); syncCompanion(); });
window.addEventListener('beforeunload',()=>unlistenActionProgress?.());
window.addEventListener('beforeunload',()=>{unlistenGithub?.();unlistenGithubOpen?.();githubView.dispose()});
window.addEventListener('beforeunload', () => { unlistenCursor?.(); unlistenVisibility?.(); unlistenMedia?.(); unlistenView?.(); unlistenAudio?.(); unlistenPower?.(); unlistenLockKey?.(); unlistenIntegration?.(); unlistenDrop?.(); unlistenDisplays?.(); eventCompanion.dispose(); agentCompanion.dispose();dropCompanion.dispose(); dropView.dispose(); audioView.dispose(); mediaView.dispose(); companion.dispose(); welcomeCompanion.dispose(); });

// Local, bounded diagnostics; contains timings only, no titles or system activity.
Object.defineProperty(window, '__NIVO_METRICS__', { value: transitionMetrics });
render();
void (async () => {
  try {
    state = createIslandState(await bridge.settings());
    // Legacy timer storage is intentionally left untouched and is no longer read.
    render(); scheduleClock();
  } catch (error) { report(error); }
  try {
    unlistenCursor = await bridge.onCursor(({ x, y }) => { for (const face of companions) face.lookAt(x, y, true); });
    cursorReady = isNative;
    syncCompanion();
  } catch (error) { report(error); }
  try {
    // Subscribe first: the initial snapshot cannot overwrite a newer event.
    unlistenMedia = await bridge.onMedia(receiveMedia);
    receiveMedia(await bridge.media());
  } catch (error) { report(error); }
  try { unlistenView = await bridge.onSettings(applyPreferences); }
  catch (error) { report(error); }
  try {
    unlistenVisibility = await bridge.onVisibility(visible => {
      if (!visible) motion.settle();
      if (visible) { motion.captureLayout(); geometryDirty = true; }
      dispatch({ type: 'visibility', hidden: !visible });
      if (visible) dispatch({ type: 'advance', now: Date.now() });
      if (visible && state.base.kind === 'expanded' && state.base.view === 'audio') audioView.render(audioSnapshot ?? emptyAudio());
    });
  } catch (error) { report(error); }
  try { unlistenDisplays = await bridge.onDisplays(() => { motion.captureLayout(); geometryDirty = true; dispatch({ type: 'advance', now: Date.now() }); }); }
  catch (error) { report(error); }

  try { unlistenDrop = await bridge.onDrop(files => {
    if (!state.preferences.drop_enabled || dropOptOut || state.hidden) return;
    dropReturn ??= state.base;
    droppedFiles = files; dropView.render(files, state.preferences.privacy_mode);
    dispatch({ type: 'expand', view: 'drop' });
  }, phase => {
    if (!state.preferences.drop_enabled || dropOptOut || state.hidden) return;
    if (phase === 'enter') {
      dropReturn ??= state.base;
      dropView.render(droppedFiles, state.preferences.privacy_mode);
      dispatch({ type: 'expand', view: 'drop' });
    } else if (phase==='leave' && dropReturn) {
      const previous = dropReturn; dropReturn = undefined;
      dispatch(previous.kind === 'compact' ? { type: 'collapse' } : { type: 'expand', view: previous.view });
    }
  }, error=>{restoreDrop();report(error);}); } catch (error) { report(error); }
  try{unlistenActionProgress=await bridge.onActionProgress(dropView.progress);}catch(error){report(error);}
  try{unlistenGithub=await bridge.onGithub(receiveGithub);receiveGithub(await bridge.github());unlistenGithubOpen=await bridge.onGithubOpen(openGithub);}catch(error){report(error);}
  try { unlistenIntegration = await bridge.onIntegration(event => {
    if (!state.preferences.integrations_enabled || integrationOptOut) return;
    const notifications = integrationInbox.receive(event);
    integrationsDirty=true;
    if (!notifications.length && !state.hidden && !document.hidden) render();
    for (const notification of notifications) dispatch({ type: 'notify', notification, now: Date.now() });
  }); } catch (error) { report(error); }
  try { unlistenAudio = await bridge.onAudio(receiveAudio); receiveAudio(await bridge.audio()); }
  catch (error) { report(error); }
  try { unlistenPower = await bridge.onPower(receivePower); const snapshot = await bridge.power(); if (snapshot) receivePower(snapshot); }
  catch (error) { report(error); }
  try { unlistenLockKey = await bridge.onLockKey(value => {
    if (!(value.caps ? state.preferences.caps_lock_enabled : state.preferences.num_lock_enabled)) return;
    dispatch({ type: 'notify', now: Date.now(), notification: { id: `lock:${++lockSerial}`, kind: 'keyboard', source: 'Windows',
      title: `${value.caps ? 'Caps Lock' : 'Num Lock'} ${value.enabled ? 'activado' : 'desactivado'}`,
      groupKey: value.caps ? 'caps' : 'num', compact: true, durationMs: 1800, reaction: 'attention' } });
  }); } catch (error) { report(error); }
  toggle.disabled = false;
  try { await bridge.ready(); } catch (error) { report(error); }
})();

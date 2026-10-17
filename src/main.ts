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
import { createWindowsPreferences } from './components/windows-preferences.ts';
import { createCompanion } from './components/companion.ts';
import { companionPose } from './companion-state.ts';

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
let preferenceWrite = Promise.resolve();
let unlistenVisibility: (() => void) | undefined;
let unlistenMedia: (() => void) | undefined;
let unlistenView: (() => void) | undefined;
let observedTransition: Promise<boolean> | undefined;
let mediaDirty = false;
const mediaInbox = new MediaInbox();
let mediaRequestSerial = 0;
let requestedMedia: boolean | undefined;
const motion = new IslandMotion(island, panel, element('toggle-identity'), isNative ? {
  send: bridge.surface, epoch: bridge.surfaceEpoch, onError: report,
} : undefined);
toggle.disabled = true;
document.body.dataset.environment = isNative ? 'native' : 'preview';
document.title = isNative ? 'Nivo by Orvyn' : 'Nivo by Orvyn · desarrollo';
const mediaView = createMediaView({ control: bridge.controlMedia, select: bridge.selectMedia });
const companion = createCompanion(element('nivo-companion'), toggle);
const welcomeCompanion = createCompanion(element('companion-welcome'), element('media-empty'));

function syncCompanion(): void {
  const value = {
    enabled: state.preferences.mascot_enabled,
    visible: !state.hidden && !document.hidden,
    reduced: shouldReduceMotion(state.preferences, systemMotion.matches),
    pose: companionPose(activeMedia(mediaInbox.snapshot)?.playback, {
      reaction: state.notification?.notification.reaction,
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
}

function receiveMedia(snapshot: MediaSnapshot, reconcile = false): void {
  mediaInbox.setEnabled(state.preferences.media_enabled && requestedMedia !== false);
  if (!mediaInbox.receive(snapshot, reconcile)) return;
  mediaDirty = true;
  // Revoke private contents immediately, but defer ordinary visual updates while hidden.
  if (!mediaInbox.enabled) { mediaView.render(mediaInbox.snapshot); mediaDirty = false; }
  if (mediaInbox.enabled) dispatch({ type: 'media', sequence: snapshot.sequence, session: activeMedia(snapshot) });
}

function report(error: unknown): void {
  element('bridge-status').textContent = (error instanceof Error ? error.message : String(error)).slice(0, 280);
}
const windowsPreferences = createWindowsPreferences({ preferences: () => state.preferences, save: savePreferences, report });
const transition = createTransitionController({
  resize: bridge.resize,
  cancelAnimation: () => motion.cancel(),
  setInteractive: (expanded: boolean) => { panel.inert = !expanded; },
  commit: (expanded: boolean) => {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Cerrar Nivo' : 'Abrir Nivo');
    panel.hidden = !expanded;
    if (!expanded) island.dataset.expanded = 'false';
  },
  animate: async (expanded: boolean) => {
    if (!expanded && document.hasFocus() && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    if (expanded) panel.hidden = false;
    await motion.to(expanded, shouldReduceMotion(state.preferences, systemMotion.matches));
  },
  onError: error => {
    motion.settle();
    island.dataset.expanded = String(transition.expanded);
    report(error);
  },
});

function render(): void {
  syncCompanion();
  if (mediaDirty) { mediaView.render(mediaInbox.snapshot); mediaDirty = false; }
  const now = Date.now();
  const view = presentation(state, now);
  const notification = view.kind === 'notification';
  island.dataset.hovered = String(state.hovered);
  island.dataset.companion = String(state.preferences.mascot_enabled);
  element('nivo-companion').toggleAttribute('hidden', !state.preferences.mascot_enabled);
  element('companion-welcome').toggleAttribute('hidden', !state.preferences.mascot_enabled);
  document.querySelector('.media-empty-mark')?.toggleAttribute('hidden', state.preferences.mascot_enabled);
  element('notification').hidden = !notification;
  element('activity').hidden = notification || (state.base.kind === 'expanded' && state.base.view !== 'activity');
  element('preferences').hidden = notification || state.base.kind !== 'expanded' || state.base.view !== 'preferences';
  for (const name of ['activity', 'preferences']) {
    element(`${name}-tab`).setAttribute('aria-pressed', String(state.base.kind === 'expanded' && state.base.view === name));
  }
  if (notification) {
    element('notification-source').textContent = view.notification.source;
    element('notification-title').textContent = view.notification.title;
    element('notification-body').textContent = view.notification.body ?? '';
  }
  const currentMedia = activeMedia(mediaInbox.snapshot);
  const notice = view.kind === 'notification' ? view.notification : undefined;
  island.dataset.notice = String(Boolean(notice?.compact));
  element('compact-label').textContent = notice?.compact ? notice.title
    : currentMedia ? (currentMedia.title || (currentMedia.playback === 'playing' ? 'Música' : 'En pausa')) : 'Nivo';
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
  try { state = reduceIsland(state, event); }
  catch (error) { report(error); return; }
  if (state.hidden || document.hidden) syncCompanion();
  if (!state.hidden && !document.hidden) render();
  const desired = (state.notification !== null && !state.notification.notification.compact) || state.base.kind === 'expanded';
  if (!state.hidden) {
    const operation = transition.set(desired);
    // Provider updates share one observer during a slow native resize.
    if (operation !== observedTransition) {
      observedTransition = operation;
      void operation.then(confirmed => {
        if (observedTransition !== operation) return;
        observedTransition = undefined;
        const currentDesired = (state.notification !== null && !state.notification.notification.compact) || state.base.kind === 'expanded';
        if (confirmed !== currentDesired && !state.notification && transition.desired === confirmed) {
          state = reduceIsland(state, confirmed ? { type: 'expand' } : { type: 'collapse' });
          if (!state.hidden && !document.hidden) render();
        }
      });
    }
  }
  scheduleClock();
}

function renderPreferences(): void {
  windowsPreferences.render();
  element<HTMLInputElement>('reduce-motion').checked = shouldReduceMotion(state.preferences, systemMotion.matches);
  element<HTMLInputElement>('reduce-motion').disabled = systemMotion.matches;
  element('motion-hint').textContent = systemMotion.matches ? 'Activado por la accesibilidad de Windows.' : 'Transiciones más discretas.';
  element<HTMLInputElement>('notifications-enabled').checked = state.preferences.notifications_enabled;
  element<HTMLInputElement>('privacy-mode').checked = state.preferences.privacy_mode;
  element<HTMLInputElement>('media-enabled').checked = state.preferences.media_enabled;
  element<HTMLInputElement>('mascot-enabled').checked = state.preferences.mascot_enabled;
  element<HTMLSelectElement>('horizontal-position').value = String(state.preferences.horizontal_position);
  element<HTMLInputElement>('top-gap').value = String(state.preferences.top_gap);
}

function savePreferences(patch: Partial<Preferences>): void {
  const mediaRequest = patch.media_enabled === undefined ? 0 : ++mediaRequestSerial;
  if (patch.media_enabled !== undefined) requestedMedia = patch.media_enabled;
  // Serialize saves and derive each patch from the last confirmed native value.
  preferenceWrite = preferenceWrite.then(async () => {
    try {
      const saved = await bridge.save({ ...state.preferences, ...patch });
      dispatch({ type: 'preferences', value: saved });
      renderPreferences();
    } catch (error) {
      // A preference can be persisted even if a dependent Windows provider fails.
      // Re-read the authoritative value instead of inventing a successful rollback.
      try { dispatch({ type: 'preferences', value: await bridge.settings() }); }
      catch { /* Keep the last confirmed settings; report the original operation. */ }
      report(error); renderPreferences();
    } finally {
      if (mediaRequest && mediaRequest === mediaRequestSerial) {
        requestedMedia = undefined;
        mediaInbox.setEnabled(state.preferences.media_enabled);
        try { receiveMedia(await bridge.media(), true); }
        catch (error) { report(error); }
      }
    }
  });
}

toggle.addEventListener('click', () => {
  if (state.notification) dispatch({ type: 'dismiss-notification', now: Date.now() });
  else dispatch(state.base.kind === 'expanded' ? { type: 'collapse' } : { type: 'expand' });
});
island.addEventListener('pointerenter', () => dispatch({ type: 'hover', active: true }));
island.addEventListener('pointerleave', () => dispatch({ type: 'hover', active: false }));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (state.notification) dispatch({ type: 'dismiss-notification', now: Date.now() });
    else dispatch({ type: 'collapse' });
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => dispatch({ type: 'expand', view: button.dataset.view === 'preferences' ? 'preferences' : 'activity' })));
element('pause-events').addEventListener('click', () => dispatch({ type: 'pause-events', paused: !state.eventsPaused }));

element('notification-dismiss').addEventListener('click', () => dispatch({ type: 'dismiss-notification', now: Date.now() }));
element<HTMLInputElement>('reduce-motion').addEventListener('change', event => {
  const reduced = (event.target as HTMLInputElement).checked;
  if (reduced) motion.settle();
  savePreferences({ motion: reduced ? 'reduced' : 'system' });
});
element<HTMLInputElement>('notifications-enabled').addEventListener('change', event => savePreferences({ notifications_enabled: (event.target as HTMLInputElement).checked }));
element<HTMLInputElement>('privacy-mode').addEventListener('change', event => savePreferences({ privacy_mode: (event.target as HTMLInputElement).checked }));
element<HTMLInputElement>('mascot-enabled').addEventListener('change', event => savePreferences({ mascot_enabled: (event.target as HTMLInputElement).checked }));
element<HTMLInputElement>('media-enabled').addEventListener('change', event => {
  const enabled = (event.target as HTMLInputElement).checked;
  if (!enabled) {
    mediaView.render(mediaInbox.setEnabled(false));
    dispatch({ type: 'preferences', value: { ...state.preferences, media_enabled: false } });
  }
  savePreferences({ media_enabled: enabled });
});
element('save-position').addEventListener('click', () => {
  if (!element<HTMLInputElement>('top-gap').reportValidity()) return;
  savePreferences({ monitor_name: element<HTMLSelectElement>('monitor').value || null, horizontal_position: Number(element<HTMLSelectElement>('horizontal-position').value), top_gap: Number(element<HTMLInputElement>('top-gap').value) });
});
element('hide-island').hidden = !isNative;
element('quit-app').hidden = !isNative;
element('hide-island').addEventListener('click', () => void bridge.hide().catch(report));
element('quit-app').addEventListener('click', () => void bridge.quit().catch(report));
systemMotion.addEventListener('change', () => { if (systemMotion.matches) motion.settle(); renderPreferences(); syncCompanion(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) motion.settle();
  dispatch({ type: 'advance', now: Date.now() });
});
window.addEventListener('focus', () => dispatch({ type: 'advance', now: Date.now() }));
window.addEventListener('pageshow', () => { disposed = false; dispatch({ type: 'advance', now: Date.now() }); });
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(clockTimeout); motion.settle(); });
window.addEventListener('beforeunload', () => { unlistenVisibility?.(); unlistenMedia?.(); unlistenView?.(); mediaView.dispose(); windowsPreferences.dispose(); companion.dispose(); welcomeCompanion.dispose(); });

// Local, bounded diagnostics; contains timings only, no titles or system activity.
Object.defineProperty(window, '__NIVO_METRICS__', { value: transitionMetrics });
render();
void (async () => {
  try {
    state = createIslandState(await bridge.settings());
    // Legacy timer storage is intentionally left untouched and is no longer read.
    renderPreferences(); render(); scheduleClock();
  } catch (error) { report(error); }
  try {
    // Subscribe first: the initial snapshot cannot overwrite a newer event.
    unlistenMedia = await bridge.onMedia(receiveMedia);
    receiveMedia(await bridge.media());
  } catch (error) { report(error); }
  try { unlistenView = await bridge.onView(() => dispatch({ type: 'expand', view: 'preferences' })); }
  catch (error) { report(error); }
  try {
    unlistenVisibility = await bridge.onVisibility(visible => {
      if (!visible) motion.settle();
      dispatch({ type: 'visibility', hidden: !visible });
      if (visible) dispatch({ type: 'advance', now: Date.now() });
    });
  } catch (error) { report(error); }
  await windowsPreferences.start();
  toggle.disabled = false;
  try { await bridge.ready(); } catch (error) { report(error); }
})();

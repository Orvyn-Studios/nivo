import { activeMedia, type MediaAction, type MediaSnapshot } from '../media-state.ts';
import type { MediaSession } from '../domain/media.ts';

export interface MediaActions {
  control(sessionId: string, action: MediaAction): Promise<unknown>;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing media interface element: ${id}`);
  return result as T;
}

function timestamp(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${seconds}`
    : `${Math.floor(total / 60)}:${seconds}`;
}

/** DOM is static and actions never optimistically change Windows playback state. */
export function createMediaView(actions: MediaActions): { render(snapshot: MediaSnapshot): void; setMotion(reduced: boolean): void; dispose(): void } {
  const listeners = new AbortController();
  const widget = element('media-widget');
  const island = element('island');
  const empty = element('media-empty');
  const player = element('media-player');
  const artwork = element<HTMLImageElement>('media-artwork');
  const compactArtwork = element<HTMLImageElement>('compact-artwork');
  const fallback = element('media-artwork-fallback');
  const compactFallback = element('compact-media-fallback');
  const previous = element<HTMLButtonElement>('media-previous');
  const playPause = element<HTMLButtonElement>('media-play-pause');
  const next = element<HTMLButtonElement>('media-next');
  const error = element('media-error');
  let current: MediaSnapshot = { sequence: 0, status: 'unavailable', sessions: [], activeSessionId: null, error: null };
  let pending = false;
  let disposed = false;
  let commandError = '';
  let reduced = true;
  let track: MediaSession | null = null;
  let trackRevision = 0;
  let pendingImage: HTMLImageElement | undefined;
  let imageDeadline: ReturnType<typeof setTimeout> | undefined;
  let lastPlaying: boolean | undefined;
  let iconRevision = 0;
  const animations = new Map<Element, Animation>();
  const playIcon = element('media-play-icon');
  const pauseIcon = element('media-pause-icon');
  const trackElement = player.querySelector<HTMLElement>('.media-track')!;

  function animate(target: Element, frames: Keyframe[], duration: number): Promise<void> {
    animations.get(target)?.cancel();
    if (reduced || document.hidden || disposed || !target.getBoundingClientRect().width) return Promise.resolve();
    const animation = target.animate(frames, { duration, easing:'cubic-bezier(.22,1,.36,1)' });
    animations.set(target, animation);
    return animation.finished.catch(() => undefined).then(() => {
      if (animations.get(target) === animation) animations.delete(target);
    });
  }

  function settleIcons(): void {
    playIcon.toggleAttribute('hidden', lastPlaying === true);
    pauseIcon.toggleAttribute('hidden', lastPlaying !== true);
  }

  function playback(playing: boolean): void {
    if (lastPlaying === playing) return;
    const initial = lastPlaying === undefined;
    lastPlaying = playing;
    const revision = ++iconRevision;
    animations.get(playIcon)?.cancel(); animations.get(pauseIcon)?.cancel();
    if (initial || reduced || document.hidden) { settleIcons(); return; }
    const incoming = playing ? pauseIcon : playIcon;
    const outgoing = playing ? playIcon : pauseIcon;
    incoming.removeAttribute('hidden'); outgoing.removeAttribute('hidden');
    void Promise.all([
      animate(incoming, [{opacity:0,transform:'translateY(1px)'},{opacity:1,transform:'translateY(0)'}], 130),
      animate(outgoing, [{opacity:1},{opacity:0}], 100),
    ]).then(() => { if (revision === iconRevision && !disposed) settleIcons(); });
  }

  function cancelImage(): void {
    clearTimeout(imageDeadline); imageDeadline = undefined;
    pendingImage?.removeAttribute('src'); pendingImage = undefined;
  }

  function setArtwork(image: HTMLImageElement, alternate: HTMLElement, source: string | undefined): void {
    if (source && image.getAttribute('src') !== source) image.src = source;
    if (!source) image.removeAttribute('src');
    image.hidden = !source;
    alternate.toggleAttribute('hidden', Boolean(source));
  }

  function updateTrack(session: MediaSession | null): void {
    if (track?.id === session?.id && track?.title === session?.title && track?.artist === session?.artist && track?.artwork === session?.artwork) return;
    track = session;
    const revision = ++trackRevision;
    cancelImage();
    const show = (source?: string, transition = true) => {
      if (revision !== trackRevision || disposed) return;
      // Decode first, then swap artwork and metadata in one task. Old artwork
      // remains visible while loading; obsolete promises cannot replace a track.
      const opacity = Number.parseFloat(getComputedStyle(trackElement).opacity) || 1;
      animations.get(trackElement)?.cancel();
      setArtwork(artwork, fallback, source);
      setArtwork(compactArtwork, compactFallback, source);
      element('media-title').textContent = session?.title || 'Título no disponible';
      element('media-title').title = session?.title ?? '';
      element('media-artist').textContent = session?.artist || 'Artista no disponible';
      element('media-artist').title = session?.artist ?? '';
      if (session && transition) {
        void animate(trackElement, [{opacity:Math.min(.8,opacity),transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}], 170);
        void animate(element('compact-media'), [{opacity:.8},{opacity:1}], 130);
      }
    };
    if (!session?.artwork) { show(); return; }
    // A first frame still has useful text and a fallback while the local bitmap decodes.
    if (!element('media-title').textContent) show(undefined, false);
    const image = new Image(); pendingImage = image;
    image.decoding = 'async'; image.src = session.artwork;
    const finish = (source?: string) => {
      if (revision !== trackRevision || disposed || pendingImage !== image) return;
      clearTimeout(imageDeadline); imageDeadline = undefined; pendingImage = undefined;
      show(source);
    };
    imageDeadline = setTimeout(() => finish(), 1000);
    void image.decode().then(() => finish(session.artwork), () => finish());
  }

  function draw(): void {
    if (disposed) return;
    const session = activeMedia(current);
    const hasSession = session !== null;
    widget.setAttribute('aria-busy', String(pending));
    widget.dataset.state = current.status;
    empty.hidden = hasSession;
    player.hidden = !hasSession;
    element('compact-media').hidden = !hasSession;
    island.dataset.media = String(hasSession);
    island.dataset.playback = session?.playback ?? 'none';
    updateTrack(session);
    const preview = document.body.dataset.environment === 'preview';
    const message = preview
      ? ['Tu música, en Windows.', 'El reproductor se conecta al abrir la aplicación Nivo.']
      : current.status === 'connecting'
        ? ['Tu música, aquí.', 'Conectando con las sesiones multimedia de Windows.']
      : current.status === 'disabled'
      ? ['La m\u00fasica, a tu manera.', 'La integraci\u00f3n multimedia est\u00e1 desactivada en Preferencias.']
      : current.status === 'unavailable'
        ? ['Tu m\u00fasica, aqu\u00ed.', 'Windows no ha podido conectar el reproductor.']
        : current.sessions.length
          ? ['Tu m\u00fasica, aqu\u00ed.', 'Esperando la sesi\u00f3n activa de Windows.']
          : ['Un espacio para tu m\u00fasica.', 'Reproduce contenido en una aplicaci\u00f3n compatible con Windows.'];
    element('media-empty-title').textContent = message[0] ?? '';
    element('media-empty-description').textContent = message[1] ?? '';
    error.textContent = commandError || current.error || '';
    error.hidden = !error.textContent;
    previous.disabled = pending || !session?.canPrevious;
    playPause.disabled = pending || !session?.canPlayPause;
    next.disabled = pending || !session?.canNext;
    previous.title = session?.canPrevious ? 'Pista anterior' : 'El reproductor no permite retroceder';
    next.title = session?.canNext ? 'Pista siguiente' : 'El reproductor no permite avanzar';
    playPause.title = session?.canPlayPause ? (session.playback === 'playing' ? 'Pausar' : 'Reproducir') : 'El reproductor no permite cambiar la reproducci\u00f3n';
    playPause.setAttribute('aria-label', playPause.title);
    playback(session?.playback === 'playing');
    element('media-playback').textContent = session
      ? ({ playing: 'En reproducci\u00f3n', paused: 'En pausa', stopped: 'Detenido' })[session.playback] : '';
    const hasTimeline = session?.positionMs !== null && session?.positionMs !== undefined &&
      session.durationMs !== null && session.durationMs > 0;
    element('media-timeline').hidden = !hasTimeline;
    if (hasTimeline && session && session.positionMs !== null && session.durationMs !== null) {
      const progress = element<HTMLProgressElement>('media-progress');
      progress.max = session.durationMs;
      progress.value = session.positionMs;
      element('media-elapsed').textContent = timestamp(session.positionMs);
      element('media-duration').textContent = timestamp(session.durationMs);
    } else {
      element('media-elapsed').textContent = ''; element('media-duration').textContent = '';
      element<HTMLProgressElement>('media-progress').value = 0;
    }
  }

  async function run(operation: () => Promise<unknown>, sessionId: string): Promise<void> {
    if (pending || disposed) return;
    pending = true; commandError = ''; draw();
    try {
      if (await operation() === false) throw new Error('Windows no ha aceptado el control multimedia.');
    } catch {
      // A closed/replaced session must not report its error over the new player's content.
      if (!disposed && (current.activeSessionId === sessionId || current.activeSessionId === null)) {
        commandError = 'No se ha podido aplicar el control. Comprueba que el reproductor sigue abierto e int\u00e9ntalo de nuevo.';
      }
    } finally { pending = false; draw(); }
  }

  for (const [button, action] of [[previous, 'previous'], [playPause, 'playPause'], [next, 'next']] as const) {
    button.addEventListener('click', () => {
      const session = activeMedia(current);
      if (session && !button.disabled) void run(() => actions.control(session.id, action), session.id);
    }, { signal: listeners.signal });
  }
  for (const [image, alternate] of [[artwork, fallback], [compactArtwork, compactFallback]] as const) {
    image.addEventListener('error', () => {
      const source = image.getAttribute('src');
      // Ignore a late error from a replaced source; decoded candidates are already validated.
      if (!source || source !== track?.artwork) return;
      image.hidden = true; alternate.removeAttribute('hidden');
    }, { signal: listeners.signal });
  }

  return {
    setMotion(value) {
      reduced = value;
      island.dataset.mediaReduced = String(value);
      if (value) {
        ++iconRevision;
        for (const animation of animations.values()) animation.cancel();
        animations.clear(); settleIcons();
      }
    },
    render(snapshot) {
      if (disposed) return;
      if (snapshot.sequence !== current.sequence) commandError = '';
      current = snapshot; draw();
    },
    dispose() {
      ++trackRevision; cancelImage();
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      current = { sequence: 0, status: 'disabled', sessions: [], activeSessionId: null, error: null };
      commandError = ''; pending = false; draw();
      disposed = true; listeners.abort();
    },
  };
}

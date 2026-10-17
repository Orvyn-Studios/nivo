import { activeMedia, type MediaAction, type MediaSnapshot } from '../media-state.ts';

export interface MediaActions {
  control(sessionId: string, action: MediaAction): Promise<unknown>;
  select(sessionId: string): Promise<unknown>;
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
export function createMediaView(actions: MediaActions): { render(snapshot: MediaSnapshot): void; dispose(): void } {
  const listeners = new AbortController();
  const widget = element('media-widget');
  const island = element('island');
  const empty = element('media-empty');
  const player = element('media-player');
  const artwork = element<HTMLImageElement>('media-artwork');
  const compactArtwork = element<HTMLImageElement>('compact-artwork');
  const fallback = element('media-artwork-fallback');
  const compactFallback = element('compact-media-fallback');
  const selector = element<HTMLSelectElement>('media-session-select');
  const previous = element<HTMLButtonElement>('media-previous');
  const playPause = element<HTMLButtonElement>('media-play-pause');
  const next = element<HTMLButtonElement>('media-next');
  const error = element('media-error');
  let current: MediaSnapshot = { sequence: 0, status: 'unavailable', sessions: [], activeSessionId: null, error: null };
  let pending = false;
  let disposed = false;
  let commandError = '';
  let lastOptions = '';
  const failedArtwork = new WeakMap<HTMLImageElement, string>();

  function setArtwork(image: HTMLImageElement, alternate: HTMLElement, source: string | undefined): void {
    if (!source) failedArtwork.delete(image);
    if (source && failedArtwork.get(image) === source) source = undefined;
    if (source && image.getAttribute('src') !== source) image.src = source;
    if (!source) image.removeAttribute('src');
    image.hidden = !source;
    alternate.hidden = Boolean(source);
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
    setArtwork(artwork, fallback, session?.artwork);
    setArtwork(compactArtwork, compactFallback, session?.artwork);
    const optionsKey = JSON.stringify([Boolean(current.activeSessionId), current.sessions.map(item => [item.id, item.title])]);
    if (optionsKey !== lastOptions) {
      selector.replaceChildren();
      if (!current.activeSessionId && current.sessions.length) {
        const option = document.createElement('option');
        option.value = ''; option.textContent = 'Elegir reproductor'; option.disabled = true;
        selector.append(option);
      }
      for (const item of current.sessions) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.title || item.id;
        selector.append(option);
      }
      lastOptions = optionsKey;
    }
    selector.value = current.activeSessionId ?? '';
    selector.disabled = pending || current.status !== 'ready';
    element('media-session-switch').hidden = (current.sessions.length < 2 && hasSession) || current.sessions.length === 0;
    const preview = document.body.dataset.environment === 'preview';
    const message = preview
      ? ['Tu música, en Windows.', 'El reproductor se conecta al abrir la aplicación Nivo. El temporizador está disponible aquí.']
      : current.status === 'connecting'
        ? ['Tu música, aquí.', 'Conectando con las sesiones multimedia de Windows.']
      : current.status === 'disabled'
      ? ['La m\u00fasica, a tu manera.', 'La integraci\u00f3n multimedia est\u00e1 desactivada en Preferencias.']
      : current.status === 'unavailable'
        ? ['Tu m\u00fasica, aqu\u00ed.', 'Windows no ha podido conectar el reproductor. El temporizador sigue disponible.']
        : current.sessions.length
          ? ['Elige qu\u00e9 escuchar.', 'Selecciona un reproductor para mostrar sus controles.']
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
    element('media-play-icon').hidden = session?.playback === 'playing';
    element('media-pause-icon').hidden = session?.playback !== 'playing';
    element('media-title').textContent = session?.title || 'T\u00edtulo no disponible';
    element('media-title').title = session?.title ?? '';
    element('media-artist').textContent = session?.artist || 'Artista no disponible';
    element('media-artist').title = session?.artist ?? '';
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
  selector.addEventListener('change', () => {
    const id = selector.value;
    if (current.sessions.some(session => session.id === id)) void run(() => actions.select(id), id);
  }, { signal: listeners.signal });
  for (const [image, alternate] of [[artwork, fallback], [compactArtwork, compactFallback]] as const) {
    image.addEventListener('error', () => {
      const source = image.getAttribute('src');
      if (source) failedArtwork.set(image, source);
      image.hidden = true; alternate.hidden = false;
    }, { signal: listeners.signal });
  }

  return {
    render(snapshot) {
      if (disposed) return;
      if (snapshot.sequence !== current.sequence) commandError = '';
      current = snapshot; draw();
    },
    dispose() {
      current = { sequence: 0, status: 'disabled', sessions: [], activeSessionId: null, error: null };
      commandError = ''; pending = false; draw();
      disposed = true; listeners.abort();
    },
  };
}

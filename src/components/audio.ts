import { emptyAudio, type AudioAction, type AudioSnapshot } from '../audio-state.ts';

export function createAudioView(actions: { control(action: AudioAction): Promise<unknown>; refresh(): Promise<AudioSnapshot>; settings(): Promise<unknown> }, report: (error: unknown) => void) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const listeners = new AbortController();
  let current = emptyAudio();
  let pending = false, disposed = false;
  const rows = new Map<string, HTMLElement>();
  function range(value: number, id: string, kind: string, name: string): HTMLInputElement {
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.value = String(Math.round(value * 100)); input.dataset.id = id; input.dataset.kind = kind;
    input.setAttribute('aria-label', `Volumen de ${name}`); return input;
  }
  function draw(): void {
    if (disposed) return;
    get('audio-panel').setAttribute('aria-busy', String(pending));
    get('audio-empty').hidden = current.status === 'ready';
    get('audio-controls').hidden = current.status !== 'ready';
    get('audio-empty').textContent = current.status === 'disabled' ? 'Activa Audio de Windows en Preferencias para usar el volumen y el micrófono.'
      : current.status === 'connecting' ? 'Conectando con Windows…' : current.error || 'Core Audio no está disponible en este entorno.';
    get('output-name').textContent = current.output?.name ?? 'Sin salida predeterminada';
    get('output-level').textContent = current.output ? `${Math.round(current.output.volume * 100)} %` : '—';
    const master = get<HTMLInputElement>('output-volume');
    master.value = String(Math.round((current.output?.volume ?? 0) * 100)); master.disabled = pending || !current.output;
    const mute = get<HTMLButtonElement>('output-mute'); mute.disabled = pending || !current.output;
    mute.textContent = current.output?.muted ? 'Activar sonido' : 'Silenciar'; mute.setAttribute('aria-pressed', String(current.output?.muted ?? false));
    get('input-name').textContent = current.input?.name ?? 'Sin entrada predeterminada';
    const mic = get<HTMLButtonElement>('input-mute'); mic.disabled = pending || !current.input;
    mic.textContent = current.input?.muted ? 'Quitar silencio' : 'Silenciar micrófono'; mic.setAttribute('aria-pressed', String(current.input?.muted ?? false));
    const list = get('audio-sessions');
    const ids = new Set(current.sessions.map(value => value.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    for (const session of current.sessions) {
      let row = rows.get(session.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'audio-session';
        const name = document.createElement('span'); name.className = 'audio-session-name'; row.append(name);
        row.append(range(session.volume, session.id, 'sessionVolume', session.name));
        const level = document.createElement('output'); level.className = 'audio-session-level'; row.append(level);
        const button = document.createElement('button'); button.dataset.id = session.id; button.dataset.kind = 'sessionMute'; row.append(button);
        rows.set(session.id, row); list.append(row);
      }
      row.querySelector('span')!.textContent = session.name;
      row.querySelector('span')!.title = session.name;
      const slider = row.querySelector('input')!; slider.value = String(Math.round(session.volume * 100)); slider.disabled = pending;
      row.querySelector('output')!.textContent = `${Math.round(session.volume * 100)} %`;
      slider.setAttribute('aria-label', `Volumen de ${session.name}`);
      const button = row.querySelector('button')!; button.textContent = session.muted ? 'Activar' : 'Silenciar'; button.disabled = pending;
      button.setAttribute('aria-label', `${session.muted ? 'Activar' : 'Silenciar'} ${session.name}`);
      button.setAttribute('aria-pressed', String(session.muted));
    }
    get('audio-sessions-empty').hidden = current.sessions.length > 0;
    get('output-devices').textContent = current.devices.length ? current.devices.map(value => value.name).join(' · ') : 'Sin salidas disponibles';
  }
  async function run(action: AudioAction): Promise<void> {
    if (pending || disposed || current.status !== 'ready') return;
    pending = true; draw();
    try { await actions.control(action); }
    catch (error) { report(error); }
    finally {
      try { current = await actions.refresh(); } catch (error) { report(error); }
      pending = false; draw();
    }
  }
  get('output-volume').addEventListener('change', event => {
    if (current.output) void run({ kind: 'outputVolume', id: current.output.id, value: Number((event.target as HTMLInputElement).value) / 100 });
  }, { signal: listeners.signal });
  get('output-mute').addEventListener('click', () => { if (current.output) void run({ kind: 'outputMute', id: current.output.id, muted: !current.output.muted }); }, { signal: listeners.signal });
  get('input-mute').addEventListener('click', () => { if (current.input) void run({ kind: 'inputMute', id: current.input.id, muted: !current.input.muted }); }, { signal: listeners.signal });
  get('audio-sessions').addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.matches('input[data-kind=sessionVolume]') && input.dataset.id) void run({ kind: 'sessionVolume', id: input.dataset.id, value: Number(input.value) / 100 });
  }, { signal: listeners.signal });
  get('audio-sessions').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-kind=sessionMute]');
    const session = current.sessions.find(value => value.id === button?.dataset.id);
    if (session) void run({ kind: 'sessionMute', id: session.id, muted: !session.muted });
  }, { signal: listeners.signal });
  get('sound-settings').addEventListener('click', () => void actions.settings().catch(report), { signal: listeners.signal });
  return { render(value: AudioSnapshot) { current = value; draw(); }, dispose() { disposed = true; listeners.abort(); rows.clear(); } };
}

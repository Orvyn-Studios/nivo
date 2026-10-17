import type { DroppedFile, DropAction } from '../drop-state.ts';

export function createDropView(run: (action: DropAction, id?: string) => Promise<string>, report: (error: unknown) => void) {
  const list = document.getElementById('drop-list')!;
  const status = document.getElementById('drop-status')!;
  const zip = document.getElementById('drop-zip') as HTMLButtonElement;
  const listeners = new AbortController();
  let busy = false;
  let epoch = 0;
  async function action(kind: DropAction, id?: string): Promise<void> {
    if (busy) return;
    busy = true;
    const current = epoch;
    document.getElementById('drop')!.setAttribute('aria-busy', 'true');
    for (const button of list.querySelectorAll('button')) button.disabled = true;
    zip.disabled = true;
    status.textContent = 'Preparando…';
    try { const message = await run(kind, id); if (current === epoch) status.textContent = message; }
    catch (error) { if (current === epoch) { status.textContent = 'No se completó la acción.'; report(error); } }
    finally {
      busy = false;
      document.getElementById('drop')!.setAttribute('aria-busy', 'false');
      for (const button of list.querySelectorAll('button')) button.disabled = false;
      zip.disabled = !list.childElementCount;
    }
  }
  list.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (button) void action(button.dataset.action as DropAction, button.dataset.id);
  }, { signal: listeners.signal });
  zip.addEventListener('click', () => void action('zip'), { signal: listeners.signal });
  return {
    render(files: DroppedFile[], privacy: boolean) {
      epoch++;
      list.replaceChildren();
      status.textContent = files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} · originales intactos` : 'Suelta hasta 16 archivos locales sobre Nivo.';
      for (const [index, file] of files.entries()) {
        const row = document.createElement('section'); row.className = 'audio-section drop-file';
        const title = document.createElement('h2'); title.textContent = privacy ? `Archivo ${index + 1}` : file.name;
        row.append(title);
        const actions = document.createElement('div'); actions.className = 'drop-actions';
        for (const [kind, label] of [['copyPath', 'Copiar ruta'], ['openFolder', 'Ver carpeta'], ['copy', 'Guardar copia…']] as const) {
          const button = document.createElement('button'); button.className = 'text-action'; button.textContent = label;
          button.dataset.action = kind; button.dataset.id = file.id; button.disabled = busy; actions.append(button);
        }
        row.append(actions);
        list.append(row);
      }
      zip.disabled = busy || !files.length;
    },
    dispose() { epoch++; listeners.abort(); },
  };
}

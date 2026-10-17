import { bridge, isNative, type Display } from '../bridge.ts';
import type { Preferences } from '../domain/index.ts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing Windows preference: ${id}`);
  return result as T;
}

export function createWindowsPreferences(options: {
  preferences(): Preferences;
  save(patch: Partial<Preferences>): void;
  report(error: unknown): void;
}): { start(): Promise<void>; render(): void; dispose(): void } {
  const startup = element<HTMLInputElement>('start-with-windows');
  const fullscreen = element<HTMLInputElement>('hide-fullscreen');
  const monitor = element<HTMLSelectElement>('monitor');
  const listeners = new AbortController();
  let unlisten: (() => void) | undefined;
  let disposed = false;
  element('startup-setting').hidden = !isNative;
  fullscreen.disabled = !isNative;
  fullscreen.addEventListener('change', () => options.save({ hide_in_fullscreen: fullscreen.checked }), { signal: listeners.signal });
  startup.addEventListener('change', () => {
    const requested = startup.checked;
    startup.disabled = true;
    void (async () => {
      let confirmed = false;
      try { startup.checked = await bridge.setAutostart(requested); confirmed = true; }
      catch (error) {
        try { startup.checked = await bridge.autostart(); confirmed = true; }
        catch { startup.indeterminate = true; }
        options.report(error);
      } finally { if (!disposed) startup.disabled = !confirmed; }
    })();
  }, { signal: listeners.signal });

  function displays(values: Display[]): void {
    if (disposed) return;
    const selected = options.preferences().monitor_name;
    const primary = document.createElement('option');
    primary.value = ''; primary.textContent = 'Pantalla principal';
    const items: HTMLOptionElement[] = [primary];
    for (const display of values) {
      if (!display.name) continue;
      const option = document.createElement('option');
      option.value = display.name;
      option.textContent = `${display.name}${display.primary ? ' · Principal' : ''} · ${display.width} × ${display.height}`;
      items.push(option);
    }
    const missing = selected !== null && !items.some(option => option.value === selected);
    if (missing) {
      const unavailable = document.createElement('option');
      unavailable.value = selected; unavailable.textContent = 'Pantalla guardada desconectada'; unavailable.disabled = true;
      items.push(unavailable);
    }
    monitor.replaceChildren(...items); monitor.value = selected ?? ''; monitor.disabled = false;
    element<HTMLButtonElement>('save-position').disabled = false;
    element('position-hint').textContent = missing
      ? 'Nivo usa la pantalla principal hasta que vuelva la pantalla guardada.'
      : 'La posición se ajusta al escalado de la pantalla elegida.';
  }

  return {
    async start() {
      if (!isNative || disposed) return;
      try {
        const remove = await bridge.onDisplays(displays);
        if (disposed) { remove(); return; }
        unlisten = remove;
        displays(await bridge.displays());
      } catch (error) { if (!disposed) options.report(error); }
      try { const enabled = await bridge.autostart(); if (!disposed) { startup.checked = enabled; startup.disabled = false; } }
      catch (error) { if (!disposed) options.report(error); }
    },
    render() { fullscreen.checked = options.preferences().hide_in_fullscreen; },
    dispose() { disposed = true; unlisten?.(); listeners.abort(); },
  };
}

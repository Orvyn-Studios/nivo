import { bridge, isNative } from './bridge.ts';
import { parsePreferences, shouldReduceMotion, type Preferences } from './domain/index.ts';
import { createWindowsPreferences } from './components/windows-preferences.ts';

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let preferences = parsePreferences(null), pending = Promise.resolve();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const categories = [
  ['general', 'General', 'A tu ritmo.', 'El lugar y el momento de Nivo.'],
  ['appearance', 'Apariencia', 'Una presencia discreta.', 'Pequeños detalles que se sienten tuyos.'],
  ['audio', 'Audio', 'Tu sonido, a mano.', 'Controles de Windows, sin grabar audio.'],
  ['activity', 'Actividad', 'Solo cuando importa.', 'Elige qué merece un aviso.'],
  ['integrations', 'Integraciones', 'Conecta lo que utilizas.', 'Cada integración es opcional. Tú decides.'],
  ['privacy', 'Privacidad', 'Tu espacio es tuyo.', 'Sin cuentas, telemetría ni historial de actividad.'],
  ['about', 'Acerca de Nivo', 'Nivo by Orvyn.', 'Una isla pequeña. Un poco más de calma.'],
] as const;
const groups = new Map<string, HTMLElement>();
for (const [id, label, title, description] of categories) {
  const button = document.createElement('button'); button.textContent = label; button.dataset.category = id;
  get('settings-navigation').append(button);
  const section = document.createElement('section'); section.id = `settings-${id}`; section.className = 'settings-page';
  const heading = document.createElement('h1'); heading.textContent = title;
  const intro = document.createElement('p'); intro.className = 'settings-intro'; intro.textContent = description;
  section.append(heading, intro); get('settings-content').append(section); groups.set(id, section);
}
function move(id: string, group: string): void {
  const node = get(id); if (!node) return;
  groups.get(group)!.append(node.closest('.setting') ?? node);
}
for (const id of ['startup-setting', 'hide-fullscreen']) move(id, 'general');
const position = get('monitor').closest('.position-settings') ?? get('monitor').parentElement!;
groups.get('general')!.append(position, get('position-hint'));
for (const id of ['mascot-enabled', 'reduce-motion']) move(id, 'appearance');
move('audio-enabled', 'audio');
for (const id of ['notifications-enabled', 'caps-lock-enabled', 'num-lock-enabled']) move(id, 'activity');
move('battery-settings', 'activity');
for (const id of ['media-enabled', 'integrations-enabled', 'drop-enabled']) move(id, 'integrations');
move('privacy-mode', 'privacy');
const about = document.createElement('p'); about.className = 'about-version';
about.textContent = '0.1.0 · Alpha\nHecho para Windows. Datos locales.\nLas integraciones dependen de las capacidades de Windows y de cada aplicación.';
groups.get('about')!.append(about);
function select(category: string): void {
  if (!groups.has(category)) category = 'general';
  for (const [id, section] of groups) section.hidden = id !== category;
  for (const button of get('settings-navigation').querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.category === category ? 'page' : 'false');
}
get('settings-navigation').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-category]');
  if (button) select(button.dataset.category!);
});
select(location.hash.slice(1) || 'general');
function report(error: unknown): void { get('settings-status').textContent = error instanceof Error ? error.message : String(error); }
const windows = createWindowsPreferences({ preferences: () => preferences, save, report });
const toggles: Record<string, keyof Preferences> = { 'mascot-enabled': 'mascot_enabled', 'privacy-mode': 'privacy_mode',
  'media-enabled': 'media_enabled', 'audio-enabled': 'audio_enabled', 'notifications-enabled': 'notifications_enabled',
  'battery-enabled': 'battery_enabled', 'battery-full': 'battery_full_notice', 'caps-lock-enabled': 'caps_lock_enabled',
  'num-lock-enabled': 'num_lock_enabled', 'integrations-enabled': 'integrations_enabled', 'drop-enabled': 'drop_enabled' };
function render(): void {
  for (const [id, key] of Object.entries(toggles)) get<HTMLInputElement>(id).checked = preferences[key] === true;
  get<HTMLInputElement>('reduce-motion').checked = shouldReduceMotion(preferences, motion.matches);
  get<HTMLInputElement>('reduce-motion').disabled = motion.matches;
  get('motion-hint').textContent = motion.matches ? 'Activado por Windows.' : 'Movimiento más discreto.';
  get<HTMLSelectElement>('horizontal-position').value = String(preferences.horizontal_position);
  get<HTMLInputElement>('top-gap').value = String(preferences.top_gap);
  preferences.battery_thresholds.forEach((value, index) => { get<HTMLInputElement>(`battery-threshold-${index}`).value = String(value); });
  windows.render();
}
function save(patch: Partial<Preferences>): void {
  pending = pending.then(async () => {
    try { preferences = await bridge.save({ ...preferences, ...patch }); get('settings-status').textContent = 'Guardado'; }
    catch (error) { try { preferences = await bridge.settings(); } catch { /* Retain confirmed value. */ } report(error); }
    render();
  });
}
for (const [id, key] of Object.entries(toggles)) get(id).addEventListener('change', () => save({ [key]: get<HTMLInputElement>(id).checked }));
get('reduce-motion').addEventListener('change', () => save({ motion: get<HTMLInputElement>('reduce-motion').checked ? 'reduced' : 'system' }));
get('save-position').addEventListener('click', () => {
  if (!get<HTMLInputElement>('top-gap').reportValidity()) return;
  save({ monitor_name: get<HTMLSelectElement>('monitor').value || null, horizontal_position: Number(get<HTMLSelectElement>('horizontal-position').value), top_gap: Number(get<HTMLInputElement>('top-gap').value) });
});
get('battery-threshold-save').addEventListener('click', () => {
  const [low, middle, critical] = [0, 1, 2].map(index => Number(get<HTMLInputElement>(`battery-threshold-${index}`).value));
  if (low === undefined || middle === undefined || critical === undefined || ![low, middle, critical].every(Number.isSafeInteger) || critical < 1 || critical >= middle || middle >= low || low > 80) {
    report('Usa crítica < importante < baja, entre 1 y 80 %.'); return;
  }
  save({ battery_thresholds: [low, middle, critical] });
});
motion.addEventListener('change', render);
document.addEventListener('keydown', event => { if (event.key === 'Escape') void pending.then(() => bridge.closePreferences()).catch(report); });
window.addEventListener('beforeunload', () => windows.dispose());
void (async () => {
  try { preferences = await bridge.settings(); render(); await windows.start();
    const power = await bridge.power(); get('battery-settings').hidden = power?.present === false;
  } catch (error) { report(error); }
  document.body.dataset.environment = isNative ? 'native' : 'preview';
  document.body.dataset.ready = 'true';
})();

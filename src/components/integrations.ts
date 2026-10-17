import { downloadProgress, type IntegrationInbox } from '../integration-state.ts';
export function renderIntegrations(inbox: IntegrationInbox, privateMode: boolean): void {
  const root = document.getElementById('integration-activity')!;
  const activeAgents = [...inbox.agents.values()].filter(value => value === 'working' || value === 'waiting' || value === 'review');
  const downloads = [...inbox.downloads.values()].filter(value => value.state === 'active' || value.state === 'activity');
  root.hidden = activeAgents.length === 0 && downloads.length === 0;
  const agent = document.getElementById('agent-status')!;
  agent.hidden = activeAgents.length === 0;
  agent.textContent = activeAgents.includes('review') ? 'Codex · Revisión necesaria' : activeAgents.includes('working') ? 'Codex está trabajando' : 'Codex · En espera';
  const list = document.getElementById('download-activity')!;
  list.replaceChildren();
  for (const event of downloads) {
    const row = document.createElement('div'); row.className = 'download-row';
    const label = document.createElement('p'); label.textContent = privateMode ? 'Transferencia privada' : event.name; row.append(label);
    const progress = downloadProgress(event);
    const detail = document.createElement('span'); detail.className = 'detail-note';
    detail.textContent = event.state === 'activity' ? 'Actividad detectada · sin progreso confirmado' : progress === undefined ? 'Descargando · tamaño desconocido' : `${Math.round(progress * 100)} %`;
    if (event.bytesPerSecond !== null && event.state === 'active') detail.textContent += ` · ${(event.bytesPerSecond / 1024).toFixed(0)} KiB/s`;
    row.append(detail);
    if (progress !== undefined) { const bar = document.createElement('progress'); bar.max = 1; bar.value = progress; bar.setAttribute('aria-label', privateMode ? 'Progreso de transferencia' : `Progreso de ${event.name}`); row.append(bar); }
    list.append(row);
  }
}

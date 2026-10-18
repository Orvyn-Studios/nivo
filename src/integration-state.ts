import type { IslandNotification } from './domain/event-coordinator.ts';
export type AgentStatus = 'working' | 'waiting' | 'review' | 'complete' | 'error';
export interface AgentEvent { kind: 'agent'; taskId: string; status: AgentStatus }
export interface DownloadEvent { kind: 'download'; id: string; source: 'browser' | 'bits' | 'folder'; name: string;
  state: 'active' | 'complete' | 'error' | 'activity'; received: number | null; total: number | null; bytesPerSecond: number | null }
export type IntegrationEvent = AgentEvent | DownloadEvent;
const bounded = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function parseIntegrationEvent(value: unknown): IntegrationEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.kind === 'agent' && bounded(item.taskId, 128) && ['working', 'waiting', 'review', 'complete', 'error'].includes(item.status as string))
    return { kind: 'agent', taskId: item.taskId as string, status: item.status as AgentStatus };
  if (item.kind !== 'download' || !bounded(item.id, 128) || !bounded(item.name, 256) || !['browser', 'bits', 'folder'].includes(item.source as string)
    || !['active', 'complete', 'error', 'activity'].includes(item.state as string)) return null;
  return { kind: 'download', id: item.id as string, name: item.name as string, source: item.source as DownloadEvent['source'], state: item.state as DownloadEvent['state'],
    received: amount(item.received), total: amount(item.total), bytesPerSecond: typeof item.bytesPerSecond === 'number' && Number.isFinite(item.bytesPerSecond) && item.bytesPerSecond >= 0 ? item.bytesPerSecond : null };
}
export function downloadProgress(event: DownloadEvent): number | undefined {
  return event.source !== 'folder' && event.state !== 'activity' && event.total !== null && event.total > 0 && event.received !== null && event.received <= event.total ? event.received / event.total : undefined;
}
export class IntegrationInbox {
  readonly agents = new Map<string, AgentStatus>();
  private readonly cycles = new Map<string,number>();
  readonly downloads = new Map<string, DownloadEvent>();
  clear(): void { this.agents.clear(); this.cycles.clear(); this.downloads.clear(); }
  receive(event: IntegrationEvent): IslandNotification[] {
    if (event.kind === 'agent') {
      const previous = this.agents.get(event.taskId);
      if(previous===event.status)return[];
      const terminal=previous==='complete'||previous==='error';
      if(terminal&&event.status!=='working')return[];
      if(terminal)this.cycles.set(event.taskId,((this.cycles.get(event.taskId)??0)+1)%2_147_483_647);
      this.agents.set(event.taskId, event.status);
      if (this.agents.size > 8) {const oldest=this.agents.keys().next().value!;this.agents.delete(oldest);this.cycles.delete(oldest);}
      if (event.status === 'working' || event.status === 'waiting') return [];
      return [{ id: `agent:${event.taskId}:${this.cycles.get(event.taskId)??0}:${event.status}`, kind: 'agent', source: 'Codex', groupKey: `agent:${event.taskId}`,
        title: event.status === 'review' ? 'Revisión necesaria' : event.status === 'complete' ? 'Turno de Codex finalizado' : 'Codex ha informado de un error',
        body: event.status === 'review' ? 'Responde a la solicitud en Codex.' : '',
        priority: event.status === 'review' ? 'critical' : 'high', reaction: event.status === 'review' ? 'attention' : event.status === 'complete' ? 'complete' : 'error' }];
    }
    const previous = this.downloads.get(event.id);
    if (previous?.state === 'complete') return [];
    this.downloads.set(event.id, event);
    if (this.downloads.size > 32) this.downloads.delete(this.downloads.keys().next().value!);
    if (event.state === 'active' || event.state === 'activity' || previous?.state === event.state) return [];
    return [{ id: `download:${event.id}:${event.state}`, kind: 'download', source: event.source === 'browser' ? 'Navegador' : event.source === 'bits' ? 'Windows · BITS' : 'Carpeta observada',
      title: event.state === 'complete' ? 'Descarga finalizada' : 'Descarga interrumpida', body: event.name,
      sensitive: true, priority: 'high', groupKey: `download:${event.id}`, reaction: event.state === 'complete' ? 'download' : 'error' }];
  }
}

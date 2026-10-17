import type { IslandNotification } from './domain/event-coordinator.ts';
import type { Preferences } from './domain/preferences.ts';
export interface PowerSnapshot {
  sequence: number; present: boolean | null; percent: number | null; acOnline: boolean | null;
  charging: boolean | null; saving: boolean; remainingSeconds: number | null;
}
export function parsePowerSnapshot(value: unknown): PowerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.sequence) || (item.sequence as number) < 0 || ![null, true, false].includes(item.present as null | boolean)
    || ![null, true, false].includes(item.acOnline as null | boolean) || typeof item.saving !== 'boolean') return null;
  const present = item.present as boolean | null;
  return { sequence: item.sequence as number, present, acOnline: item.acOnline as boolean | null, saving: item.saving,
    percent: present === true && Number.isInteger(item.percent) && (item.percent as number) >= 0 && (item.percent as number) <= 100 ? item.percent as number : null,
    charging: present === true && typeof item.charging === 'boolean' ? item.charging : null,
    remainingSeconds: present === true && Number.isSafeInteger(item.remainingSeconds) && (item.remainingSeconds as number) >= 0 ? item.remainingSeconds as number : null };
}

export class PowerInbox {
  snapshot: PowerSnapshot | undefined;
  private warned = new Set<number>();
  receive(next: PowerSnapshot, preferences: Preferences): IslandNotification[] {
    const previous = this.snapshot;
    if (previous && next.sequence <= previous.sequence) return [];
    this.snapshot = next;
    if (next.acOnline === true) this.warned.clear();
    if (!previous || !preferences.battery_enabled || next.present !== true || previous.present !== true) return [];
    const events: IslandNotification[] = [];
    const add = (title: string, priority: IslandNotification['priority'] = 'normal') => events.push({ id: `power:${next.sequence}:${events.length}`,
      source: 'Windows · Energía', kind: 'battery', groupKey: 'power', title, body: next.percent === null ? '' : `${next.percent} % de batería`, priority,
      reaction: priority === 'critical' ? 'error' : 'attention' });
    if (next.acOnline !== null && previous.acOnline !== null && next.acOnline !== previous.acOnline) add(next.acOnline ? 'Cargador conectado' : 'Cargador desconectado');
    if (next.acOnline === false && next.percent !== null) {
      const crossed = preferences.battery_thresholds.filter(value => next.percent! <= value && !this.warned.has(value));
      for (const value of crossed) this.warned.add(value);
      if (crossed.length) {
        const threshold = Math.min(...crossed);
        add(threshold <= preferences.battery_thresholds[2] ? 'Batería crítica' : 'Batería baja', threshold <= preferences.battery_thresholds[2] ? 'critical' : 'high');
      }
    }
    if (preferences.battery_full_notice && next.percent === 100 && previous.percent !== 100 && next.acOnline === true && next.charging === false) add('Batería cargada');
    return events;
  }
}

export interface Preferences {
  schema_version: 1;
  theme: 'system' | 'dark' | 'light';
  motion: 'system' | 'reduced' | 'full';
  mascot_enabled: boolean;
  privacy_mode: boolean;
  media_enabled: boolean;
  notifications_enabled: boolean;
  hide_in_fullscreen: boolean;
  monitor_name: string | null;
  horizontal_position: number;
  top_gap: number;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  schema_version: 1,
  theme: 'system',
  motion: 'system',
  mascot_enabled: false,
  privacy_mode: true,
  media_enabled: true,
  notifications_enabled: true,
  hide_in_fullscreen: true,
  monitor_name: null,
  horizontal_position: 0.5,
  top_gap: 8,
});

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unknown versions fail closed; future schema migrations belong at this boundary. */
export function parsePreferences(value: unknown): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!record(value) || value.schema_version !== 1) return result;
  if (value.theme === 'system' || value.theme === 'dark' || value.theme === 'light') result.theme = value.theme;
  if (value.motion === 'system' || value.motion === 'reduced' || value.motion === 'full') result.motion = value.motion;
  for (const key of ['mascot_enabled', 'privacy_mode', 'media_enabled', 'notifications_enabled', 'hide_in_fullscreen'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (typeof value.monitor_name === 'string' && value.monitor_name.trim().length > 0 && value.monitor_name.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value.monitor_name)) {
    result.monitor_name = value.monitor_name;
  }
  if (typeof value.horizontal_position === 'number' && Number.isFinite(value.horizontal_position)) {
    result.horizontal_position = Math.min(1, Math.max(0, value.horizontal_position));
  }
  if (typeof value.top_gap === 'number' && Number.isSafeInteger(value.top_gap)) {
    result.top_gap = Math.min(128, Math.max(0, value.top_gap));
  }
  return result;
}

export function shouldReduceMotion(preferences: Preferences, systemReduced: boolean): boolean {
  // An OS accessibility request always wins, including over a stored "full" choice.
  return systemReduced || preferences.motion === 'reduced';
}

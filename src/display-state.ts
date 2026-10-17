export interface Display {
  name: string | null;
  x: number; y: number; width: number; height: number;
  work_x: number; work_y: number; work_width: number; work_height: number;
  scale_factor: number; primary: boolean;
}

/** Validate physical desktop geometry once at the native boundary. */
export function parseDisplays(value: unknown): Display[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const result: Display[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    if (source.name !== null && (typeof source.name !== 'string' || source.name.length > 256 || /[\u0000-\u001f\u007f]/u.test(source.name))) return null;
    if (typeof source.primary !== 'boolean' || typeof source.scale_factor !== 'number' || !Number.isFinite(source.scale_factor) || source.scale_factor < .25 || source.scale_factor > 16) return null;
    const coordinates = ['x', 'y', 'work_x', 'work_y'] as const;
    const dimensions = ['width', 'height', 'work_width', 'work_height'] as const;
    if (coordinates.some(key => typeof source[key] !== 'number' || !Number.isInteger(source[key]) || source[key] < -2_147_483_648 || source[key] > 2_147_483_647)) return null;
    if (dimensions.some(key => typeof source[key] !== 'number' || !Number.isInteger(source[key]) || source[key] < 1 || source[key] > 2_147_483_647)) return null;
    result.push({
      name: source.name as string | null, primary: source.primary, scale_factor: source.scale_factor,
      x: source.x as number, y: source.y as number, width: source.width as number, height: source.height as number,
      work_x: source.work_x as number, work_y: source.work_y as number,
      work_width: source.work_width as number, work_height: source.work_height as number,
    });
  }
  return result;
}

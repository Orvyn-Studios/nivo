export interface DroppedFile { id: string; name: string; size: number }
export type DropAction = 'copyPath' | 'openFolder' | 'copy' | 'zip';

export function parseDroppedFiles(value: unknown): DroppedFile[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const result: DroppedFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^drop:\d+:\d+$/.test(item.id)
      || typeof item.name !== 'string' || !item.name || item.name.length > 512 || /[\u0000-\u001f/\\]/.test(item.name)
      || !Number.isSafeInteger(item.size) || item.size < 0 || result.some(file => file.id === item.id)) return null;
    result.push({ id: item.id, name: item.name, size: item.size });
  }
  return result;
}

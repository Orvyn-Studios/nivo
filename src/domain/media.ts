export interface MediaSession {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  playback: 'playing' | 'paused' | 'stopped';
  positionMs: number | null;
  durationMs: number | null;
  canPlayPause: boolean;
  canPrevious: boolean;
  canNext: boolean;
  canSeek: boolean;
}

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Validate an adapter payload; absent metadata stays absent, never a demo track. */
export function parseMediaSession(value: unknown): MediaSession | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = text(input.id, 256);
  if (!id.trim() || (typeof input.id === 'string' && input.id.length > 256) || (input.playback !== 'playing' && input.playback !== 'paused' && input.playback !== 'stopped')) return null;
  const durationMs = milliseconds(input.durationMs);
  const positionMs = milliseconds(input.positionMs);
  const result: MediaSession = {
    id, title: text(input.title, 512), artist: text(input.artist, 256),
    playback: input.playback as MediaSession['playback'],
    positionMs: positionMs === null ? null : durationMs === null ? positionMs : Math.min(positionMs, durationMs),
    durationMs,
    canPlayPause: input.canPlayPause === true,
    canPrevious: input.canPrevious === true,
    canNext: input.canNext === true,
    canSeek: input.canSeek === true && durationMs !== null && durationMs > 0,
  };
  if (typeof input.album === 'string') result.album = text(input.album, 256);
  // Artwork is optional local data supplied by the adapter. Never load remote URLs.
  if (typeof input.artwork === 'string' && input.artwork.length <= 2_800_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.artwork)) {
    result.artwork = input.artwork;
  }
  return result;
}

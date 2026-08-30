/**
 * Tracks a user has attached to rownative courses (issue #194 R-8).
 *
 * A rownative course file describes gates, not a path. Until the mirror carries
 * a traced route for every course, the fastest fix for any given course is for
 * someone who has rowed it to attach their own GPX/KML/GeoJSON. Attachments are
 * per-browser and keyed by course id, so re-importing the same course — or
 * following a deep link to it months later — picks the track back up.
 *
 * Storage is `localStorage` and therefore best-effort: a private window, a
 * cleared profile or a browser that blocks site data all read back empty, and
 * every access is guarded so that never breaks an import.
 */

import type { Coordinate } from '../types/index';

const STORAGE_KEY = 'virtualrow.rownative.tracks.v1';

/** Cap per track so one enormous GPS log cannot fill the origin's quota. */
const MAX_POINTS_PER_TRACK = 20_000;

export interface AttachedTrack {
  courseId: string;
  /** File the track came from, shown in the UI so users can tell them apart. */
  fileName: string;
  /** Unix ms. Not read by the resolver; useful when listing attachments. */
  attachedAt: number;
  coordinates: Coordinate[];
}

type StoredTracks = Record<string, AttachedTrack>;

function readStorage(): StoredTracks {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTracks;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(tracks: StoredTracks): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    // Quota or a blocked store: the attachment simply does not survive reload.
  }
}

function isUsable(point: Coordinate): boolean {
  return (
    Number.isFinite(point?.lat)
    && Number.isFinite(point?.lng)
    && point.lat >= -90 && point.lat <= 90
    && point.lng >= -180 && point.lng <= 180
  );
}

export class TrackAttachmentStore {
  /** The track attached to a course, or `null` if there is none. */
  get(courseId: string): AttachedTrack | null {
    const stored = readStorage()[courseId];
    if (!stored || !Array.isArray(stored.coordinates)) return null;
    const coordinates = stored.coordinates.filter(isUsable);
    return coordinates.length >= 2 ? { ...stored, coordinates } : null;
  }

  /** Just the coordinates, which is all the geometry resolver needs. */
  getCoordinates(courseId: string): Coordinate[] | null {
    return this.get(courseId)?.coordinates ?? null;
  }

  /** Attach (or replace) a course's track. Returns what was stored. */
  set(courseId: string, fileName: string, coordinates: Coordinate[], attachedAt = Date.now()): AttachedTrack {
    const usable = coordinates.filter(isUsable).slice(0, MAX_POINTS_PER_TRACK);
    const track: AttachedTrack = { courseId, fileName, attachedAt, coordinates: usable };
    const tracks = readStorage();
    tracks[courseId] = track;
    writeStorage(tracks);
    return track;
  }

  /** Detach a course's track so the next import falls to the next source. */
  remove(courseId: string): void {
    const tracks = readStorage();
    if (!(courseId in tracks)) return;
    delete tracks[courseId];
    writeStorage(tracks);
  }

  /** Every attachment, newest first. */
  list(): AttachedTrack[] {
    return Object.values(readStorage())
      .filter((track) => Array.isArray(track?.coordinates))
      .sort((a, b) => (b.attachedAt ?? 0) - (a.attachedAt ?? 0));
  }

  /** Drop every attachment. Used by tests and by a future "reset" action. */
  clear(): void {
    writeStorage({});
  }
}

export const trackAttachmentStore = new TrackAttachmentStore();

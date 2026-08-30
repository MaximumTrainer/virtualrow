import type { WaterRoute } from '../types/index';
import { routeService, type RownativeRouteImportData } from './routeService';
import {
  resolveCourseGeometry,
  type RownativeCourseGeometryInput,
  type RownativeCoursePolygon,
  type WaterwayPathProvider,
} from './rownativeGeometry';
import { trackAttachmentStore, type TrackAttachmentStore } from './trackAttachmentStore';

// Discovery note (issue #46): rownative Worker API exposes /api/courses and related routes,
// but browser CORS restricts origins to rownative.icu/localhost. VirtualRow therefore reads the
// public course data directly from the rownative/courses repository.
const ROWNATIVE_INDEX_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses/index.json';
const ROWNATIVE_COURSE_BASE_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses';
/** Course JSON is a few kB in practice; cap well above that but below anything abusive. */
const MAX_COURSE_BYTES = 2 * 1024 * 1024;
/** Shape of a rownative course identifier. Exported so callers validate identically. */
export const ROWNATIVE_ROUTE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const ROUTE_ID_PATTERN = ROWNATIVE_ROUTE_ID_PATTERN;
const ALLOWED_ROUTE_URL_HOSTS = new Set(['rownative.icu', 'www.rownative.icu']);
/** Query keys a rownative course link might carry the id in. */
const COURSE_URL_ID_PARAM_KEYS = ['rownativeCourseId', 'courseId', 'id'];
/** Path segments that precede a course id in a rownative course link. */
const COURSE_URL_PATH_SEGMENTS = new Set(['course', 'courses', 'route', 'routes']);

/**
 * The requested course is not in the public GitHub mirror.
 *
 * The live site lists more courses than the mirror carries, so a perfectly real
 * id can 404 here. Carries the id so the UI can offer a search-by-name retry.
 */
export class RownativeCourseNotFoundError extends Error {
  readonly courseId: string;
  constructor(message: string, courseId: string) {
    super(message);
    this.name = 'RownativeCourseNotFoundError';
    this.courseId = courseId;
  }
}

interface RownativeCourseIndexEntry {
  id: string;
  name: string;
  country?: string;
  distance_m?: number;
  status?: string;
}

interface RownativeCourseFile extends RownativeCourseGeometryInput {
  id: string;
  name: string;
  country?: string;
  distance_m?: number;
  status?: string;
  polygons?: RownativeCoursePolygon[];
}

export interface RownativeCourseSummary {
  id: string;
  name: string;
  country: string;
  distanceMeters: number;
  status?: string;
}

export class RownativeService {
  private courseIndexCache: RownativeCourseSummary[] | null = null;
  private courseIndexPromise: Promise<RownativeCourseSummary[]> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly importRoute: (data: RownativeRouteImportData) => WaterRoute;
  private readonly tracks: TrackAttachmentStore;
  /**
   * Optional OSM waterway provider (issue #194 R-12).
   *
   * Left unset: the spike found a path for only 2 of 5 river courses against a
   * "4 of 5" bar, because finish gates sit mid-estuary, far off the mapped
   * centreline. See OsmWaterwayPathProvider for the measurements.
   */
  private readonly osmProvider: WaterwayPathProvider | null;

  constructor(
    // Forwarded through an arrow rather than passing `fetch` directly: stored on
    // an instance field and called as `this.fetchImpl(...)`, a bare `fetch`
    // reference is invoked with the service as its receiver, which browsers
    // reject with "Illegal invocation". Injected test doubles are unaffected.
    fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    importRoute: (data: RownativeRouteImportData) => WaterRoute = (data) => routeService.importRouteFromRownative(data),
    tracks: TrackAttachmentStore = trackAttachmentStore,
    osmProvider: WaterwayPathProvider | null = null,
  ) {
    this.fetchImpl = fetchImpl;
    this.importRoute = importRoute;
    this.tracks = tracks;
    this.osmProvider = osmProvider;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Unable to load rownative course data (HTTP ${response.status}). Please try again.`);
    }
    return response.json() as Promise<T>;
  }

  async getCourseIndex(): Promise<RownativeCourseSummary[]> {
    if (this.courseIndexCache) {
      return this.courseIndexCache;
    }
    if (this.courseIndexPromise) {
      return this.courseIndexPromise;
    }

    this.courseIndexPromise = this.fetchJson<RownativeCourseIndexEntry[]>(ROWNATIVE_INDEX_URL)
      .then((raw) => {
        this.courseIndexCache = raw
          .filter((course) => typeof course.id === 'string' && typeof course.name === 'string')
          .map((course) => ({
            id: course.id,
            name: course.name,
            country: course.country ?? 'Unknown',
            distanceMeters: course.distance_m ?? 0,
            status: course.status,
          }));
        return this.courseIndexCache;
      })
      .finally(() => {
        this.courseIndexPromise = null;
      });
    return this.courseIndexPromise;
  }

  async searchCourses(query: string, limit = 30): Promise<RownativeCourseSummary[]> {
    const allCourses = await this.getCourseIndex();
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return allCourses.slice(0, limit);
    }

    return allCourses
      .filter((course) => course.name.toLowerCase().includes(normalized))
      .slice(0, limit);
  }

  async importCourse(course: RownativeCourseSummary): Promise<WaterRoute> {
    const detail = await this.fetchCourseDetail(course.id);
    // Summary fields stay as fallbacks for anything the course file omits.
    return this.importCourseDetail(detail, course);
  }

  /**
   * Import a course knowing only its identifier.
   *
   * This is the path the rownative.icu handoff uses: the return leg carries a
   * course id, and the course JSON on the public mirror already contains the
   * name, country, distance and status, so no index lookup is needed.
   */
  /**
   * Turn user input into a course id.
   *
   * Accepts a bare id, or a rownative.icu course link the user copied from the
   * address bar. Pure and synchronous: input is fully validated before anything
   * touches the network.
   *
   * rownative.icu is a client-rendered app whose exact course-path shape can't
   * be confirmed by static fetch, so several plausible shapes are accepted —
   * `/course/<id>`, `/courses/<id>`, `?id=`, `?courseId=` and hash-router
   * equivalents. The bare-id path is shape-independent and always works.
   *
   * @throws Error with a message suitable for display when no id can be found.
   */
  resolveCourseId(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Enter a rownative course ID or a rownative.icu course link.');
    }

    // Bare id fast path — the pattern excludes '.', '/' and ':', so this can
    // never swallow a URL.
    if (ROUTE_ID_PATTERN.test(trimmed)) return trimmed;

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('Enter a rownative course ID or a rownative.icu course link.');
    }

    if (url.protocol !== 'https:') {
      throw new Error('Course links must be https:// links on rownative.icu.');
    }
    if (!ALLOWED_ROUTE_URL_HOSTS.has(url.hostname)) {
      throw new Error('Course links must be https:// links on rownative.icu.');
    }

    const fromUrl = this.extractCourseId(url.pathname, url.searchParams);
    if (fromUrl) return fromUrl;

    // Hash-router links: '#/course/5?x=1' — re-parse the fragment as path+query.
    const hash = url.hash.replace(/^#/, '');
    if (hash) {
      const [hashPath, hashQuery] = hash.split('?');
      const fromHash = this.extractCourseId(hashPath, new URLSearchParams(hashQuery ?? ''));
      if (fromHash) return fromHash;
    }

    throw new Error('Could not find a course ID in that link. Paste the course ID instead.');
  }

  private extractCourseId(pathname: string, params: URLSearchParams): string | null {
    const segments = pathname.split('/').filter(Boolean);
    for (let i = 0; i < segments.length - 1; i++) {
      if (COURSE_URL_PATH_SEGMENTS.has(segments[i].toLowerCase()) && ROUTE_ID_PATTERN.test(segments[i + 1])) {
        return segments[i + 1];
      }
    }
    for (const key of COURSE_URL_ID_PARAM_KEYS) {
      const value = params.get(key);
      if (value && ROUTE_ID_PATTERN.test(value)) return value;
    }
    return null;
  }

  /**
   * Load a course from the public mirror given an id or a course link.
   *
   * The fetch target is a hard-coded constant; user input contributes only a
   * pattern-validated, encoded path segment, so no user-controlled hostname can
   * ever reach `fetch`.
   */
  async importCourseById(rawId: string): Promise<WaterRoute> {
    const id = this.resolveCourseId(rawId);
    const detail = await this.fetchCourseDetail(id);
    return this.importCourseDetail(detail, { id });
  }

  /**
   * Load a course's raw geometry without importing it.
   *
   * The track-attach flow uses this to check a file against that course's own
   * gates before storing it, so a track for the wrong water is refused up front.
   */
  async fetchCourseGeometry(rawId: string): Promise<RownativeCourseGeometryInput> {
    return this.fetchCourseDetail(this.resolveCourseId(rawId));
  }

  private async fetchCourseDetail(courseId: string): Promise<RownativeCourseFile> {
    const url = `${ROWNATIVE_COURSE_BASE_URL}/${encodeURIComponent(courseId)}.json`;
    const response = await this.fetchImpl(url);

    if (response.status === 404) {
      throw new RownativeCourseNotFoundError(
        `Course ${courseId} isn't in the public course data yet. The mirror syncs from `
        + 'rownative.icu periodically — try again later, or search for it by name.',
        courseId,
      );
    }
    if (!response.ok) {
      throw new Error(`Unable to load rownative course data (HTTP ${response.status}). Please try again.`);
    }

    const body = await response.text();
    if (new TextEncoder().encode(body).length > MAX_COURSE_BYTES) {
      throw new Error(`Course ${courseId} data is too large to import.`);
    }

    let detail: RownativeCourseFile;
    try {
      detail = JSON.parse(body) as RownativeCourseFile;
    } catch {
      throw new Error(`Course ${courseId} data is malformed.`);
    }
    if (typeof detail?.id !== 'string' || typeof detail?.name !== 'string') {
      throw new Error(`Course ${courseId} data is malformed.`);
    }
    return detail;
  }

  /**
   * Turn a fetched course file into a route.
   *
   * The polyline comes from `resolveCourseGeometry`, which prefers a track the
   * user has attached to this course id, then a traced polygon in the file
   * itself, then map-derived geometry, and only then the gate chain that made
   * every rownative course render as straight lines (issue #194).
   */
  private async importCourseDetail(
    detail: RownativeCourseFile,
    fallback: { id: string; name?: string; country?: string; distanceMeters?: number; status?: string },
  ): Promise<WaterRoute> {
    const courseId = detail.id || fallback.id;
    const name = detail.name || fallback.name || `Course ${fallback.id}`;

    const geometry = await resolveCourseGeometry(
      { ...detail, id: courseId, name },
      {
        attachedTrack: this.tracks.getCoordinates(courseId),
        osmProvider: this.osmProvider,
      },
    );

    if (geometry.coordinates.length < 2) {
      throw new Error(`Course ${name} (${fallback.id}) has insufficient coordinate data. At least 2 coordinate points are required.`);
    }

    return this.importRoute({
      id: courseId,
      name,
      country: detail.country || fallback.country || 'Unknown',
      coordinates: geometry.coordinates,
      geometrySource: geometry.source,
      externalDistanceMeters: detail.distance_m ?? fallback.distanceMeters,
      status: detail.status ?? fallback.status,
    });
  }
}

export const rownativeService = new RownativeService();

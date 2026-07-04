import type { Coordinate, WaterRoute } from '../types/index';
import { routeService, type RownativeRouteImportData } from './routeService';

// Discovery note (issue #46): rownative Worker API exposes /api/courses and related routes,
// but browser CORS restricts origins to rownative.icu/localhost. VirtualRow therefore reads the
// public course data directly from the rownative/courses repository.
const ROWNATIVE_INDEX_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses/index.json';
const ROWNATIVE_COURSE_BASE_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses';
const UNORDERED_POLYGON_SORT_KEY = Number.MAX_SAFE_INTEGER;
const ROWNATIVE_WORKER_BASE_URL = (import.meta.env.VITE_ROWNATIVE_WORKER_BASE_URL as string | undefined)
  ?? 'https://rownative.icu/api/virtualrow';
const MAX_KML_BYTES = 5 * 1024 * 1024;
const ROUTE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

interface RownativeCourseIndexEntry {
  id: string;
  name: string;
  country?: string;
  distance_m?: number;
  status?: string;
}

interface RownativeCoursePolygonPoint {
  lat: number;
  lon: number;
}

interface RownativeCoursePolygon {
  order?: number;
  points?: RownativeCoursePolygonPoint[];
}

interface RownativeCourseFile {
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

export interface RownativeLinkedAccount {
  virtualRowUserId: string;
  rownativeUserId: string;
  rownativeDisplayName?: string;
  linkedAt: number;
}

export interface StartRownativeLinkResult {
  linkUrl: string;
  requestId?: string;
}

export interface PullRownativeKmlRequest {
  virtualRowUserId: string;
  routeId?: string;
  routeUrl?: string;
}

export interface PullRownativeKmlResult {
  kml: string;
  routeName?: string;
  location?: string;
}

export class RownativeService {
  private courseIndexCache: RownativeCourseSummary[] | null = null;
  private courseIndexPromise: Promise<RownativeCourseSummary[]> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly importRoute: (data: RownativeRouteImportData) => WaterRoute;

  constructor(
    fetchImpl: typeof fetch = fetch,
    importRoute: (data: RownativeRouteImportData) => WaterRoute = (data) => routeService.importRouteFromRownative(data),
  ) {
    this.fetchImpl = fetchImpl;
    this.importRoute = importRoute;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Unable to load rownative course data (HTTP ${response.status}). Please try again.`);
    }
    return response.json() as Promise<T>;
  }

  private getLinkedAccountStorageKey(virtualRowUserId: string): string {
    return `vr_rownative_link:${virtualRowUserId}`;
  }

  private persistLinkedAccount(account: RownativeLinkedAccount): void {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(this.getLinkedAccountStorageKey(account.virtualRowUserId), JSON.stringify(account));
  }

  private clearLinkedAccount(virtualRowUserId: string): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(this.getLinkedAccountStorageKey(virtualRowUserId));
  }

  getLinkedAccount(virtualRowUserId: string): RownativeLinkedAccount | null {
      if (!virtualRowUserId || typeof window === 'undefined') return null;
      const json = sessionStorage.getItem(this.getLinkedAccountStorageKey(virtualRowUserId));
      if (!json) return null;
      try {
        const parsed = JSON.parse(json) as Partial<RownativeLinkedAccount>;
        if (
          parsed.virtualRowUserId !== virtualRowUserId
          || typeof parsed.rownativeUserId !== 'string'
          || parsed.rownativeUserId.length === 0
          || typeof parsed.linkedAt !== 'number'
          || !Number.isFinite(parsed.linkedAt)
        ) {
          return null;
        }

        return {
          virtualRowUserId,
          rownativeUserId: parsed.rownativeUserId,
          rownativeDisplayName: typeof parsed.rownativeDisplayName === 'string' && parsed.rownativeDisplayName.trim().length > 0
            ? parsed.rownativeDisplayName
            : undefined,
          linkedAt: parsed.linkedAt,
        };
      } catch {
        return null;
      }
    }

  private validateVirtualRowUserId(virtualRowUserId: string): string {
      const normalized = virtualRowUserId.trim();
      if (!normalized) {
        throw new Error('You need to sign in before linking a rownative account.');
      }
      return normalized;
    }

  private validateRouteSelection(input: { routeId?: string; routeUrl?: string }): { routeId?: string; routeUrl?: string } {
      const routeId = input.routeId?.trim();
      const routeUrl = input.routeUrl?.trim();
      if (!routeId && !routeUrl) return {};

      if (routeId) {
        if (!ROUTE_ID_PATTERN.test(routeId)) {
          throw new Error('Route ID is invalid. Use letters, numbers, dash, or underscore only.');
        }
        return { routeId };
      }

      try {
        const parsed = new URL(routeUrl ?? '');
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('Route URL must start with https:// or http://.');
        }
        return { routeUrl: parsed.toString() };
      } catch {
        throw new Error('Route URL is invalid.');
      }
    }

  private async fetchWorkerJson<T>(path: string, init: RequestInit): Promise<T> {
      const response = await this.fetchImpl(`${ROWNATIVE_WORKER_BASE_URL}${path}`, init);
      if (!response.ok) {
        throw new Error(`Rownative API request failed (HTTP ${response.status}).`);
      }
      return response.json() as Promise<T>;
    }

  async startLinkFlow(virtualRowUserId: string): Promise<StartRownativeLinkResult> {
      const userId = this.validateVirtualRowUserId(virtualRowUserId);
      const result = await this.fetchWorkerJson<{ linkUrl?: string; requestId?: string }>(
        '/link/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ virtualRowUserId: userId }),
        },
      );

      if (typeof result.linkUrl !== 'string' || result.linkUrl.trim().length === 0) {
        throw new Error('Rownative link setup failed. Please try again.');
      }
      let linkUrl: URL;
      try {
        linkUrl = new URL(result.linkUrl);
      } catch {
        throw new Error('Rownative link setup failed. Please try again.');
      }
      if (linkUrl.protocol !== 'https:' && linkUrl.protocol !== 'http:') {
        throw new Error('Rownative link setup failed. Please try again.');
      }

      return {
        linkUrl: linkUrl.toString(),
        requestId: typeof result.requestId === 'string' && result.requestId.trim().length > 0 ? result.requestId.trim() : undefined,
      };
    }

  async completeLinkFlow(virtualRowUserId: string, requestId?: string): Promise<RownativeLinkedAccount> {
      const userId = this.validateVirtualRowUserId(virtualRowUserId);
      const body: { virtualRowUserId: string; requestId?: string } = { virtualRowUserId: userId };
      if (requestId?.trim()) {
        body.requestId = requestId.trim();
      }

      const result = await this.fetchWorkerJson<{
        rownativeUserId?: string;
        rownativeDisplayName?: string;
        linkedAt?: number;
      }>(
        '/link/complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (typeof result.rownativeUserId !== 'string' || result.rownativeUserId.trim().length === 0) {
        throw new Error('Linking could not be confirmed yet. Please finish linking on rownative.icu and retry.');
      }

      const account: RownativeLinkedAccount = {
        virtualRowUserId: userId,
        rownativeUserId: result.rownativeUserId.trim(),
        rownativeDisplayName: typeof result.rownativeDisplayName === 'string' && result.rownativeDisplayName.trim().length > 0
          ? result.rownativeDisplayName.trim()
          : undefined,
        linkedAt: typeof result.linkedAt === 'number' && Number.isFinite(result.linkedAt)
          ? result.linkedAt
          : Date.now(),
      };
      this.persistLinkedAccount(account);
      return account;
    }

  async unlinkAccount(virtualRowUserId: string): Promise<void> {
      const userId = this.validateVirtualRowUserId(virtualRowUserId);
      await this.fetchWorkerJson<{ ok?: boolean }>(
        '/link/unlink',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ virtualRowUserId: userId }),
        },
      );
      this.clearLinkedAccount(userId);
    }

  async pullLinkedRouteKml(input: PullRownativeKmlRequest): Promise<PullRownativeKmlResult> {
      const userId = this.validateVirtualRowUserId(input.virtualRowUserId);
      const selection = this.validateRouteSelection(input);
      const result = await this.fetchWorkerJson<{ kml?: string; routeName?: string; location?: string }>(
        '/routes/pull-kml',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ virtualRowUserId: userId, ...selection }),
        },
      );

      if (typeof result.kml !== 'string' || result.kml.trim().length === 0) {
        throw new Error('Rownative did not return KML data for that route.');
      }
      if (result.kml.length > MAX_KML_BYTES) {
        throw new Error('The KML response is too large to import.');
      }

      return {
        kml: result.kml,
        routeName: typeof result.routeName === 'string' && result.routeName.trim().length > 0 ? result.routeName.trim() : undefined,
        location: typeof result.location === 'string' && result.location.trim().length > 0 ? result.location.trim() : undefined,
      };
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

  private centroid(points: RownativeCoursePolygonPoint[]): Coordinate | null {
    if (!points.length) return null;
    let latSum = 0;
    let lonSum = 0;
    for (const point of points) {
      latSum += point.lat;
      lonSum += point.lon;
    }
    return { lat: latSum / points.length, lng: lonSum / points.length };
  }

  private deriveRouteCoordinates(course: RownativeCourseFile): Coordinate[] {
    const polygons = Array.isArray(course.polygons) ? [...course.polygons] : [];
    // Sorting the local copy keeps the source payload immutable for callers.
    const orderedPolygons = polygons.sort(
      (a, b) => (a.order ?? UNORDERED_POLYGON_SORT_KEY) - (b.order ?? UNORDERED_POLYGON_SORT_KEY),
    );
    const centroids = orderedPolygons
      .map((polygon) => this.centroid((polygon.points ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))))
      .filter((point): point is Coordinate => point !== null);

    if (centroids.length >= 2) {
      return centroids;
    }

    const fallbackPoints = orderedPolygons[0]?.points ?? [];
    return fallbackPoints
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .slice(0, 2)
      .map((point) => ({ lat: point.lat, lng: point.lon }));
  }

  async importCourse(course: RownativeCourseSummary): Promise<WaterRoute> {
    const url = `${ROWNATIVE_COURSE_BASE_URL}/${encodeURIComponent(course.id)}.json`;
    const detail = await this.fetchJson<RownativeCourseFile>(url);
    const coordinates = this.deriveRouteCoordinates(detail);
    if (coordinates.length < 2) {
      throw new Error(`Course ${course.name} (${course.id}) has insufficient coordinate data. At least 2 coordinate points are required.`);
    }

    return this.importRoute({
      id: detail.id || course.id,
      name: detail.name || course.name,
      country: detail.country || course.country,
      distanceMeters: detail.distance_m ?? course.distanceMeters,
      coordinates,
      status: detail.status ?? course.status,
    });
  }
}

export const rownativeService = new RownativeService();

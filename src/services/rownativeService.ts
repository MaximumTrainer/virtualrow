import type { Coordinate, WaterRoute } from '../types/index';
import { routeService, type RownativeRouteImportData } from './routeService';

// Discovery note (issue #46): rownative Worker API exposes /api/courses and related routes,
// but browser CORS restricts origins to rownative.icu/localhost. VirtualRow therefore reads the
// public course data directly from the rownative/courses repository.
const ROWNATIVE_INDEX_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses/index.json';
const ROWNATIVE_COURSE_BASE_URL = 'https://raw.githubusercontent.com/rownative/courses/main/courses';
const UNORDERED_POLYGON_SORT_KEY = Number.MAX_SAFE_INTEGER;

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

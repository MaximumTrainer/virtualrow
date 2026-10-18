import Supercluster from 'supercluster';
import type { WaterRoute } from '../types/index';
import { routeCentroid } from './routeCentroid';

interface SuperclusterPoint {
  type: 'Feature';
  properties: { routeId: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

interface SuperclusterClusterProps {
  cluster: true;
  cluster_id: number;
  point_count: number;
}

export interface RoutePinEntry {
  kind: 'pin';
  route: WaterRoute;
  lat: number;
  lng: number;
}

export interface RouteClusterEntry {
  kind: 'cluster';
  id: number;
  routeIds: string[];
  lat: number;
  lng: number;
  count: number;
}

export type ClusteredEntry = RoutePinEntry | RouteClusterEntry;

/**
 * #505 Phase 2 (D4-b): group route pins into clusters at wide zooms, letting
 * co-located pins zoom-on-click apart. Supercluster indexes the pin set once
 * per route change; getClusters is a cheap per-zoom query.
 *
 * Wraps the whole globe in the query bbox so routes near the antimeridian do
 * not drop off the right edge; a MapLibre-driven caller can replace the bbox
 * with the current viewport.
 */
export function clusterRoutePins(
  routes: readonly WaterRoute[],
  zoom: number,
  bbox: [number, number, number, number] = [-180, -85, 180, 85],
): ClusteredEntry[] {
  const points: SuperclusterPoint[] = [];
  for (const r of routes) {
    const centroid = routeCentroid(r.coordinates);
    if (!centroid) continue;
    points.push({
      type: 'Feature',
      properties: { routeId: r.id },
      geometry: { type: 'Point', coordinates: [centroid.lng, centroid.lat] },
    });
  }

  const index = new Supercluster({
    radius: 40,
    maxZoom: 16,
    minPoints: 2,
  });
  index.load(points);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const clusters = index.getClusters(bbox, clamp(Math.round(zoom), 0, 16));

  const routeById = new Map(routes.map((r) => [r.id, r]));
  const out: ClusteredEntry[] = [];
  for (const feature of clusters) {
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const props = feature.properties as Partial<SuperclusterClusterProps> & { routeId?: string };
    if (props.cluster === true && typeof props.cluster_id === 'number') {
      const leaves = index.getLeaves(props.cluster_id, Infinity, 0) as unknown as Array<{
        properties: { routeId: string };
      }>;
      const routeIds = leaves
        .map((l) => l.properties.routeId)
        .filter((id): id is string => typeof id === 'string');
      out.push({
        kind: 'cluster',
        id: props.cluster_id,
        routeIds,
        lat,
        lng,
        count: props.point_count ?? routeIds.length,
      });
    } else if (typeof props.routeId === 'string') {
      const r = routeById.get(props.routeId);
      if (r) out.push({ kind: 'pin', route: r, lat, lng });
    }
  }
  return out;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WaterRoute, Coordinate } from '../types/index';
import { routeCentroid } from '../utils/routeCentroid';
import { clusterRoutePins, type ClusteredEntry } from '../utils/routePinClusters';
import './RouteOverviewMap.css';

const FALLBACK_ZOOM = 2;

interface RouteOverviewMapProps {
  routes: readonly WaterRoute[];
  defaultRouteId: string | null;
  selectedRouteId: string | null;
  dimmedRouteIds?: ReadonlySet<string>;
  onSelect: (route: WaterRoute) => void;
}

interface PlacedPin {
  route: WaterRoute;
  centroid: Coordinate;
}

/**
 * #505 Phase 1 — map-primary Routes-screen overview.
 *
 * Behind `__VIRTUALROW_ROUTE_MAP_V2`. Lazy-loads MapLibre; when the module or
 * its init fails (jsdom, no WebGL, blocked tile host), falls back to an SVG
 * world sketch of the pins so the surface stays usable (NFR1 of #505).
 *
 * Clustering (D4), the modal detail overlay (D8) and the OSM-tile card
 * backdrop (D3) land in Phase 2 of the issue; this phase renders pins and
 * handles selection the same way the drawer rows do.
 */
export function RouteOverviewMap({
  routes,
  defaultRouteId,
  selectedRouteId,
  dimmedRouteIds,
  onSelect,
}: RouteOverviewMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<{
    flyTo: (opts: { center: [number, number]; zoom: number; animate?: boolean }) => void;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [projection, setProjection] = useState<((c: Coordinate) => { x: number; y: number }) | null>(
    null,
  );
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const pins = useMemo<PlacedPin[]>(() => {
    const out: PlacedPin[] = [];
    for (const r of routes) {
      const c = routeCentroid(r.coordinates);
      if (c) out.push({ route: r, centroid: c });
    }
    return out;
  }, [routes]);

  // #505 Phase 2b (D4-b): cluster co-located pins at a fixed overview zoom.
  // Live zoom tracking on MapLibre is Phase 2c; this phase makes co-located
  // routes stop overlapping while the user is looking at the whole catalogue.
  const entries = useMemo<ClusteredEntry[]>(
    () => clusterRoutePins(routes, FALLBACK_ZOOM),
    [routes],
  );

  // Track rendered size so the fallback SVG and the pin layer agree on pixels.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Try to initialise MapLibre; on any error (jsdom, no WebGL, module missing)
  // fall through to the SVG fallback. We intentionally do not import the
  // module statically so the Routes screen bundle stays light when the flag
  // is off (NFR3 of #505).
  useEffect(() => {
    let cancelled = false;
    let mapInstance: { remove: () => void } | null = null;
    const el = canvasRef.current;
    if (!el || pins.length === 0) {
      setMapReady(false);
      return;
    }

    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')) as unknown as {
          Map: new (opts: Record<string, unknown>) => {
            remove: () => void;
            project: (lnglat: [number, number]) => { x: number; y: number };
            fitBounds: (
              bounds: [[number, number], [number, number]],
              opts?: Record<string, unknown>,
            ) => void;
            flyTo: (opts: { center: [number, number]; zoom: number; animate?: boolean }) => void;
            on: (ev: string, cb: () => void) => void;
          };
        };

        const style = {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              maxzoom: 19,
              attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        };

        const map = new maplibre.Map({
          container: el,
          style,
          attributionControl: false,
          center: [pins[0].centroid.lng, pins[0].centroid.lat],
          zoom: 2,
        });
        if (cancelled) {
          map.remove();
          return;
        }
        mapInstance = map;
        mapInstanceRef.current = map;

        const defaultPin = pins.find((p) => p.route.id === defaultRouteId);
        if (defaultPin) {
          map.fitBounds(
            [
              [defaultPin.centroid.lng - 0.2, defaultPin.centroid.lat - 0.2],
              [defaultPin.centroid.lng + 0.2, defaultPin.centroid.lat + 0.2],
            ],
            { padding: 32, animate: false },
          );
        } else {
          let minLng = Infinity;
          let maxLng = -Infinity;
          let minLat = Infinity;
          let maxLat = -Infinity;
          for (const p of pins) {
            if (p.centroid.lng < minLng) minLng = p.centroid.lng;
            if (p.centroid.lng > maxLng) maxLng = p.centroid.lng;
            if (p.centroid.lat < minLat) minLat = p.centroid.lat;
            if (p.centroid.lat > maxLat) maxLat = p.centroid.lat;
          }
          if (Number.isFinite(minLng)) {
            map.fitBounds(
              [
                [minLng, minLat],
                [maxLng, maxLat],
              ],
              { padding: 48, animate: false },
            );
          }
        }

        setMapReady(true);
        setProjection(() => (c: Coordinate) => map.project([c.lng, c.lat]));
      } catch {
        setMapReady(false);
      }
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapInstance = null;
      mapInstanceRef.current = null;
      setMapReady(false);
      setProjection(null);
    };
  }, [pins, defaultRouteId]);

  // Equirectangular projection for the fallback: a world sketch bounded by
  // the pin set (so a UK-only catalogue doesn't centre on the Atlantic).
  const fallbackProjection = useMemo(() => {
    if (pins.length === 0 || containerSize.w === 0 || containerSize.h === 0) return null;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const p of pins) {
      if (p.centroid.lng < minLng) minLng = p.centroid.lng;
      if (p.centroid.lng > maxLng) maxLng = p.centroid.lng;
      if (p.centroid.lat < minLat) minLat = p.centroid.lat;
      if (p.centroid.lat > maxLat) maxLat = p.centroid.lat;
    }
    const padLng = Math.max(0.5, (maxLng - minLng) * 0.2);
    const padLat = Math.max(0.5, (maxLat - minLat) * 0.2);
    minLng -= padLng;
    maxLng += padLng;
    minLat -= padLat;
    maxLat += padLat;
    const lngRange = maxLng - minLng || 1;
    const latRange = maxLat - minLat || 1;
    const w = containerSize.w;
    const h = containerSize.h;
    return (c: Coordinate) => ({
      x: ((c.lng - minLng) / lngRange) * w,
      y: ((maxLat - c.lat) / latRange) * h,
    });
  }, [pins, containerSize]);

  const activeProjection = mapReady && projection ? projection : fallbackProjection;

  return (
    <div className="route-overview-map" ref={canvasRef} data-testid="route-overview-map">
      {!mapReady && (
        <svg
          className="route-overview-map__fallback"
          width={containerSize.w || 1}
          height={containerSize.h || 1}
          aria-hidden="true"
        >
          <rect width="100%" height="100%" fill="var(--surface-2, #0f1114)" />
        </svg>
      )}
      <div className="route-overview-map__pin-layer">
        {entries.map((entry) => {
          if (entry.kind === 'cluster') {
            const pos = activeProjection
              ? activeProjection({ lat: entry.lat, lng: entry.lng })
              : null;
            return (
              <button
                key={`cluster-${entry.id}`}
                type="button"
                className="route-overview-map__cluster"
                data-testid="route-cluster"
                data-cluster-count={entry.count}
                style={{ left: pos ? `${pos.x}px` : '50%', top: pos ? `${pos.y}px` : '50%' }}
                aria-label={`${entry.count} routes near this location — zoom in to see them`}
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) {
                    map.flyTo({
                      center: [entry.lng, entry.lat],
                      zoom: FALLBACK_ZOOM + 4,
                      animate: false,
                    });
                  }
                }}
              >
                {entry.count}
              </button>
            );
          }
          const { route, centroid } = { route: entry.route, centroid: { lat: entry.lat, lng: entry.lng } };
          const pos = activeProjection ? activeProjection(centroid) : null;
          const isDefault = route.id === defaultRouteId;
          const isSelected = route.id === selectedRouteId;
          const isDimmed = dimmedRouteIds?.has(route.id) ?? false;
          return (
            <button
              key={route.id}
              type="button"
              className="route-overview-map__pin"
              data-testid="route-pin"
              data-route-id={route.id}
              data-default={isDefault ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              data-dimmed={isDimmed ? 'true' : 'false'}
              style={{ left: pos ? `${pos.x}px` : '50%', top: pos ? `${pos.y}px` : '50%' }}
              aria-label={`Select route ${route.name}`}
              onClick={() => onSelect(route)}
            >
              <svg width="18" height="22" viewBox="0 0 18 22">
                <path
                  d="M9 0 C4 0 0 4 0 9 c0 7 9 13 9 13 s9-6 9-13 c0-5-4-9-9-9 z"
                  fill={isDefault ? '#ffc400' : isSelected ? '#00b4ff' : '#e8e8e8'}
                  stroke="#111"
                  strokeWidth="1"
                />
                <circle cx="9" cy="9" r="3" fill="#111" />
              </svg>
            </button>
          );
        })}
      </div>
      {pins.length > 0 && (
        <div className="route-overview-map__attribution" data-testid="route-overview-attribution">
          ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>{' '}
          contributors
        </div>
      )}
    </div>
  );
}

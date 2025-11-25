import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { WaterRoute } from '../types/index';
import './RouteMap.css';

// Fix Leaflet marker icons
const DefaultIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const StartIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const EndIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Set default icon for markers
(L.Icon.Default.prototype as any)._getIconUrl = function() {
  return DefaultIcon.options.iconUrl || '';
};

interface RouteMapProps {
  route: WaterRoute;
  onRouteSelected?: (route: WaterRoute) => void;
  highlightMode?: boolean;
  progressPercent?: number; // 0-100, percentage of route completed
}

export const RouteMap: React.FC<RouteMapProps> = ({
  route,
  onRouteSelected,
  highlightMode,
  progressPercent,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayLayersRef = useRef<L.Layer[]>([]);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapInitialized, setMapInitialized] = useState(false);
  // DEV/debug states
  const [debugVisible, setDebugVisible] = useState(false);
  const [tileStats, setTileStats] = useState({ loaded: 0, errors: 0, serverLabel: 'OpenStreetMap' });
  const tileErrorCountRef = useRef(0);
  const tileLoadCountRef = useRef(0);
  const tileServers = [
    { key: 'osm', label: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    { key: 'osm-de', label: 'OpenStreetMap DE', url: 'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png' },
    { key: 'opentopo', label: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
    { key: 'stamen', label: 'Stamen Terrain', url: 'https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg' },
  ];

  // Initialize map on mount
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    // Calculate center from route coordinates
    let center: [number, number] = [39.8283, -98.5795]; // USA center fallback
    if (route.coordinates.length > 0) {
      const avgLat = route.coordinates.reduce((sum, c) => sum + c.lat, 0) / route.coordinates.length;
      const avgLng = route.coordinates.reduce((sum, c) => sum + c.lng, 0) / route.coordinates.length;
      center = [avgLat, avgLng];
    }

    // Create map
    const map = L.map(containerRef.current, {
      center,
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });

    // Add base (tile) layer only once and keep reference
  const baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      tileSize: 256,
  }).addTo(map);
  // ensure the base tile layer stays below overlays
  baseTileLayer.setZIndex(0);
    // Debug tile loading issues
    let fallbackTileServerUsed = false;
    const onTileLoad = () => {
      tileLoadCountRef.current++;
      setTileStats((t) => ({ ...t, loaded: t.loaded + 1 }));
    };
    const onTileError = () => {
      tileErrorCountRef.current++;
      setTileStats((t) => ({ ...t, errors: t.errors + 1 }));
      if (import.meta.env.DEV) {
        console.warn('Leaflet tileerror count', tileErrorCountRef.current);
      }
      // Switch to fallback tile server after too many errors
      if (tileErrorCountRef.current > 8 && !fallbackTileServerUsed) {
        fallbackTileServerUsed = true;
        try {
          baseTileLayer.setUrl('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png');
          baseTileLayer.redraw();
          setTileStats((t) => ({ ...t, serverLabel: 'OpenStreetMap DE' }));
          if (import.meta.env.DEV) console.warn('Switched to fallback OSM tile server');
        } catch (err) {
          if (import.meta.env.DEV) console.error('Fallback tile server switch failed', err);
        }
      }
    };
    baseTileLayer.on('tileload', onTileLoad);
    baseTileLayer.on('tileerror', onTileError);
  baseTileLayerRef.current = baseTileLayer;
  // store reference in DOM element using dataset for safety if needed later
  (containerRef.current as HTMLDivElement).dataset['baseTileLayerUrl'] = baseTileLayer.getTileUrl({ z: 0, x: 0, y: 0 } as any) || '';

    mapRef.current = map;
    setMapInitialized(true);
    // When the map is ready, invalidate size (helpful in tabbed or hidden containers)
    map.whenReady(() => {
      // Use the ref to guard against the map having been removed by cleanup
      if (mapRef.current) mapRef.current.invalidateSize();
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 120);
      if (import.meta.env.DEV) {
        setTimeout(() => {
          const container = containerRef.current as HTMLDivElement | null;
          if (container) {
            const tiles = container.querySelectorAll('.leaflet-tile');
            const urls = Array.from(tiles).map((t) => (t as HTMLImageElement).src);
            const unique = new Set(urls);
            console.debug('Leaflet tiles loaded', tiles.length, 'unique', unique.size);
            if (tiles.length === 0) {
              console.warn('No tiles found in container, check tile layer or CSS');
            }
          }
        }, 700);
      }
    });

    // ResizeObserver -> call invalidateSize when container changes size
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        // small timeout allows DOM to stabilize
        setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 50);
      }
    });

  ro.observe(containerRef.current);

    // IntersectionObserver -> detect when the map container becomes visible
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && mapRef.current) {
          setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 100);
        }
      });
    });
    io.observe(containerRef.current);

    // Invalidate on moveend / zoomend to ensure tiles align after actions
    const handleMoveEnd = () => {
      if (mapRef.current) mapRef.current.invalidateSize();
    };
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);

    // Cleanup
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      // remove tile events from the base layer
      try {
        baseTileLayer.off('tileload', onTileLoad);
        baseTileLayer.off('tileerror', onTileError);
      } catch (e) {
        // ignore
      }
      ro.disconnect();
      io.disconnect();
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
    };
  }, []);

  // Fallback: invalidate map size on window resize
  useEffect(() => {
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Update route when it changes
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;

    const map = mapRef.current;

    // Remove previously added overlay layers only (polyline/markers added by previous route)
    if (overlayLayersRef.current && overlayLayersRef.current.length > 0) {
      overlayLayersRef.current.forEach((ol) => {
        if (map.hasLayer(ol)) {
          map.removeLayer(ol);
        }
      });
      overlayLayersRef.current = [];
    }

    if (route.coordinates.length === 0) return;

    const latlngs = route.coordinates.map((c) => [c.lat, c.lng] as L.LatLngTuple);
    
    // If progress is provided, split route into completed (red) and remaining (green)
    if (progressPercent !== undefined && progressPercent > 0) {
      const totalPoints = latlngs.length;
      const splitIndex = Math.min(Math.floor((progressPercent / 100) * totalPoints), totalPoints - 1);
      
      // Completed portion (red) - from start to current position
      if (splitIndex > 0) {
        const completedLatLngs = latlngs.slice(0, splitIndex + 1);
        const completedPolyline = L.polyline(completedLatLngs, {
          color: '#ef4444', // Red for completed
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        overlayLayersRef.current.push(completedPolyline);
      }
      
      // Remaining portion (green) - from current position to end
      if (splitIndex < totalPoints - 1) {
        const remainingLatLngs = latlngs.slice(splitIndex);
        const remainingPolyline = L.polyline(remainingLatLngs, {
          color: '#22c55e', // Green for remaining
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        overlayLayersRef.current.push(remainingPolyline);
      }
      
      // Current position marker (yellow dot)
      if (splitIndex > 0 && splitIndex < totalPoints) {
        const currentPos = latlngs[splitIndex];
        const positionMarker = L.circleMarker(currentPos, {
          radius: 8,
          fillColor: '#fbbf24',
          color: '#ffffff',
          weight: 3,
          opacity: 1,
          fillOpacity: 1,
        }).addTo(map);
        overlayLayersRef.current.push(positionMarker);
      }
    } else {
      // No progress - draw single blue polyline (default view)
      const polyline = L.polyline(latlngs, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      overlayLayersRef.current.push(polyline);
    }

    // Add start marker (green)
    const startMarker = L.marker([route.coordinates[0].lat, route.coordinates[0].lng], { icon: StartIcon })
      .bindPopup(`<b>Start</b><br>${route.name}`)
      .addTo(map);
    overlayLayersRef.current.push(startMarker);

    // Add end marker (red)
    const lastCoord = route.coordinates[route.coordinates.length - 1];
    const endMarker = L.marker([lastCoord.lat, lastCoord.lng], { icon: EndIcon })
      .bindPopup(`<b>End</b><br>${route.name}`)
      .addTo(map);
    overlayLayersRef.current.push(endMarker);

    // Fit bounds to route
    const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
  // After fitting bounds, call invalidateSize to avoid tile misplacement
  setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 120);
    // Force tile redraw as a last step to avoid partial or out-of-order tiles in some browsers
    setTimeout(() => baseTileLayerRef.current?.redraw(), 200);
    if (import.meta.env.DEV) {
      console.debug('Route overlays ', overlayLayersRef.current.length);
    }
  }, [route, mapInitialized, progressPercent]);

  return (
    <div className={`route-map-container ${highlightMode ? 'highlight-mode' : ''}`}>
      <div ref={containerRef} className="route-map" />
      {/* dev-only debug panel */}
      {import.meta.env.DEV && (
        <button className="dev-debug-toggle" onClick={() => setDebugVisible((v) => !v)} aria-label="Toggle map debug panel">🐞</button>
      )}
      {import.meta.env.DEV && debugVisible && (
        <div className="dev-debug-panel" role="region" aria-label="Map Debug Panel">
          <div className="dev-debug-row">
            <strong>Tiles</strong>
            <span>Loaded: {tileStats.loaded}</span>
            <span>Errors: {tileStats.errors}</span>
          </div>
          <div className="dev-debug-row">
            <strong>Tile Server</strong>
            <span>{tileStats.serverLabel}</span>
            <button className="btn" onClick={() => {
              baseTileLayerRef.current?.redraw();
            }}>Redraw</button>
            <button className="btn" onClick={() => setTileStats({ loaded: 0, errors: 0, serverLabel: tileStats.serverLabel })}>Reset</button>
          </div>
          <div className="dev-debug-row tile-switch-row">
            {tileServers.map((s) => (
              <button key={s.key} className="btn btn-primary" onClick={() => {
                if (baseTileLayerRef.current) {
                  baseTileLayerRef.current.setUrl(s.url);
                  baseTileLayerRef.current.redraw();
                  setTileStats((t) => ({ ...t, serverLabel: s.label }));
                }
              }}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="route-info-overlay">
        {!highlightMode && (
        <div className="route-info-card">
          <h3>{route.name}</h3>
          <div className="route-stats">
            <div className="stat">
              <span className="label">Distance</span>
              <span className="value">{route.distance} km</span>
            </div>
            <div className="stat">
              <span className="label">Difficulty</span>
              <span className={`badge badge-${route.difficulty}`}>
                {route.difficulty}
              </span>
            </div>
            <div className="stat">
              <span className="label">Est. Time</span>
              <span className="value">{route.estimatedTime} min</span>
            </div>
          </div>
          <p className="description">{route.description}</p>
          {onRouteSelected && (
            <button
              className="btn btn-primary"
              onClick={() => onRouteSelected(route)}
            >
              Select This Route
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default RouteMap;

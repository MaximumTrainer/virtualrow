import { useMemo, useState } from 'react';
import type { Coordinate } from '../types/index';
import { osmTileFor, pickBackdropZoom, projectInsideTile } from '../utils/osmTileBackdrop';
import { routeCentroid } from '../utils/routeCentroid';
import './RouteThumbnail.css';

interface RouteThumbnailProps {
  coordinates: Coordinate[];
  /** Width of the SVG viewBox (default 120). */
  width?: number;
  /** Height of the SVG viewBox (default 80). */
  height?: number;
  className?: string;
  /**
   * #505 Phase 2d (D3-b): draw an OSM raster tile backdrop behind the polyline.
   * When true the polyline is projected in Web Mercator relative to the chosen
   * tile, so the route lines up with the geographic feature on the tile. If
   * the tile fails to load (network, offline, blocked host) the backdrop is
   * hidden and the polyline falls back to the thumbnail-local linear projection.
   */
  showBackdrop?: boolean;
}

/**
 * RouteThumbnail renders a lightweight SVG polyline preview of a route's
 * geographic coordinates. By default the polyline is normalised to the SVG
 * viewBox with a small padding. With `showBackdrop`, a single OSM raster
 * tile is drawn behind the polyline and the polyline is projected in Web
 * Mercator relative to that tile.
 */
export function RouteThumbnail({
  coordinates,
  width = 120,
  height = 80,
  className = '',
  showBackdrop = false,
}: RouteThumbnailProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const backdrop = useMemo(() => {
    if (!showBackdrop || !coordinates || coordinates.length < 2) return null;
    const centre = routeCentroid(coordinates);
    if (!centre) return null;
    const z = pickBackdropZoom(coordinates);
    const tile = osmTileFor(centre, z);
    return tile;
  }, [showBackdrop, coordinates]);

  if (!coordinates || coordinates.length < 2) {
    return (
      <div
        className={`route-thumbnail route-thumbnail--placeholder ${className}`}
        style={{ width, height }}
        aria-hidden="true"
      />
    );
  }

  const padding = 6;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const useBackdropProjection = backdrop !== null && failedUrl !== backdrop.url;

  let toSVG: (c: Coordinate) => [number, number];
  if (useBackdropProjection && backdrop) {
    toSVG = (c) => {
      const { u, v } = projectInsideTile(c, backdrop);
      return [u * width, v * height];
    };
  } else {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const { lat, lng } of coordinates) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const latRange = maxLat - minLat || 1e-6;
    const lngRange = maxLng - minLng || 1e-6;
    toSVG = ({ lat, lng }) => [
      padding + ((lng - minLng) / lngRange) * innerW,
      padding + ((maxLat - lat) / latRange) * innerH,
    ];
  }

  const maxPoints = 200;
  const step = coordinates.length > maxPoints ? Math.ceil(coordinates.length / maxPoints) : 1;
  const sampled: Coordinate[] = [];
  for (let i = 0; i < coordinates.length; i += step) {
    sampled.push(coordinates[i]);
  }
  const last = coordinates[coordinates.length - 1];
  const sampledLast = sampled[sampled.length - 1];
  if (sampledLast?.lat !== last.lat || sampledLast?.lng !== last.lng) {
    sampled.push(last);
  }

  const points = sampled.map(toSVG).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <div
      className={`route-thumbnail-wrap ${className}`}
      style={{ width, height }}
      data-testid="route-thumbnail-wrap"
    >
      {useBackdropProjection && backdrop && (
        <img
          className="route-thumbnail__backdrop"
          src={backdrop.url}
          alt=""
          aria-hidden="true"
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          data-testid="route-thumbnail-backdrop"
          onError={() => setFailedUrl(backdrop.url)}
        />
      )}
      <svg
        className="route-thumbnail"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
      >
        <polyline
          points={points}
          className="route-thumbnail-line"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

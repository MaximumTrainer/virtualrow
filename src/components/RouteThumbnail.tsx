import type { Coordinate } from '../types/index';
import './RouteThumbnail.css';

interface RouteThumbnailProps {
  coordinates: Coordinate[];
  /** Width of the SVG viewBox (default 120). */
  width?: number;
  /** Height of the SVG viewBox (default 80). */
  height?: number;
  className?: string;
}

/**
 * RouteThumbnail renders a lightweight SVG polyline preview of a route's
 * geographic coordinates. It normalises the bounding box of the provided
 * coordinates to the SVG viewBox with a small padding, so the route fills
 * the thumbnail regardless of geographic scale.
 *
 * This is a client-side only component — no server-side rendering is needed.
 */
export function RouteThumbnail({
  coordinates,
  width = 120,
  height = 80,
  className = '',
}: RouteThumbnailProps) {
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

  // Compute bounding box over lat/lng
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

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // Normalise to SVG coordinates.
  // lng → x (left to right), lat → y (flip: top = high lat)
  const toSVG = ({ lat, lng }: Coordinate): [number, number] => [
    padding + ((lng - minLng) / lngRange) * innerW,
    padding + ((maxLat - lat) / latRange) * innerH,
  ];

  // Sample the coordinates to keep the SVG small (≤ 200 points)
  const maxPoints = 200;
  const step = coordinates.length > maxPoints ? Math.floor(coordinates.length / maxPoints) : 1;
  const sampled: Coordinate[] = [];
  for (let i = 0; i < coordinates.length; i += step) {
    sampled.push(coordinates[i]);
  }
  // Always include the last point
  const last = coordinates[coordinates.length - 1];
  const sampledLast = sampled[sampled.length - 1];
  if (sampledLast?.lat !== last.lat || sampledLast?.lng !== last.lng) {
    sampled.push(last);
  }

  const points = sampled.map(toSVG).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg
      className={`route-thumbnail ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      role="img"
    >
      <polyline
        points={points}
        className="route-thumbnail-line"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

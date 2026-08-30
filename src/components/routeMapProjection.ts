/**
 * Fit-to-canvas projection for the route map.
 *
 * Extracted from RouteMap.tsx so the projection can be asserted directly
 * (#191, KV-2.3). The criterion as originally written spoke of a Leaflet
 * polyline sitting inside the viewport at initial zoom; the app draws the map
 * on a plain canvas and fits the route to it, so the equivalent property is
 * that every projected point lands inside the padded drawing area whatever the
 * route's shape or the canvas's aspect ratio.
 */

/** Planar bounds of a route, in metres relative to its first coordinate. */
export interface RouteMetreBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface RouteMapTransform {
  /** Metres (route-relative) to canvas pixels, with Y flipped for canvas. */
  toCanvas: (x: number, y: number) => { x: number; y: number };
  /** Uniform metres-per-pixel scale; equal on both axes so shape is preserved. */
  scale: number;
  /** Margin kept clear on every side, in pixels. */
  padding: number;
}

/**
 * Margin kept clear around the route, proportional to the canvas.
 *
 * A fixed 40px left the 148x110 mini-map just 68x30 of usable area (#195), so
 * the padding shrinks with the canvas and never eats more than a fifth of it.
 */
export function computeRouteMapPadding({ width, height }: CanvasSize): number {
  return Math.max(6, Math.min(40, Math.min(width, height) * 0.12));
}

export function createRouteMapTransform(
  bounds: RouteMetreBounds,
  canvas: CanvasSize,
): RouteMapTransform {
  const padding = computeRouteMapPadding(canvas);
  const availableWidth = canvas.width - padding * 2;
  const availableHeight = canvas.height - padding * 2;

  const scaleX = bounds.width > 0 ? availableWidth / bounds.width : 1;
  const scaleY = bounds.height > 0 ? availableHeight / bounds.height : 1;
  // One scale for both axes: an axis-independent fit would stretch the route
  // and misreport its shape.
  const scale = Math.min(scaleX, scaleY);

  const routeWidth = bounds.width * scale;
  const routeHeight = bounds.height * scale;
  const offsetX = padding + (availableWidth - routeWidth) / 2;
  const offsetY = padding + (availableHeight - routeHeight) / 2;

  return {
    padding,
    scale,
    toCanvas: (x: number, y: number) => ({
      x: offsetX + (x - bounds.minX) * scale,
      // Flip Y: metres grow north, canvas pixels grow down.
      y: offsetY + (bounds.maxY - y) * scale,
    }),
  };
}

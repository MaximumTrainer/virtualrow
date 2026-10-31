<!--
  RouteThumbnail — lightweight SVG polyline preview of a route's coordinates
  (#542 P1, port of RouteThumbnail.tsx). Same DOM, class names and testids so
  the route-search Playwright specs keep passing. By default the polyline is
  normalised to the SVG viewBox; with `showBackdrop` a single OSM raster tile
  is drawn behind it and the polyline is projected in Web Mercator relative to
  that tile. The CSS is imported verbatim and stays global.
-->
<script lang="ts">
  import type { Coordinate } from '../types/index';
  import { osmTileFor, pickBackdropZoom, projectInsideTile } from '../utils/osmTileBackdrop';
  import { routeCentroid } from '../utils/routeCentroid';
  import './RouteThumbnail.css';

  interface Props {
    coordinates: Coordinate[];
    /** Width of the SVG viewBox (default 120). */
    width?: number;
    /** Height of the SVG viewBox (default 80). */
    height?: number;
    class?: string;
    /**
     * #505 Phase 2d (D3-b): draw an OSM raster tile backdrop behind the
     * polyline. When true the polyline is projected in Web Mercator relative to
     * the chosen tile, so the route lines up with the geographic feature on the
     * tile. If the tile fails to load (network, offline, blocked host) the
     * backdrop is hidden and the polyline falls back to the thumbnail-local
     * linear projection.
     */
    showBackdrop?: boolean;
  }

  let {
    coordinates,
    width = 120,
    height = 80,
    class: className = '',
    showBackdrop = false,
  }: Props = $props();

  let failedUrl = $state<string | null>(null);

  const backdrop = $derived.by(() => {
    if (!showBackdrop || !coordinates || coordinates.length < 2) return null;
    const centre = routeCentroid(coordinates);
    if (!centre) return null;
    const z = pickBackdropZoom(coordinates);
    return osmTileFor(centre, z);
  });

  const hasPolyline = $derived(!!coordinates && coordinates.length >= 2);

  const useBackdropProjection = $derived(backdrop !== null && failedUrl !== backdrop.url);

  const points = $derived.by(() => {
    if (!hasPolyline) return '';
    const padding = 6;
    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    let toSVG: (c: Coordinate) => [number, number];
    if (useBackdropProjection && backdrop) {
      const tile = backdrop;
      toSVG = (c) => {
        const { u, v } = projectInsideTile(c, tile);
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

    return sampled
      .map(toSVG)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
  });
</script>

{#if !hasPolyline}
  <div
    class={`route-thumbnail route-thumbnail--placeholder ${className}`}
    style={`width: ${width}px; height: ${height}px`}
    aria-hidden="true"
  ></div>
{:else}
  <div
    class={`route-thumbnail-wrap ${className}`}
    style={`width: ${width}px; height: ${height}px`}
    data-testid="route-thumbnail-wrap"
  >
    {#if useBackdropProjection && backdrop}
      <img
        class="route-thumbnail__backdrop"
        src={backdrop.url}
        alt=""
        aria-hidden="true"
        {width}
        {height}
        loading="lazy"
        decoding="async"
        data-testid="route-thumbnail-backdrop"
        onerror={() => (failedUrl = backdrop.url)}
      />
    {/if}
    <svg
      class="route-thumbnail"
      viewBox={`0 0 ${width} ${height}`}
      {width}
      {height}
      aria-hidden="true"
    >
      <polyline
        points={points}
        class="route-thumbnail-line"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
{/if}

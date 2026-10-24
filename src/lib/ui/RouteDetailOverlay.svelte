<!--
  RouteDetailOverlay (#505 Phase 2, D8c) — ported to Svelte for #542 P1.

  Modal that opens when a map pin or drawer row is clicked. Shows name,
  location, distance, time, difficulty and the geometry-provenance badge over
  the route's outline; "Row this route" dispatches to the Row screen through
  `onStartRow`. Same DOM, class names, data-testids, aria and copy as the React
  RouteDetailOverlay.tsx, so the Routes specs keep passing. CSS is imported
  verbatim and stays global.
-->
<script lang="ts">
  import type { WaterRoute } from '../types/index';
  import {
    externalDistanceNote,
    formatRouteDistanceKm,
    geometryProvenanceBadge,
  } from '../utils/geometryProvenance';
  import { OUTLINE_ONLY_TAG } from '../services/routeService';
  import RouteThumbnail from './RouteThumbnail.svelte';
  import './RouteDetailOverlay.css';

  interface Props {
    route: WaterRoute | null;
    onClose: () => void;
    onStartRow: () => void;
  }

  let { route, onClose, onStartRow }: Props = $props();

  function routeGeometrySource(r: WaterRoute): WaterRoute['geometrySource'] {
    if (r.geometrySource) return r.geometrySource;
    return r.tags?.includes(OUTLINE_ONLY_TAG) ? 'gate-chain' : undefined;
  }

  // Close on Escape while the overlay is open (mirrors the React useEffect).
  $effect(() => {
    if (!route) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const provenance = $derived(route ? geometryProvenanceBadge(routeGeometrySource(route)) : null);
  const extNote = $derived(route ? externalDistanceNote(route) : null);
</script>

{#if route}
  <!-- The backdrop is the modal container; Escape closes it (see the $effect
       above) and a backdrop click closes it. Keyboard focus lives on the
       dialog's own buttons, so the container itself needs no tabindex. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="route-detail-overlay__backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="route-detail-overlay-title"
    data-testid="route-detail-overlay"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div class="route-detail-overlay__dialog">
      <button
        type="button"
        class="route-detail-overlay__close"
        aria-label="Close"
        onclick={onClose}
      >
        ×
      </button>

      <h2 id="route-detail-overlay-title" class="route-detail-overlay__title">
        {route.name}
      </h2>
      <p class="route-detail-overlay__location">{route.location}</p>

      <div class="route-detail-overlay__meta">
        <span class="meta-badge">📏 {formatRouteDistanceKm(route.distance)}</span>
        {#if extNote}
          <span class="meta-badge meta-badge--external-distance">{extNote}</span>
        {/if}
        <span class="meta-badge">⏱️ {route.estimatedTime} min</span>
        <span class="meta-badge badge-{route.difficulty}">{route.difficulty}</span>
        {#if provenance}
          <span
            class="meta-badge meta-badge--{provenance.modifier}"
            title={provenance.title}
          >
            {provenance.label}
          </span>
        {/if}
      </div>

      {#if route.coordinates.length >= 2}
        <RouteThumbnail
          coordinates={route.coordinates}
          width={600}
          height={220}
          class="route-detail-overlay__outline"
          showBackdrop
        />
      {:else}
        <div class="route-detail-overlay__outline" aria-hidden="true"></div>
      {/if}

      <button
        type="button"
        class="route-detail-overlay__row"
        onclick={onStartRow}
        data-testid="route-detail-row"
      >
        ▶ Row this route
      </button>

      <p
        class="route-detail-overlay__attribution"
        data-testid="route-detail-attribution"
      >
        Route outline rendered from ©
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenStreetMap
        </a>
        contributors.
      </p>
    </div>
  </div>
{/if}

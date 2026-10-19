import { useEffect } from 'react';
import type { WaterRoute } from '../types/index';
import {
  externalDistanceNote,
  formatRouteDistanceKm,
  geometryProvenanceBadge,
} from '../utils/geometryProvenance';
import { OUTLINE_ONLY_TAG } from '../services/routeService';
import { RouteThumbnail } from './RouteThumbnail';

function routeGeometrySource(route: WaterRoute): WaterRoute['geometrySource'] {
  if (route.geometrySource) return route.geometrySource;
  return route.tags?.includes(OUTLINE_ONLY_TAG) ? 'gate-chain' : undefined;
}
import './RouteDetailOverlay.css';

interface RouteDetailOverlayProps {
  route: WaterRoute | null;
  onClose: () => void;
  onStartRow: () => void;
}

/**
 * #505 Phase 2 (D8c): modal that opens when a map pin or drawer row is
 * clicked. Shows name, location, distance, time, difficulty and the geometry-
 * provenance badge over the route's outline; "Row this route" dispatches to
 * the Row screen through `onStartRow`.
 *
 * Phase 2 draws the outline with the existing `RouteThumbnail`. Phase 2b
 * swaps in the OSM water/land polygons from #493 enrichment (D9-b) once
 * the overlay is receiving the enrichment prop.
 */
export function RouteDetailOverlay({ route, onClose, onStartRow }: RouteDetailOverlayProps) {
  useEffect(() => {
    if (!route) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, onClose]);

  if (!route) return null;

  const provenance = geometryProvenanceBadge(routeGeometrySource(route));
  const extNote = externalDistanceNote(route);

  return (
    <div
      className="route-detail-overlay__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-detail-overlay-title"
      data-testid="route-detail-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="route-detail-overlay__dialog">
        <button
          type="button"
          className="route-detail-overlay__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="route-detail-overlay-title" className="route-detail-overlay__title">
          {route.name}
        </h2>
        <p className="route-detail-overlay__location">{route.location}</p>

        <div className="route-detail-overlay__meta">
          <span className="meta-badge">📏 {formatRouteDistanceKm(route.distance)}</span>
          {extNote && (
            <span className="meta-badge meta-badge--external-distance">{extNote}</span>
          )}
          <span className="meta-badge">⏱️ {route.estimatedTime} min</span>
          <span className={`meta-badge badge-${route.difficulty}`}>{route.difficulty}</span>
          {provenance && (
            <span
              className={`meta-badge meta-badge--${provenance.modifier}`}
              title={provenance.title}
            >
              {provenance.label}
            </span>
          )}
        </div>

        {route.coordinates.length >= 2 ? (
          <RouteThumbnail
            coordinates={route.coordinates}
            width={600}
            height={220}
            className="route-detail-overlay__outline"
            showBackdrop
          />
        ) : (
          <div className="route-detail-overlay__outline" aria-hidden="true" />
        )}

        <button
          type="button"
          className="route-detail-overlay__row"
          onClick={onStartRow}
          data-testid="route-detail-row"
        >
          ▶ Row this route
        </button>

        <p
          className="route-detail-overlay__attribution"
          data-testid="route-detail-attribution"
        >
          Route outline rendered from ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>{' '}
          contributors.
        </p>
      </div>
    </div>
  );
}

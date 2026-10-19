import React, { useMemo } from 'react';
import * as THREE from 'three';
import { buildLakeGuides, buildRiverGuides, guideLine, GUIDE_COLOURS } from './riverGuideGeometry';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';
import type { Coordinate } from '../../types/index';

/**
 * Draw the channel's centreline and water edges, behind the debug toggle.
 *
 * The rower and scull look off centre in the river on every route, and there
 * was no way to check by eye: the water renders close to white, so the far bank
 * washes out and only the near one reads as an edge. With the centreline drawn,
 * whether the boat is on it stops being a matter of opinion.
 *
 * On a lake route the lake's detected shoreline and its islands are traced
 * too (#493 FR22), so a mismatch with the real world shows in the scene.
 *
 * Off by default, and never rendered unless `debugMode` is on.
 */
export const RiverGuides: React.FC<{
  curve: THREE.CatmullRomCurve3 | null | undefined;
  enrichment?: RouteEnrichmentData | null;
  /** The route's first coordinate: where the curve's origin is on the map. */
  origin?: Coordinate | null;
}> = ({ curve, enrichment, origin }) => {
  const lines = useMemo(() => {
    const { centre, left, right } = buildRiverGuides(curve, enrichment);
    if (centre.length === 0) return [];
    const { shores, islands } = buildLakeGuides(enrichment?.lakes?.polygons, origin);
    return [
      guideLine(centre, GUIDE_COLOURS.centre),
      guideLine(left, GUIDE_COLOURS.edge),
      guideLine(right, GUIDE_COLOURS.edge),
      ...shores.map((points) => guideLine(points, GUIDE_COLOURS.shore)),
      ...islands.map((points) => guideLine(points, GUIDE_COLOURS.island)),
    ];
  }, [curve, enrichment, origin]);

  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  );
};

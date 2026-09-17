import React, { useMemo } from 'react';
import * as THREE from 'three';
import { buildRiverGuides, guideLine, GUIDE_COLOURS } from './riverGuideGeometry';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';

/**
 * Draw the channel's centreline and water edges, behind the debug toggle.
 *
 * The rower and scull look off centre in the river on every route, and there
 * was no way to check by eye: the water renders close to white, so the far bank
 * washes out and only the near one reads as an edge. With the centreline drawn,
 * whether the boat is on it stops being a matter of opinion.
 *
 * Off by default, and never rendered unless `debugMode` is on.
 */
export const RiverGuides: React.FC<{
  curve: THREE.CatmullRomCurve3 | null | undefined;
  enrichment?: RouteEnrichmentData | null;
}> = ({ curve, enrichment }) => {
  const lines = useMemo(() => {
    const { centre, left, right } = buildRiverGuides(curve, enrichment);
    if (centre.length === 0) return [];
    return [
      guideLine(centre, GUIDE_COLOURS.centre),
      guideLine(left, GUIDE_COLOURS.edge),
      guideLine(right, GUIDE_COLOURS.edge),
    ];
  }, [curve, enrichment]);

  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  );
};

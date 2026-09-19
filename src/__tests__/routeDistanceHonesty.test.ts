import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';
import { routeTotalDistanceMeters } from '../utils/geoUtils';

/**
 * A route must be as long as it says it is.
 *
 * The bundled Willowbrook route was described as "A scenic 5km journey" and
 * carried `distance: 5.0`, while its 100 coordinates trace 6.71 km. The card a
 * rower reads before starting said 5.00 km and 86 min; the boat then rowed 34%
 * further than that, and the estimate was wrong by the same margin.
 *
 * Found by using the app rather than by reading it: the route card said 5.00 km
 * and the scene's own telemetry said 6714 m.
 */
describe('a route is as long as it claims', () => {
  it('declares the distance its own coordinates trace', () => {
    for (const route of routeService.getAllRoutes()) {
      const measured = routeTotalDistanceMeters(route.coordinates) / 1000;

      expect(
        Math.abs(route.distance - measured),
        `${route.name} says ${route.distance.toFixed(2)} km and traces ` +
          `${measured.toFixed(2)} km`,
      ).toBeLessThan(0.05);
    }
  });

  it('estimates a time from the distance it actually is', () => {
    for (const route of routeService.getAllRoutes()) {
      const measured = routeTotalDistanceMeters(route.coordinates) / 1000;
      // The repo's own rule of thumb: 3.5 km/h average.
      const expected = Math.round((measured / 3.5) * 60);

      expect(
        Math.abs(route.estimatedTime - expected),
        `${route.name} estimates ${route.estimatedTime} min for what is really ` +
          `${measured.toFixed(2)} km`,
      ).toBeLessThanOrEqual(2);
    }
  });
});

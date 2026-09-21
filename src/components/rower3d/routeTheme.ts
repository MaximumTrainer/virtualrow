import type { RouteTheme } from './themeConfig';
import type { WaterRoute } from '../../types';

/**
 * Which theme dresses a route (#361).
 *
 * There is one, so this is a constant — but it is a named constant with a type
 * on it rather than a literal sprinkled through the scene, and it is the seam
 * that decided something different until five themes were retired.
 *
 * What it used to do is worth remembering, because it is the reason they went.
 * It matched a bare `thames`, `venice`, `charles`, `henley` and `boston` in a
 * route name, so a rownative course on the Tideway came out as a flooded
 * dystopia with anti-kaiju armour on Tower Bridge, one on the Charles as
 * tesseract architecture, and Henley Reach as a steampunk regatta. Those are
 * three of the most rowed stretches of water in the world.
 *
 * It lives here rather than in `Rower3D.tsx`, where it was, because that file
 * is excluded from coverage: a pure function in it was a pure function nothing
 * measured.
 */
export const detectRouteTheme = (_route: WaterRoute): RouteTheme => 'willowbrook';

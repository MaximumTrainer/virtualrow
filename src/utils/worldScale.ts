/**
 * One scene unit is one metre (#321).
 *
 * The scene used to be built at three scales at once: the route curve, the
 * water and the banks at 1 unit = 10 m; the boat hull, its oars and the camera
 * at 1 unit = 1 m; the scenery kit at roughly 1 unit = 2.5 m. Almost every
 * visual fault in #347 is downstream of that — the boat took nineteen seconds
 * to travel its own length at a pace that covers it in two, a 22 m tree came
 * out the size of a boat, and the blade-clearance check compared a channel
 * measured in tens of metres against an oar measured in metres.
 *
 * It lives in `utils/` rather than beside the rest of the scene constants
 * because `routeEnrichmentService` needs it too, and services may not import
 * from `components/`. It had its own `const SCENE_SCALE = 0.1` for exactly that
 * reason, which is a second copy of the number this whole issue is about.
 */
export const SCENE_SCALE = 1.0;

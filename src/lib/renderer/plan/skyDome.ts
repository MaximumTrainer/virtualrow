/**
 * Sky dome plan for P2 (#550 FR8). The actual geometry is a fullscreen
 * triangle rendered by `sky.wgsl` — no plan data to upload. This module
 * exists so later phases can hang cloud layouts off it without churning
 * the pass's import graph.
 */

export interface SkyDomePlan {
  horizon: [number, number, number];
  zenith: [number, number, number];
  sunDir: [number, number, number];
}

export const defaultSkyPlan = (): SkyDomePlan => ({
  horizon: [0.78, 0.86, 0.95],
  zenith: [0.35, 0.56, 0.86],
  sunDir: [0.3, 0.8, 0.5],
});

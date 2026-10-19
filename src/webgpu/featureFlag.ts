/**
 * D6-c: build-time off, runtime override on.
 *
 * The spike is lazy-imported from `BankFoliage` so the module only lands in
 * the bundle when the gate below says yes. `VITE_FEATURE_WEBGPU_CULL` is the
 * build-time switch; `window.__VIRTUALROW_WEBGPU_CULL` is the runtime
 * override that a Playwright spec or a dev console sets.
 *
 * The runtime override wins when it is explicitly true, so a CI job can
 * enable the spike without rebuilding the app.
 */
export const isWebGPUCullEnabled = (): boolean => {
  if (typeof window !== 'undefined' && window.__VIRTUALROW_WEBGPU_CULL === true) {
    return true;
  }
  const buildFlag = (import.meta as unknown as { env?: Record<string, unknown> }).env
    ?.VITE_FEATURE_WEBGPU_CULL;
  return buildFlag === 'on' || buildFlag === 'true' || buildFlag === true;
};

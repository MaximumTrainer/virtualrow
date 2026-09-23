import { test } from '@playwright/test';

/** TEMPORARY: what the #333 foliage costs a frame, per variant, on this OS. Never merged. */
const VARIANTS: Record<string, Record<string, unknown>> = {
  off: { foliage: false },
  on: {},
  'on-vd150': { bench: { vd: 150 } },
  'on-opaque': { bench: { opaque: true } },
  'on-lambert': { bench: { lambert: true } },
};
const TIERS = ['low', 'auto'] as const;

for (const tier of TIERS) {
  for (const [name, v] of Object.entries(VARIANTS)) {
    test(`${tier} ${name}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript(({ tier, v }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__VIRTUALROW_PERFORMANCE_MODE = tier;
        w.__VIRTUALROW_TELEMETRY = true;
        if (v.foliage === false) w.__VIRTUALROW_FOLIAGE = false;
        if (v.bench) w.__BENCH = v.bench;
      }, { tier, v });
      if (process.env.CLOUD_STUB) await page.route(/cloud\.png/, (r) => r.fulfill({ path: process.env.CLOUD_STUB!, contentType: 'image/png' }));
      const t0 = Date.now();
      await page.goto('./');
      await page.locator('.btn-try-demo').click();
      await page.waitForFunction(() => (window.__ROWER3D_FRAME_STATS?.frames ?? 0) > 5, undefined, { timeout: 180_000 });
      const firstFrames = Date.now() - t0;
      await page.waitForTimeout(20_000);
      const rt: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const s = Date.now();
        await page.evaluate(() => 0);
        rt.push(Date.now() - s);
        await page.waitForTimeout(200);
      }
      const stats = await page.evaluate(() => ({
        frame: window.__ROWER3D_FRAME_STATS,
        render: window.__ROWER3D_RENDER_STATS,
        foliage: (window as unknown as { __ROWER3D_FOLIAGE?: unknown }).__ROWER3D_FOLIAGE,
      }));
      console.log(`BENCH ${process.platform} ${tier} ${name} ` + JSON.stringify({ firstFramesMs: firstFrames, roundTripMs: rt.sort((a, b) => a - b)[5], ...stats }));
    });
  }
}

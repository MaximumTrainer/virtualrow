import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mock = path.resolve(__dirname, '../mock-bluetooth.js');

let sim = false;
test.beforeAll(async () => { sim = await useSimServer(); });
test.afterAll(async () => { await releaseSimServer(); });

const snap = (page: Page) => page.evaluate(() => ({
  progress: window.__ROWER3D_POS?.progress ?? null,
  lostFlag: (window as unknown as { __ROWER3D_WEBGL_LOST?: boolean }).__ROWER3D_WEBGL_LOST ?? false,
  ctx: window.__ROWER3D_CONTEXT_STATE,
  banner: (() => { const m = document.querySelector('.rower3d-fallback-marker') as HTMLElement|null;
    return m && m.style.display !== 'none' ? (m.textContent ?? '') : ''; })(),
  drawCalls: window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0,
  sampledAt: window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0,
  meters: document.querySelector('.activity-stat-card .activity-stat-value')?.textContent ?? '',
  session: !!window.__workoutService?.getCurrentSession?.(),
}));

test('probe: what a context loss does to a ride', async ({ page }) => {
  test.slow();
  await page.addInitScript({ content: fs.readFileSync(mock, 'utf8') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = cs.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate'));
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click());
  await page.waitForTimeout(6000);

  // Row a bit so there is a ride in progress.
  let d = 0;
  for (let i = 1; i <= 6; i += 1) { d += 4.17; await emitPm5({ distance: Math.round(d), elapsedTime: i, pace: 120, cadence: 24, power: 180, heartRate: 140 }); await page.waitForTimeout(700); }
  console.log('BEFORE ' + JSON.stringify(await snap(page)));

  await page.evaluate(() => {
    const c = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement;
    (c?.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  });

  for (const wait of [1000, 3000, 6000, 12000]) {
    await page.waitForTimeout(wait);
    console.log(`AFTER+${wait} ` + JSON.stringify(await snap(page)));
  }

  // Keep rowing through it.
  for (let i = 7; i <= 12; i += 1) { d += 4.17; await emitPm5({ distance: Math.round(d), elapsedTime: i, pace: 120, cadence: 24, power: 180, heartRate: 140 }); await page.waitForTimeout(700); }
  console.log('ROWED_THROUGH ' + JSON.stringify(await snap(page)));
  console.log('SIM ' + sim);
});

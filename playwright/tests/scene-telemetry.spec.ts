import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/**
 * The telemetry log is only worth having if it is still there afterwards.
 *
 * Its whole reason for existing is the case where the renderer dies and the tab
 * reloads: every other reading the scene keeps is in memory and goes with it,
 * which is what happened twice during #272 and left nothing to explain it.
 */

const readLog = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('virtualrow:scene-telemetry');
      return raw ? (JSON.parse(raw) as Array<{ kind: string; detail?: unknown }>) : [];
    } catch {
      return [];
    }
  });

async function startRowing(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await page.waitForFunction(() => {
    const cs = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const t = cs.find((c) => c.querySelector('.device-name')?.textContent?.includes('Concept2 PM5'));
    return t?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
  }, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = cs.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await page.waitForFunction(() => {
    const cs = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const t = cs.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
    return t?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
  }, undefined, { timeout: 15_000 });
  await page.evaluate(() => (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click());
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
}

test('the scene records what it was doing, and it survives a reload', async ({ page }) => {
  test.slow();
  await startRowing(page);
  await page.waitForTimeout(7_000);

  const rowing = await readLog(page);
  const kinds = rowing.map((e) => e.kind);

  expect(kinds, 'nothing recorded the run starting').toContain('run-start');
  expect(kinds, 'the context being created went unrecorded').toContain('context-created');
  expect(kinds, 'the scene recorded nothing about itself while rowing').toContain('sample');

  // A sample says something worth reading.
  const sample = rowing.find((e) => e.kind === 'sample')!;
  expect(Object.keys(sample.detail as Record<string, unknown>)).toEqual(
    expect.arrayContaining(['progress', 'drawCalls', 'triangles']),
  );

  // The case it exists for: lose the context, then reload as a crash would.
  await page.evaluate(() => {
    const canvas = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await page.waitForTimeout(2_000);

  await page.reload();
  await page.waitForTimeout(2_000);

  const afterReload = await readLog(page);
  const lost = afterReload.filter((e) => e.kind === 'context-lost');

  expect(lost.length, 'the lost context did not survive the reload').toBeGreaterThan(0);
  expect(
    afterReload.filter((e) => e.kind === 'run-start').length,
    'the two runs cannot be told apart',
  ).toBeGreaterThan(1);
});

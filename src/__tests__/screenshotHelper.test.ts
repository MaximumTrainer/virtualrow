import { describe, it, expect, vi } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import { captureTestEvidence } from '../../playwright/utils/screenshot-helper';

/**
 * Evidence is for the person reading a report, not an assertion.
 *
 * A full-page screenshot of a WebGL page on the windows runner's software
 * renderer can outlast the 10 s action timeout, and the evidence step then
 * failed a test whose every assertion held - "page.screenshot: Timeout
 * 10000ms exceeded" at virtualrow.spec.ts, on #390 and on the A/B in #397.
 */

const info = () =>
  ({ outputDir: '/tmp/out', annotations: [] as { type: string; description?: string }[] }) as unknown as TestInfo;

describe('captureTestEvidence', () => {
  it('takes a full-page screenshot into the test output', async () => {
    const screenshot = vi.fn().mockResolvedValue(Buffer.from(''));
    await captureTestEvidence({ screenshot } as unknown as Page, info(), '09 workout in progress');

    expect(screenshot).toHaveBeenCalledTimes(1);
    const [options] = screenshot.mock.calls[0];
    expect(options.fullPage).toBe(true);
    expect(options.path).toMatch(/^\/tmp\/out\/09-workout-in-progress-\d+\.png$/);
  });

  it('records a missed shot on the test instead of failing it', async () => {
    const screenshot = vi.fn().mockRejectedValue(new Error('page.screenshot: Timeout 10000ms exceeded.'));
    const testInfo = info();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      captureTestEvidence({ screenshot } as unknown as Page, testInfo, '09 workout in progress'),
    ).resolves.toBeUndefined();

    expect(testInfo.annotations).toEqual([
      { type: 'evidence-skipped', description: expect.stringContaining('09 workout in progress') },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

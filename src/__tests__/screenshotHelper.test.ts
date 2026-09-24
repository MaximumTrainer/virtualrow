import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import { captureTestEvidence } from '../../playwright/utils/screenshot-helper';

/**
 * Evidence is for the person reading a report, not an assertion.
 *
 * A full-page screenshot of a WebGL page on the windows runner's software
 * renderer can outlast the 10 s action timeout, and the evidence step then
 * failed a test whose every assertion held - "page.screenshot: Timeout
 * 10000ms exceeded" at virtualrow.spec.ts, on #390 and on the A/B in #397.
 *
 * The captures are opt-in since #401 - a passing test does not photograph
 * itself twenty-two times on a software rasteriser - so these cases turn them
 * on. That is the only state in which either behaviour below can happen, and
 * the last case pins the default.
 */

const info = () =>
  ({ outputDir: '/tmp/out', annotations: [] as { type: string; description?: string }[] }) as unknown as TestInfo;

describe('captureTestEvidence', () => {
  beforeEach(() => {
    process.env.CAPTURE_TEST_EVIDENCE = '1';
  });
  afterEach(() => {
    delete process.env.CAPTURE_TEST_EVIDENCE;
  });

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

  // The default, and the reason the two cases above have to ask: twenty-two
  // full-page shots over a WebGL canvas, per run, for images nobody opens.
  it('takes nothing at all unless it is asked to', async () => {
    delete process.env.CAPTURE_TEST_EVIDENCE;
    const screenshot = vi.fn().mockResolvedValue(Buffer.from(''));

    await captureTestEvidence({ screenshot } as unknown as Page, info(), '09 workout in progress');

    expect(screenshot).not.toHaveBeenCalled();
  });
});

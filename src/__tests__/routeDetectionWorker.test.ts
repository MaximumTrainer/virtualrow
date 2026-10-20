import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerDetectionRequest } from '../lib/utils/routeDetection';

/** #493 D23 b: the worker script answers each message with answerDetectionRequest's reply. */
describe('routeDetection.worker', () => {
  afterEach(() => {
    self.onmessage = null;
    vi.restoreAllMocks();
  });

  it('posts back the answer to each request', async () => {
    const post = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined);
    await import('../lib/workers/routeDetection.worker');

    self.onmessage?.(new MessageEvent('message', { data: 'not a request' }));

    expect(post).toHaveBeenCalledWith(answerDetectionRequest('not a request'));
  });
});

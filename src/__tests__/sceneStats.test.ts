import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRenderStats,
  readRenderStats,
  clearRenderStats,
  type RenderStatsSource,
} from '../components/rower3d/sceneStats';

/** A renderer stub shaped like the part of THREE.WebGLRenderer that is read. */
interface StubRenderer {
  info: {
    autoReset: boolean;
    render: { calls: number; triangles: number };
    reset: () => void;
  };
}

const renderer = (calls: number, triangles: number): StubRenderer => {
  const info = {
    autoReset: true,
    render: { calls, triangles },
    reset: () => {
      info.render.calls = 0;
      info.render.triangles = 0;
    },
  };
  return { info };
};

describe('readRenderStats', () => {
  beforeEach(() => clearRenderStats());

  it('has nothing to report before a frame has been measured', () => {
    expect(readRenderStats()).toBeNull();
  });
});

describe('recordRenderStats', () => {
  beforeEach(() => clearRenderStats());

  it('reports the draw calls and triangles of the frame just drawn', () => {
    recordRenderStats(renderer(412, 250_000), { backend: 'webgl', performanceMode: 'high' });

    expect(readRenderStats()).toMatchObject({
      drawCalls: 412,
      triangles: 250_000,
      backend: 'webgl',
      performanceMode: 'high',
    });
  });

  it('zeroes the counters so the next frame is counted on its own', () => {
    const gl = renderer(412, 250_000);

    recordRenderStats(gl, { backend: 'webgl', performanceMode: 'high' });

    expect(gl.info.render.calls).toBe(0);
    expect(gl.info.render.triangles).toBe(0);
  });

  it('takes the counters off automatic reset, so a frame is not lost mid-count', () => {
    const gl = renderer(1, 1);

    recordRenderStats(gl, { backend: 'webgl', performanceMode: 'high' });

    expect(gl.info.autoReset).toBe(false);
  });

  it('keeps the most recent frame', () => {
    recordRenderStats(renderer(100, 1), { backend: 'webgl', performanceMode: 'low' });
    recordRenderStats(renderer(200, 2), { backend: 'webgl', performanceMode: 'low' });

    expect(readRenderStats()?.drawCalls).toBe(200);
  });

  it('carries frame timing when the scene has measured some', () => {
    recordRenderStats(renderer(10, 20), {
      backend: 'webgl',
      performanceMode: 'low',
      fps: 58.6,
      p95Ms: 21.4,
    });

    expect(readRenderStats()).toMatchObject({ fps: 58.6, p95Ms: 21.4, backend: 'webgl' });
  });

  it('survives a renderer that reports no counters at all', () => {
    expect(() =>
      recordRenderStats({} as RenderStatsSource, { backend: 'webgl', performanceMode: 'high' }),
    ).not.toThrow();
    expect(readRenderStats()).toBeNull();
  });
});

describe('the renderer actually in use', () => {
  beforeEach(() => clearRenderStats());

  it('reports the renderer it was handed, not the one detection found', () => {
    // `backend` says what the browser can do; `drawing` says what three is
    // actually using. They agreed once the WebGPU label went (#345), but they
    // are still different questions - and the panel answering the wrong one is
    // what sent a reader looking in the wrong place in the first place (#232).
    const gl = { ...renderer(10, 20), isWebGLRenderer: true };

    recordRenderStats(gl, { backend: 'webgl', performanceMode: 'low' });

    expect(readRenderStats()).toMatchObject({ backend: 'webgl', drawing: 'webgl' });
  });

  it('says so when it cannot tell', () => {
    recordRenderStats(renderer(10, 20), { backend: 'webgl', performanceMode: 'low' });

    expect(readRenderStats()?.drawing).toBe('unknown');
  });
});

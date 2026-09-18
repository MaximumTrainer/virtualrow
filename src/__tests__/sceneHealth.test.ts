import { describe, it, expect } from 'vitest';
import { describeSceneHealth, CONTEXT_LOST_TEXT } from '../utils/sceneHealth';

/**
 * Playwright specs were passing while the stage showed
 * "The 3D view lost the graphics context — restoring…".
 *
 * Eighteen of the twenty-one specs that drive the 3D scene never checked for
 * it, so a test could assert a canvas existed, telemetry was produced, or
 * nothing threw — all true of a scene that is showing an error banner instead
 * of a river.
 */
describe('describeSceneHealth', () => {
  it('calls a rendering scene alive', () => {
    const health = describeSceneHealth({ contextLost: false, markerText: '', canvasCount: 1 });

    expect(health.alive).toBe(true);
  });

  it('refuses a scene showing the context-lost banner', () => {
    const health = describeSceneHealth({
      contextLost: false,
      markerText: 'The 3D view lost the graphics context — restoring…',
      canvasCount: 1,
    });

    expect(health.alive).toBe(false);
    expect(health.reason).toMatch(/graphics context/i);
  });

  it('refuses a scene whose live canvas reports a lost context', () => {
    // Asked of the canvas on screen, not of a global flag: that flag outlives
    // the canvas that set it, and React mounts the Canvas twice under
    // StrictMode, so a discarded first canvas left it true for good.
    const health = describeSceneHealth({ contextLost: true, markerText: '', canvasCount: 1 });

    expect(health.alive).toBe(false);
    expect(health.reason).toMatch(/lost WebGL context/i);
  });

  it('does not fail a healthy canvas because the global flag is stale', () => {
    const health = describeSceneHealth({
      contextLost: false,
      markerText: '',
      canvasCount: 1,
      flagSet: true,
    });

    expect(health.alive).toBe(true);
  });

  it('refuses a stage with no canvas at all', () => {
    const health = describeSceneHealth({ contextLost: false, markerText: '', canvasCount: 0 });

    expect(health.alive).toBe(false);
    expect(health.reason).toMatch(/canvas/i);
  });

  it('matches the banner however it is punctuated', () => {
    // The app uses a typographic ellipsis; an em dash and a plain hyphen have
    // both appeared in reports of this.
    for (const text of [
      'The 3D view lost the graphics context — restoring…',
      'The 3D view lost the graphics context - restoring...',
      'the 3d view LOST THE GRAPHICS CONTEXT',
    ]) {
      expect(describeSceneHealth({ contextLost: false, markerText: text, canvasCount: 1 }).alive).toBe(
        false,
      );
    }
  });

  it('ignores unrelated marker text', () => {
    // The marker is also used for the deliberate no-WebGL fallback, which is a
    // different condition and not this defect.
    const health = describeSceneHealth({
      contextLost: false,
      markerText: '3D unavailable on this device',
      canvasCount: 1,
    });

    expect(health.alive).toBe(true);
  });

  it('names the text it looks for, so the app and the guard cannot drift', () => {
    expect(CONTEXT_LOST_TEXT).toMatch(/lost the graphics context/i);
  });

  it('says which canvas was lost, so a failure can be read without a rerun', () => {
    // Two canvases mean React mounted the Canvas twice and one was discarded.
    // Which of them reports the loss is the difference between a stale mount
    // and the scene the rower is looking at, and a CI failure gets one run.
    const health = describeSceneHealth({
      contextLost: true,
      markerText: '',
      canvasCount: 2,
      lostPerCanvas: [false, true],
    });

    expect(health.alive).toBe(false);
    expect(health.reason).toContain('canvases=2');
    expect(health.reason).toContain('[false,true]');
  });
});

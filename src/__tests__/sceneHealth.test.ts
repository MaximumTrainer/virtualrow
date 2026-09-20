import { describe, it, expect } from 'vitest';
import {
  describeSceneHealth,
  CONTEXT_LOST_TEXT,
  CONTEXT_LOST_MESSAGE,
  CONTEXT_UNRECOVERABLE_MESSAGE,
} from '../utils/sceneHealth';

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

  it('recognises the exact sentence the app puts on screen', () => {
    // The guard matches a fragment; the app shows a sentence. They are one
    // constant now, and this is what holds them together - a reworded message
    // that no longer contains the fragment fails here rather than in the field
    // (#299).
    expect(CONTEXT_LOST_MESSAGE.toLowerCase()).toContain(CONTEXT_LOST_TEXT);

    const health = describeSceneHealth({
      contextLost: false,
      markerText: CONTEXT_LOST_MESSAGE,
      canvasCount: 1,
    });

    expect(health.alive, 'the banner the app shows was not recognised').toBe(false);
  });

  it('judges the canvas on screen, not one React threw away', () => {
    // The whole reason for asking a canvas instead of the global flag was that
    // "a discarded first canvas losing its context left that flag true while
    // the canvas on screen was fine". Reducing with `some` put that straight
    // back: any stale canvas with a released context failed the assertion
    // (#299). The live one is the one most recently mounted.
    const health = describeSceneHealth({
      contextLost: true,
      markerText: '',
      canvasCount: 2,
      lostPerCanvas: [true, false],
    });

    expect(health.alive, 'a discarded canvas failed the live one').toBe(true);
  });
});

/**
 * A context that will not come back has to stop saying it is coming back
 * (#309).
 *
 * Probed on the demo row: the context went, the three restore attempts ran out
 * at about 5.8 s, and the stage went on reading "The 3D view lost the graphics
 * context — restoring…" for the next sixteen seconds. Whatever a rower makes of
 * that, it is not true.
 */
describe('the message for a context that is not coming back', () => {
  it('still contains the fragment the guard matches on', () => {
    // If it did not, a dead scene showing this message would pass
    // expectSceneAlive's marker check - which is the fault #299 fixed, put
    // back by a reworded sentence.
    expect(CONTEXT_UNRECOVERABLE_MESSAGE.toLowerCase()).toContain(CONTEXT_LOST_TEXT);
  });

  it('stops promising a restore', () => {
    expect(CONTEXT_UNRECOVERABLE_MESSAGE.toLowerCase()).not.toContain('restoring');
  });

  it('tells the rower their row is safe, and how to get the view back', () => {
    // The two things they need: that the session is not lost, and the one
    // action that helps. A message that only apologises is worse than none.
    expect(CONTEXT_UNRECOVERABLE_MESSAGE.toLowerCase()).toContain('still being recorded');
    expect(CONTEXT_UNRECOVERABLE_MESSAGE.toLowerCase()).toContain('reload');
  });

  it('is judged not alive, like the message it replaces', () => {
    const health = describeSceneHealth({
      contextLost: false,
      markerText: CONTEXT_UNRECOVERABLE_MESSAGE,
      canvasCount: 1,
    });

    expect(health.alive).toBe(false);
  });
});

/**
 * A discarded mount losing its context is not a fault (#309, R9).
 *
 * React mounts the Canvas twice under StrictMode and R3F disposes the renderer
 * of the one it throws away. That releases a context, which is normal - but it
 * is indistinguishable in the telemetry log from the canvas on screen losing
 * one, which is not. #299 fixed the live judgement; the log still could not
 * tell them apart afterwards, which is exactly when someone is reading it.
 */
describe('which canvas lost the context', () => {
  it('reports a discarded mount as not the one on screen', () => {
    // Two canvases, the first discarded and lost, the second drawing.
    const health = describeSceneHealth({
      contextLost: true,
      markerText: '',
      canvasCount: 2,
      lostPerCanvas: [true, false],
    });

    expect(health.alive, 'a discarded mount was read as a live fault').toBe(true);
  });

  it('reports the canvas on screen losing its context as a fault', () => {
    const health = describeSceneHealth({
      contextLost: true,
      markerText: '',
      canvasCount: 2,
      lostPerCanvas: [false, true],
    });

    expect(health.alive).toBe(false);
  });
});

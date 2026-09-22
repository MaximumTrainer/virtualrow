import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BASE_FOV,
  CAMERA_VIEWS,
  FOV_FULL_SPEED,
  FOV_SPEED_RANGE,
  LOOK_AT_TAU,
  POSITION_TAU,
  cameraTarget,
  createRigTarget,
  damp,
  dampedFollow,
  isCameraView,
  nextView,
  portraitFov,
  type CameraView,
} from '../components/rower3d/cameraRig';

/**
 * Issue #328 — the camera was a hard assignment, every frame.
 *
 * boat − tangent × 6, two and a half metres up, `lookAt(boat + 0.3)`, with no
 * lag and no damping, so every wobble in the tangent reached the camera — and
 * the tangent comes from dense Hermite samples, which wobble on bends by
 * construction (#224). A fixed 60° field of view on top, so a boat at racing
 * pace was framed exactly like a boat at rest.
 */

/** A boat at the origin heading down −Z, which is the fallback route heading. */
const straight = (view: CameraView, velocityMps = 0, bendSign = 0) =>
  cameraTarget(
    {
      boat: new THREE.Vector3(0, 0, 0),
      tangent: new THREE.Vector3(0, 0, -1),
      velocityMps,
      view,
      bendSign,
    },
    createRigTarget(),
  );

describe('cameraTarget', () => {
  it('puts the chase camera seven metres behind the boat', () => {
    const { position } = straight('chase');

    // Behind means against the tangent: the boat is heading −Z, so behind is +Z.
    expect(position.z).toBeCloseTo(7, 5);
    expect(position.y).toBeCloseTo(2.6, 5);
    expect(position.x).toBeCloseTo(0, 5);
  });

  it('puts the high camera further back and higher than the chase', () => {
    expect(straight('high').position.z).toBeGreaterThan(straight('chase').position.z);
    expect(straight('high').position.y).toBeGreaterThan(straight('chase').position.y);
  });

  // The issue's code sample offsets the bow view 0.8 m from the boat's origin,
  // which is the middle of an eight-metre hull — the camera would be inside
  // the boat. FR1 says 0.8 m ahead of the *bow*.
  it('puts the bow camera ahead of the hull, not inside it', () => {
    const { position, lookAt } = straight('bow');

    expect(position.z, 'the bow camera is behind the boat').toBeLessThan(0);
    expect(Math.abs(position.z), 'the bow camera is inside the hull').toBeGreaterThan(4.4);
    expect(position.y).toBeCloseTo(1.1, 5);
    expect(lookAt.z, 'the bow camera is not looking down the route').toBeLessThan(-20);
  });

  it('puts the side camera out to one side, level with the boat', () => {
    const { position } = straight('side', 0, 1);

    expect(Math.abs(position.x), 'the side camera is not to the side').toBeCloseTo(12, 5);
    expect(position.z, 'the side camera dropped back down the route').toBeCloseTo(0, 5);
    expect(position.y).toBeCloseTo(3, 5);
  });

  it('puts the side camera on the outside of the bend, whichever way it turns', () => {
    const left = straight('side', 0, -1).position.x;
    const right = straight('side', 0, 1).position.x;

    expect(Math.sign(left)).toBe(-Math.sign(right));
  });

  // A straight has no outside. Taking the sign as it comes would swap banks
  // every time the curvature crossed zero, which on a nominally straight route
  // is several times a minute.
  it('keeps the side camera on one bank down a straight', () => {
    expect(straight('side', 0, 0).position.x).toBeCloseTo(
      straight('side', 0, 1).position.x,
      5,
    );
  });

  it('holds the camera level rather than banking it into the bend', () => {
    const bend = cameraTarget(
      {
        boat: new THREE.Vector3(0, 0, 0),
        tangent: new THREE.Vector3(0.6, 0, -0.8),
        velocityMps: 4,
        view: 'side',
        bendSign: 1,
      },
      createRigTarget(),
    );

    expect(bend.position.y, 'the camera banked with the route').toBeCloseTo(3, 5);
  });

  it('looks at the boat rather than at the water it sits in', () => {
    expect(straight('chase').lookAt.y).toBeCloseTo(0.3, 5);
  });

  describe('the field of view', () => {
    it('is the resting angle at a standstill', () => {
      expect(straight('chase', 0).fov).toBeCloseTo(BASE_FOV, 5);
    });

    it('opens with speed', () => {
      expect(straight('chase', 2).fov).toBeGreaterThan(straight('chase', 1).fov);
    });

    it('stops opening at the top of its range', () => {
      const top = BASE_FOV + FOV_SPEED_RANGE;
      expect(straight('chase', FOV_FULL_SPEED).fov).toBeCloseTo(top, 5);
      expect(straight('chase', 50).fov).toBeCloseTo(top, 5);
    });

    it('does not narrow below the resting angle when the boat runs backwards', () => {
      expect(straight('chase', -3).fov).toBeCloseTo(BASE_FOV, 5);
    });

    // Motion the viewer did not ask for and cannot stop is the kind the
    // setting exists for.
    it('does not move at all under reduced motion', () => {
      const still = cameraTarget(
        {
          boat: new THREE.Vector3(),
          tangent: new THREE.Vector3(0, 0, -1),
          velocityMps: 5,
          view: 'chase',
          bendSign: 0,
          reducedMotion: true,
        },
        createRigTarget(),
      );

      expect(still.fov).toBeCloseTo(BASE_FOV, 5);
    });
  });

  it('writes into the target it was given rather than allocating one a frame', () => {
    const out = createRigTarget();
    expect(
      cameraTarget(
        {
          boat: new THREE.Vector3(),
          tangent: new THREE.Vector3(0, 0, -1),
          velocityMps: 0,
          view: 'chase',
          bendSign: 0,
        },
        out,
      ),
    ).toBe(out);
  });
});

describe('damp', () => {
  it('closes most of the gap in one time constant', () => {
    const current = new THREE.Vector3(0, 0, 0);
    damp(current, new THREE.Vector3(10, 0, 0), 0.35, 0.35);

    // 1 − 1/e.
    expect(current.x).toBeCloseTo(10 * 0.6321, 3);
  });

  /**
   * The reason this is exponential rather than a fixed lerp.
   *
   * `lerp(target, 0.1)` per frame converges twice as fast at 120 fps as at 60,
   * so the camera feels different on different machines and cannot be tuned
   * for either.
   */
  it('converges to the same place at 30 fps as at 120 fps', () => {
    const run = (fps: number) => {
      const current = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(10, 0, 0);
      for (let i = 0; i < fps; i += 1) damp(current, target, 0.35, 1 / fps);
      return current.x;
    };

    expect(run(30)).toBeCloseTo(run(120), 3);
  });

  it('never overshoots, however long the frame was', () => {
    const current = new THREE.Vector3(0, 0, 0);
    damp(current, new THREE.Vector3(10, 0, 0), 0.35, 60);

    expect(current.x).toBeLessThanOrEqual(10);
    expect(current.x).toBeGreaterThan(9.9);
  });

  it('snaps when asked for no smoothing at all', () => {
    const current = new THREE.Vector3(0, 0, 0);
    damp(current, new THREE.Vector3(1, 2, 3), 0, 1 / 60);

    expect(current.toArray()).toEqual([1, 2, 3]);
  });

  // A camera that arrives before it has finished turning reads as a swing;
  // the other way round reads as a drift.
  it('turns faster than it travels', () => {
    expect(LOOK_AT_TAU).toBeLessThan(POSITION_TAU);
  });
});

describe('dampedFollow', () => {
  /**
   * The reason this exists rather than damping the world position.
   *
   * An exponential follower trails a moving target by velocity times the time
   * constant, in steady state. Measured in a running scene, the chase camera
   * sat 8.04 m behind a boat it is supposed to sit 7 m behind — and the faster
   * the rower went, the further away the boat got.
   */
  it('holds its distance from a boat that is moving', () => {
    const offset = new THREE.Vector3();
    const out = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const boat = new THREE.Vector3();
    const target = new THREE.Vector3();
    const speed = 4.17;
    const dt = 1 / 60;

    // Ten seconds of rowing down −Z, with the target always 7 m behind.
    for (let i = 0; i < 600; i += 1) {
      boat.z -= speed * dt;
      target.set(boat.x, boat.y + 2.6, boat.z + 7);
      dampedFollow(offset, target, boat, POSITION_TAU, dt, out, scratch);
    }

    expect(out.z - boat.z, 'the camera trails a moving boat').toBeCloseTo(7, 2);
  });

  it('still smooths a target that jumps about', () => {
    const offset = new THREE.Vector3();
    const out = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const boat = new THREE.Vector3();

    dampedFollow(offset, new THREE.Vector3(0, 0, 7), boat, POSITION_TAU, 1 / 60, out, scratch);
    const first = out.z;
    // The target swings 5 m sideways in one frame, as a tangent can on a bend.
    dampedFollow(offset, new THREE.Vector3(5, 0, 7), boat, POSITION_TAU, 1 / 60, out, scratch);

    expect(first).toBeLessThan(7);
    expect(out.x, 'the camera snapped to the new offset instead of easing').toBeLessThan(1);
  });

  it('writes into the vector it was given', () => {
    const out = new THREE.Vector3();
    expect(
      dampedFollow(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, 7),
        new THREE.Vector3(),
        POSITION_TAU,
        1 / 60,
        out,
        new THREE.Vector3(),
      ),
    ).toBe(out);
  });
});

describe('portraitFov', () => {
  it('leaves a landscape canvas alone', () => {
    expect(portraitFov(58, 16 / 9)).toBe(58);
    expect(portraitFov(58, 1)).toBe(58);
  });

  it('widens as the canvas gets narrower', () => {
    expect(portraitFov(58, 0.75)).toBeGreaterThan(58);
    expect(portraitFov(58, 0.5)).toBeGreaterThan(portraitFov(58, 0.75));
  });

  it('stops widening before the view turns inside out', () => {
    expect(portraitFov(58, 0.01)).toBeLessThanOrEqual(100);
  });

  it('holds its nerve on a canvas with no height', () => {
    for (const aspect of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(portraitFov(58, aspect)).toBe(58);
    }
  });

  // The rig writes the field of view every frame and the widening used to be
  // written from a resize effect, so the rig would have won on the very next
  // frame. Composed, the speed coupling still reaches a portrait phone.
  it('widens whatever the speed coupling asked for', () => {
    const fast = straight('chase', 5).fov;
    expect(portraitFov(fast, 0.5)).toBeGreaterThan(fast);
  });
});

describe('nextView', () => {
  it('cycles through every view and returns to the start', () => {
    let view: CameraView = 'chase';
    const seen: CameraView[] = [view];
    for (let i = 0; i < CAMERA_VIEWS.length - 1; i += 1) {
      view = nextView(view);
      seen.push(view);
    }

    expect(new Set(seen).size, 'a view is missing from the cycle').toBe(
      CAMERA_VIEWS.length,
    );
    expect(nextView(view)).toBe('chase');
  });

  it('starts from the beginning when handed something it does not know', () => {
    expect(nextView('orbit' as CameraView)).toBe(CAMERA_VIEWS[0]);
  });
});

describe('isCameraView', () => {
  // What comes out of localStorage is whatever was last put there, by any
  // version of this app — including one that had a view this build does not.
  it('accepts the views this build has', () => {
    for (const view of CAMERA_VIEWS) expect(isCameraView(view)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['orbit', '', null, undefined, 3, {}]) {
      expect(isCameraView(value), `${String(value)} was accepted`).toBe(false);
    }
  });
});

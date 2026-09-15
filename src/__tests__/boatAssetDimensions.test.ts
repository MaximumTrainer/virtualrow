import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readGlbWorldBounds, parseGlbJson } from '../utils/glbBounds';

/**
 * The boat is the one model a rower looks at for the whole session, so it is
 * held to the real thing rather than to a label.
 *
 * Figures are the FISA/World Rowing minimums and the settings a single scull is
 * actually rigged to:
 *
 *   hull            8.0-8.2 m long, ~0.28 m beam, minimum weight 14 kg
 *   oarlock span    158-162 cm between pin centres (160 typical)
 *   sculling oar    284-290 cm overall, inboard 87-89 cm
 *   cleaver blade   ~46 cm long, 17-18 cm across
 *
 * Measured in world space: the oars are modelled about their own gate and
 * placed by node transforms, so reading accessors alone understates the boat by
 * the whole rigger span (issue #232).
 */

const boat = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'public/assets/boat', file));

const CREWED = ['scull-male.glb', 'scull-female.glb'];
const ALL = ['scull.glb', ...CREWED];

const worldBounds = (file: string, filter?: (name: string) => boolean) =>
  readGlbWorldBounds(boat(file), filter);

describe('the hull is a single scull', () => {
  it.each(ALL)('%s is 8.0-8.2 m long', (file) => {
    const hull = worldBounds(file, (name) => name === 'Hull');

    expect(hull?.z).toBeGreaterThanOrEqual(8.0);
    expect(hull?.z).toBeLessThanOrEqual(8.2);
  });

  it.each(ALL)('%s carries a racing beam, not a dinghy one', (file) => {
    const hull = worldBounds(file, (name) => name === 'Hull');

    expect(hull?.x).toBeGreaterThanOrEqual(0.25);
    expect(hull?.x).toBeLessThanOrEqual(0.35);
  });
});

describe('the rig matches how a single is set up', () => {
  it.each(ALL)('%s spans 158-162 cm between the gates', (file) => {
    const gates = worldBounds(file, (name) => name.endsWith('Gate'));

    // Gate centres, so the span is the outer measure less one gate's width.
    const span = (gates?.x ?? 0) - 0.06;
    expect(span).toBeGreaterThanOrEqual(1.58);
    expect(span).toBeLessThanOrEqual(1.62);
  });

  it.each(ALL)('%s reaches 5.4-5.7 m across the blades', (file) => {
    // Span plus twice the outboard: the width the boat actually sweeps.
    const whole = worldBounds(file);

    expect(whole?.x).toBeGreaterThanOrEqual(5.4);
    expect(whole?.x).toBeLessThanOrEqual(5.7);
  });

  it.each(ALL)('%s rows an oar of 284-290 cm, not a longer one', (file) => {
    const oar = worldBounds(file, (name) => name.startsWith('RightOar'));

    // Handle end to blade tip, measured across the boat.
    expect(oar?.x).toBeGreaterThanOrEqual(2.84);
    expect(oar?.x).toBeLessThanOrEqual(2.9);
  });

  it.each(ALL)('%s carries sculling blades, not sweep blades', (file) => {
    const blade = worldBounds(file, (name) => name === 'RightOar_Blade');

    // Axes matter as much as sizes, and this test used to check the wrong ones:
    // it read the blade's length along the boat rather than along the oar, so
    // it passed a spoon lying fore-aft like a fin. World x runs across the beam,
    // which is the oar's own direction while it sits square to the boat (#232).
    expect(blade?.x, 'length, along the oar').toBeGreaterThanOrEqual(0.44);
    expect(blade?.x, 'length, along the oar').toBeLessThanOrEqual(0.48);
    expect(blade?.y, 'width, standing up').toBeGreaterThanOrEqual(0.16);
    expect(blade?.y, 'width, standing up').toBeLessThanOrEqual(0.2);
    expect(blade?.z, 'thickness, fore and aft').toBeLessThanOrEqual(0.08);
  });

  it.each(ALL)('%s squares its blades, since nothing feathers them', (file) => {
    const blade = worldBounds(file, (name) => name === 'RightOar_Blade');

    // The scene sweeps each oar about Y and never rolls it, so the blade holds
    // whatever roll it was built with for the whole drive. Squared means the
    // face stands up across the direction of travel: taller than it is thick.
    expect(blade!.y).toBeGreaterThan(blade!.z * 2);
  });

  it.each(ALL)('%s puts the blade at the end of the oar, not past it', (file) => {
    const blade = worldBounds(file, (name) => name === 'RightOar_Blade');
    const oar = worldBounds(file, (name) => name.startsWith('RightOar'));

    expect(blade!.max[0]).toBeCloseTo(oar!.max[0], 2);
  });
});

describe('the crew is a person', () => {
  it.each(CREWED)('%s seats a rower of a plausible height', (file) => {
    const rower = worldBounds(file, (name) =>
      /^(Head|Hair|Torso_|LeftArm_|RightArm_|LeftHand|RightHand|LeftThigh|RightThigh|LeftShin|RightShin|LeftFoot|RightFoot)/.test(
        name,
      ),
    );

    // Seated in the boat, heel to crown: around a metre for an adult.
    expect(rower?.y).toBeGreaterThanOrEqual(0.85);
    expect(rower?.y).toBeLessThanOrEqual(1.25);
  });

  it.each(CREWED)('%s has shoulders of adult width', (file) => {
    const shoulders = worldBounds(file, (name) => name === 'Torso_Shoulders');

    expect(shoulders?.x).toBeGreaterThanOrEqual(0.38);
    expect(shoulders?.x).toBeLessThanOrEqual(0.52);
  });

  it.each(CREWED)('%s fits its rower inside the hull length', (file) => {
    const hull = worldBounds(file, (name) => name === 'Hull');
    const rower = worldBounds(file, (name) => name.startsWith('Torso_'));

    expect(rower?.z ?? 0).toBeLessThan(hull?.z ?? 0);
  });
});

describe('the models are whole', () => {
  it.each(ALL)('%s keeps the nodes the scene animates', (file) => {
    const names = new Set(
      (parseGlbJson(boat(file)).nodes ?? [])
        .map((node) => (node as { name?: string }).name)
        .filter(Boolean),
    );

    for (const required of ['Hull', 'LeftOar', 'RightOar', 'LeftGate', 'RightGate']) {
      expect(names, `${file} is missing ${required}`).toContain(required);
    }
  });
});

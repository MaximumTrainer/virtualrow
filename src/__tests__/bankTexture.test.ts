import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BANK_TEXTURE_SIZE, createBankTexture } from '../components/rower3d/bankTexture';

/**
 * Issue #269 asked for ground "visibly distinct from the water in colour and
 * texture". #280 made the banks visible and correctly coloured and left the
 * texture half untouched: a MeshPhysicalMaterial with no map of any kind, over a
 * strip two vertices wide, is a flat wash of one colour.
 *
 * It showed up in a measurement rather than an opinion. The published hero is
 * checked by heroScreenshot.test.ts for horizontal structure — the same
 * `describeImageContent` machinery the issue pointed at — and a correctly
 * rendered river scored 0.795 against a floor of 0.8, because two thirds of the
 * frame was an unbroken field of green.
 */

describe('the riverbank has a surface, not just a colour (#292)', () => {
  it('varies, so it reads as ground rather than a wash', () => {
    const texture = createBankTexture();
    const data = (texture.image as { data: Uint8Array }).data;

    const values = Array.from(data).filter((_, i) => i % 4 === 0);
    const lowest = Math.min(...values);
    const highest = Math.max(...values);

    expect(highest - lowest, 'the bank texture is flat').toBeGreaterThan(20);
  });

  it('stays close to white, so it shades the theme colour rather than replacing it', () => {
    // `map` multiplies the material colour. A texture that wanders far from
    // white would repaint every theme's bank rather than giving it a surface.
    const texture = createBankTexture();
    const data = (texture.image as { data: Uint8Array }).data;

    const values = Array.from(data).filter((_, i) => i % 4 === 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    expect(mean).toBeGreaterThan(200);
    expect(Math.min(...values)).toBeGreaterThan(150);
  });

  it('tiles, because one bank is hundreds of metres long', () => {
    const texture = createBankTexture();

    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('is the same every time, so a scene does not shimmer between runs', () => {
    const first = (createBankTexture().image as { data: Uint8Array }).data;
    const second = (createBankTexture().image as { data: Uint8Array }).data;

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('is small enough to be free', () => {
    // It is mottling, not detail. A large one would cost upload and memory for
    // something the rower sees at a glancing angle from a moving boat.
    expect(BANK_TEXTURE_SIZE).toBeLessThanOrEqual(64);
  });
});

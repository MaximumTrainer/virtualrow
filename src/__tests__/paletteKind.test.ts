import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteKind } from '../components/rower3d/paletteKind';

/**
 * Issue #432 — classify a scenery part's flat colour so the material pass
 * knows which facade texture to sample. Fixtures pick a representative
 * colour for each kind rather than probing thresholds: the rules are set
 * for the palette they classify, so a value plainly inside each group is
 * the honest test.
 */

describe('paletteKind (#432)', () => {
  it('sees brick in a warm saturated red', () => {
    expect(paletteKind(new THREE.Color('#a24c2e'))).toBe('brick');
    expect(paletteKind(new THREE.Color('#8a3a20'))).toBe('brick');
  });

  it('sees plaster in a bright near-white', () => {
    expect(paletteKind(new THREE.Color('#f0e8d0'))).toBe('plaster');
    expect(paletteKind(new THREE.Color('#eee6d8'))).toBe('plaster');
  });

  it('sees clapboard in a muted cool timber', () => {
    expect(paletteKind(new THREE.Color('#6b7a70'))).toBe('clapboard');
    expect(paletteKind(new THREE.Color('#4a6870'))).toBe('clapboard');
  });

  it('sees clapboard in a saturated cool colour', () => {
    // A deep blue or green cladding is painted timber, not brick.
    expect(paletteKind(new THREE.Color('#2a4a70'))).toBe('clapboard');
    expect(paletteKind(new THREE.Color('#3a6a4a'))).toBe('clapboard');
  });

  it('reads warm hex in sRGB, not linear', () => {
    // A plain `getHSL` reads a linear-space L for `#f0e8d0` of 0.75 — under
    // the plaster gate — and the classifier would say clapboard on a colour
    // authored to be plaster.
    const color = new THREE.Color('#f0e8d0');
    expect(paletteKind(color)).toBe('plaster');
  });
});

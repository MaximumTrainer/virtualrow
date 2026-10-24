import { describe, expect, it } from 'vitest';
import { tierCapsFor } from '../tierCaps';

/**
 * #570 D9 gates on top of #566's gate matrix: basic skips crew, low+ draws
 * crew, medium+ casts the crew shadow.
 */
describe('tierCaps — crew gates (#570 D9)', () => {
  it('basic draws neither crew nor crew shadow', () => {
    const caps = tierCapsFor('basic');
    expect(caps.drawCrew).toBe(false);
    expect(caps.castCharacterShadows).toBe(false);
  });

  it('low draws crew but does not cast crew shadow', () => {
    const caps = tierCapsFor('low');
    expect(caps.drawCrew).toBe(true);
    expect(caps.castCharacterShadows).toBe(false);
  });

  it('medium / high / extra-high draw crew and cast crew shadow', () => {
    for (const tier of ['medium', 'high', 'extra-high'] as const) {
      const caps = tierCapsFor(tier);
      expect(caps.drawCrew).toBe(true);
      expect(caps.castCharacterShadows).toBe(true);
    }
  });

  it('an unknown tier falls back to medium', () => {
    const caps = tierCapsFor('unknown-tier');
    expect(caps.drawCrew).toBe(true);
    expect(caps.castCharacterShadows).toBe(true);
  });
});

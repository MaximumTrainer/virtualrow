import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeAppearance } from '../services/rowerAppearanceService';
import { genderFromSex } from '../services/authService';

/**
 * D8 on #474: the rower appearance is a user choice, not derived from the
 * intervals.icu profile. The profile only carries `sex`; nothing about
 * clothing, hair, or hat. This guard pins the contract so a future refactor
 * that tried to seed appearance from `AuthUser` would fail the test rather
 * than reintroduce the #443-style gender gate on a slot that isn't gendered.
 */
describe('rower appearance is user-chosen, not profile-derived (D8)', () => {
  it('authService does not export any appearance resolver', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/authService.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/appearance/i);
  });

  it('sanitizeAppearance accepts no gender / sex input', () => {
    // The sanitiser is the only validated entry into stored appearance. If
    // someone ever adds a `gender`/`sex` field to the schema, this assertion
    // fails and whoever added it has to also widen the D8 story.
    const sanitised = sanitizeAppearance({
      sex: 'F',
      gender: 'female',
      top: 'red',
    });
    expect(sanitised).not.toHaveProperty('sex');
    expect(sanitised).not.toHaveProperty('gender');
    expect(sanitised.top).toBe('red');
  });

  it('genderFromSex still only maps M/F to the gender gate, not appearance', () => {
    // Smoke the existing contract so a reader seeing both tests sees why they
    // live beside each other: gender gate from `genderFromSex` is unchanged
    // and completely separate from appearance.
    expect(genderFromSex('F')).toBe('female');
    expect(genderFromSex('M')).toBe('male');
  });
});

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveCrew,
  crewModelUrl,
  effectiveCrewPreference,
  CREW_URL,
} from '../components/rower3d/crewModel';
import { genderFromSex } from '../services/authService';

/** Map a public URL ("/assets/…") to its file on disk under public/. */
const publicPath = (url: string) => resolve(process.cwd(), 'public', url.replace(/^\//, ''));

describe('genderFromSex (intervals.icu profile → gender)', () => {
  it('maps the API sex field to a gender', () => {
    expect(genderFromSex('M')).toBe('male');
    expect(genderFromSex('F')).toBe('female');
    expect(genderFromSex('m')).toBe('male');
    expect(genderFromSex('f')).toBe('female');
    expect(genderFromSex('male')).toBe('male');
    expect(genderFromSex('female')).toBe('female');
  });

  it('is undefined for missing or unrecognised values', () => {
    expect(genderFromSex(undefined)).toBeUndefined();
    expect(genderFromSex(null)).toBeUndefined();
    expect(genderFromSex('')).toBeUndefined();
    expect(genderFromSex('X')).toBeUndefined();
  });
});

describe('resolveCrew', () => {
  it('selects the crew from gender, defaulting to male', () => {
    expect(resolveCrew('female')).toBe('female');
    expect(resolveCrew('male')).toBe('male');
    expect(resolveCrew(undefined)).toBe('male');
    expect(resolveCrew(null)).toBe('male');
  });
});

describe('effectiveCrewPreference (issue #443)', () => {
  it('ignores the stored preference when the athlete has a known intervals.icu sex', () => {
    // FR2: a signed-in female athlete with `virtualrow:crew=male` still rows
    // as the female model, because the profile is now the source of truth.
    expect(effectiveCrewPreference('female', 'male')).toBe('auto');
    expect(effectiveCrewPreference('male', 'female')).toBe('auto');
    expect(effectiveCrewPreference('female', 'auto')).toBe('auto');
  });

  it('keeps the stored preference for a signed-in athlete with no sex on record', () => {
    // FR3 / D1(a): the picker still shows, and its stored choice still applies.
    expect(effectiveCrewPreference(undefined, 'male')).toBe('male');
    expect(effectiveCrewPreference(undefined, 'female')).toBe('female');
    expect(effectiveCrewPreference(undefined, 'auto')).toBe('auto');
  });

  it('keeps the stored preference for a guest (no user, no gender)', () => {
    // FR4: guests keep their control as it was before #443.
    expect(effectiveCrewPreference(null, 'male')).toBe('male');
    expect(effectiveCrewPreference(null, 'female')).toBe('female');
  });
});

describe('crewModelUrl', () => {
  it('points a female athlete at the female scull and a male at the male scull', () => {
    expect(crewModelUrl('female')).toBe('/assets/boat/scull-female.glb');
    expect(crewModelUrl('male')).toBe('/assets/boat/scull-male.glb');
  });

  it('defaults to the male scull when gender is unknown', () => {
    expect(crewModelUrl(undefined)).toBe('/assets/boat/scull-male.glb');
  });
});

describe('gender → model pipeline (the model that actually runs)', () => {
  it('a female profile resolves to the female GLB, a male to the male GLB', () => {
    expect(crewModelUrl(genderFromSex('F'))).toBe(CREW_URL.female);
    expect(crewModelUrl(genderFromSex('M'))).toBe(CREW_URL.male);
  });

  it('an unset profile falls back to the male GLB', () => {
    expect(crewModelUrl(genderFromSex(undefined))).toBe(CREW_URL.male);
  });

  it('every selectable crew model exists on disk', () => {
    for (const url of Object.values(CREW_URL)) {
      expect(existsSync(publicPath(url)), `${url} should exist`).toBe(true);
    }
  });
});

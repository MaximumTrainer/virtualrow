import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import {
  clearHandoffParams,
  consumeHandoffState,
  isValidCourseId,
  parseCourseSelector,
  readHandoffParams,
  startHandoff,
} from '../utils/rownativeHandoff';

describe('startHandoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('targets rownative.icu and carries a return URL and state', () => {
    const url = new URL(startHandoff());
    expect(url.hostname).toBe('rownative.icu');
    expect(url.searchParams.get('virtualrowReturn')).toBeTruthy();
    expect(url.searchParams.get('virtualrowState')).toBeTruthy();
  });

  it('issues a different state each time', () => {
    const a = new URL(startHandoff()).searchParams.get('virtualrowState');
    const b = new URL(startHandoff()).searchParams.get('virtualrowState');
    expect(a).not.toBe(b);
  });

  it('persists the issued state for the return leg', () => {
    const state = new URL(startHandoff()).searchParams.get('virtualrowState');
    expect(consumeHandoffState(state)).toBe(true);
  });
});

describe('consumeHandoffState', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => { vi.useRealTimers(); });

  it('rejects a state that was never issued', () => {
    startHandoff();
    expect(consumeHandoffState('not-the-issued-state')).toBe(false);
  });

  it('rejects a missing state', () => {
    startHandoff();
    expect(consumeHandoffState(null)).toBe(false);
    expect(consumeHandoffState('')).toBe(false);
  });

  it('rejects when nothing was ever issued', () => {
    expect(consumeHandoffState('anything')).toBe(false);
  });

  it('is single-use — a replayed link fails the second time', () => {
    const state = new URL(startHandoff()).searchParams.get('virtualrowState');
    expect(consumeHandoffState(state)).toBe(true);
    expect(consumeHandoffState(state)).toBe(false);
  });

  it('rejects a state older than 15 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = new URL(startHandoff()).searchParams.get('virtualrowState');
    vi.setSystemTime(new Date('2026-01-01T00:15:01Z'));
    expect(consumeHandoffState(state)).toBe(false);
  });

  it('accepts a state just inside the 15 minute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = new URL(startHandoff()).searchParams.get('virtualrowState');
    vi.setSystemTime(new Date('2026-01-01T00:14:59Z'));
    expect(consumeHandoffState(state)).toBe(true);
  });
});

describe('readHandoffParams', () => {
  it('returns null when this is not a handoff return', () => {
    expect(readHandoffParams('')).toBeNull();
    expect(readHandoffParams('?code=abc&state=xyz')).toBeNull();
  });

  it('reads the course id and state', () => {
    expect(readHandoffParams('?rownativeCourseId=106&rownativeState=nonce')).toEqual({
      courseId: '106',
      state: 'nonce',
    });
  });

  it('uses a prefixed state param so it cannot collide with the OAuth callback', () => {
    // AuthContext reads `code` + `state`; ours must survive alongside them.
    const params = readHandoffParams('?code=abc&state=oauth&rownativeCourseId=7&rownativeState=ours');
    expect(params).toEqual({ courseId: '7', state: 'ours' });
  });
});

describe('isValidCourseId', () => {
  it('accepts ids rownative actually issues', () => {
    expect(isValidCourseId('1')).toBe(true);
    expect(isValidCourseId('106')).toBe(true);
    expect(isValidCourseId('some_course-2')).toBe(true);
  });

  it('rejects anything that is not a bare identifier', () => {
    expect(isValidCourseId('')).toBe(false);
    expect(isValidCourseId('../../etc/passwd')).toBe(false);
    expect(isValidCourseId('https://evil.example/x')).toBe(false);
    expect(isValidCourseId('1 OR 1=1')).toBe(false);
    expect(isValidCourseId('a'.repeat(129))).toBe(false);
  });
});

describe('parseCourseSelector', () => {
  it('accepts a bare id', () => {
    expect(parseCourseSelector('106')).toBe('106');
    expect(parseCourseSelector('  106  ')).toBe('106');
  });

  it('accepts a full https rownative.icu URL', () => {
    expect(parseCourseSelector('https://rownative.icu/?course=106')).toBe('106');
    expect(parseCourseSelector('https://www.rownative.icu/?id=42')).toBe('42');
  });

  it('normalises a scheme-less rownative.icu URL rather than rejecting it', () => {
    // This is the LA-3 defect the old selector tripped on.
    expect(parseCourseSelector('rownative.icu/course/5')).toBe('5');
    expect(parseCourseSelector('www.rownative.icu/course/5')).toBe('5');
  });

  it('reads an id from a trailing path segment or fragment', () => {
    expect(parseCourseSelector('https://rownative.icu/courses/106')).toBe('106');
    expect(parseCourseSelector('https://rownative.icu/#106')).toBe('106');
  });

  it('rejects other hosts rather than guessing', () => {
    expect(parseCourseSelector('https://evil.example/?course=106')).toBeNull();
    expect(parseCourseSelector('https://rownative.icu.evil.example/?course=1')).toBeNull();
  });

  it('rejects empty and unparseable input', () => {
    expect(parseCourseSelector('')).toBeNull();
    expect(parseCourseSelector('   ')).toBeNull();
    expect(parseCourseSelector('not a course')).toBeNull();
  });
});

describe('clearHandoffParams', () => {
  it('removes only the handoff params, leaving others intact', () => {
    window.history.replaceState({}, '', '/?keep=1&rownativeCourseId=9&rownativeState=n');
    clearHandoffParams();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('rownativeCourseId')).toBeNull();
    expect(params.get('rownativeState')).toBeNull();
    expect(params.get('keep')).toBe('1');
    window.history.replaceState({}, '', '/');
  });
});

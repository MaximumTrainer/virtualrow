import { describe, expect, it } from 'vitest';
import { RownativeService } from '../services/rownativeService';

const service = new RownativeService();
const resolve = (input: string) => service.resolveCourseId(input);

describe('resolveCourseId — bare ids', () => {
  it('accepts ids the mirror actually issues', () => {
    expect(resolve('5')).toBe('5');
    expect(resolve('106')).toBe('106');
    expect(resolve('some_course-2')).toBe('some_course-2');
  });

  it('trims surrounding whitespace', () => {
    expect(resolve('  5  ')).toBe('5');
  });

  it('accepts an id at the 128-character boundary and rejects 129', () => {
    const at = 'a'.repeat(128);
    expect(resolve(at)).toBe(at);
    expect(() => resolve('a'.repeat(129))).toThrow(/course ID or a rownative\.icu course link/i);
  });
});

describe('resolveCourseId — URLs', () => {
  it('extracts an id from a /course/<id> path', () => {
    expect(resolve('https://rownative.icu/course/5')).toBe('5');
  });

  it('extracts an id from a /courses/<id>/ path with a trailing slash', () => {
    expect(resolve('https://rownative.icu/courses/5/')).toBe('5');
  });

  it('accepts route and routes path keywords too', () => {
    expect(resolve('https://rownative.icu/route/12')).toBe('12');
    expect(resolve('https://rownative.icu/routes/12')).toBe('12');
  });

  it('extracts an id from known query parameters', () => {
    expect(resolve('https://rownative.icu/?id=5')).toBe('5');
    expect(resolve('https://rownative.icu/?courseId=5')).toBe('5');
    expect(resolve('https://rownative.icu/?rownativeCourseId=5')).toBe('5');
  });

  it('handles hash-router links', () => {
    expect(resolve('https://rownative.icu/#/course/5')).toBe('5');
    expect(resolve('https://rownative.icu/#/courses/5?tab=map')).toBe('5');
    expect(resolve('https://rownative.icu/#/?courseId=5')).toBe('5');
  });

  it('accepts the www host', () => {
    expect(resolve('https://www.rownative.icu/course/5')).toBe('5');
  });

  it('prefers the path id when both a path and a query id are present', () => {
    expect(resolve('https://rownative.icu/course/5?id=9')).toBe('5');
  });
});

describe('resolveCourseId — rejections', () => {
  it('rejects empty input', () => {
    expect(() => resolve('')).toThrow(/course ID or a rownative\.icu course link/i);
    expect(() => resolve('   ')).toThrow(/course ID or a rownative\.icu course link/i);
  });

  it('rejects http:// links', () => {
    expect(() => resolve('http://rownative.icu/course/5')).toThrow(/https:\/\/ links on rownative\.icu/i);
  });

  it('rejects foreign hosts', () => {
    expect(() => resolve('https://evil.example/course/5')).toThrow(/https:\/\/ links on rownative\.icu/i);
    expect(() => resolve('https://rownative.icu.evil.example/course/5')).toThrow(/https:\/\/ links on rownative\.icu/i);
  });

  it('rejects a rownative link with no id in it', () => {
    expect(() => resolve('https://rownative.icu/about.html')).toThrow(/Could not find a course ID/i);
    expect(() => resolve('https://rownative.icu/')).toThrow(/Could not find a course ID/i);
  });

  it('rejects path traversal and other non-id junk', () => {
    expect(() => resolve('../../etc/passwd')).toThrow();
    expect(() => resolve('not a course')).toThrow();
    expect(() => resolve('5 OR 1=1')).toThrow();
  });

  it('never treats a URL as a bare id', () => {
    // The id pattern excludes '.', '/' and ':', so a URL can't slip through.
    expect(() => resolve('https://evil.example')).toThrow();
  });
});

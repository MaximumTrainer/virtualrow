import '@testing-library/jest-dom';

// Polyfill minimal ResizeObserver & IntersectionObserver for tests
class MockResizeObserver implements ResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(_cb: IntersectionObserverCallback) {}
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}
(globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;

// Some jsdom builds expose `localStorage` as a bare object with no Storage
// methods, so anything that persists state throws on first use. Swap in a
// minimal in-memory Storage when that happens; a real one is left alone.
if (typeof globalThis.localStorage?.setItem !== 'function') {
  const entries = new Map<string, string>();
  // Methods go on Storage.prototype, not the instance, so tests that spy on
  // Storage.prototype.setItem to simulate a full quota still work.
  const prototype: Storage = typeof globalThis.Storage === 'function'
    ? globalThis.Storage.prototype
    : ({} as Storage);

  Object.assign(prototype, {
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, String(value)); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
  });
  Object.defineProperty(prototype, 'length', { get: () => entries.size, configurable: true });

  const storage = Object.create(prototype) as Storage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
  }
}

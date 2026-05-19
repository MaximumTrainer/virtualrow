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

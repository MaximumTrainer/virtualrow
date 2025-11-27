import '@testing-library/jest-dom';

// Polyfill minimal ResizeObserver & IntersectionObserver for tests
class MockResizeObserver {
  callback: any;
  constructor(cb: any) { this.callback = cb; }
  observe() {}
  disconnect() {}
}
class MockIntersectionObserver {
  callback: any;
  constructor(cb: any) { this.callback = cb; }
  observe() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

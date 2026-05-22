import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as fiber from '@react-three/fiber';

// Capture the useFrame callback so we can fire frames manually in tests.
let capturedFrameCallback: ((state: { clock: { elapsedTime: number } }) => void) | null = null;

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn((cb: (state: { clock: { elapsedTime: number } }) => void) => {
    capturedFrameCallback = cb;
  }),
}));

import { AnimationProvider, useAnimationFrame } from '../components/rower3d/AnimationContext';

// Helper: simulate one animation frame at the given elapsed time.
function fireFrame(elapsedTime: number) {
  if (capturedFrameCallback) {
    capturedFrameCallback({ clock: { elapsedTime } });
  }
}

// Test consumer component: records every time value it receives.
function Consumer({ onFrame }: { onFrame: (t: number) => void }) {
  useAnimationFrame((time) => onFrame(time));
  return null;
}

describe('AnimationProvider', () => {
  beforeEach(() => {
    capturedFrameCallback = null;
  });

  it('registers a useFrame callback when mounted', () => {
    render(
      <AnimationProvider>
        <div />
      </AnimationProvider>,
    );
    expect(vi.mocked(fiber.useFrame)).toHaveBeenCalled();
  });

  it('fans the frame time out to a subscribed child', () => {
    const received: number[] = [];
    render(
      <AnimationProvider>
        <Consumer onFrame={(t) => received.push(t)} />
      </AnimationProvider>,
    );

    act(() => fireFrame(1.0));
    act(() => fireFrame(2.5));

    expect(received).toEqual([1.0, 2.5]);
  });

  it('fans out to multiple subscribed children', () => {
    const a: number[] = [];
    const b: number[] = [];

    render(
      <AnimationProvider>
        <Consumer onFrame={(t) => a.push(t)} />
        <Consumer onFrame={(t) => b.push(t)} />
      </AnimationProvider>,
    );

    act(() => fireFrame(3.0));

    expect(a).toEqual([3.0]);
    expect(b).toEqual([3.0]);
  });
});

describe('useAnimationFrame', () => {
  beforeEach(() => {
    capturedFrameCallback = null;
  });

  it('invokes callback with the elapsed time on each frame', () => {
    const times: number[] = [];
    render(
      <AnimationProvider>
        <Consumer onFrame={(t) => times.push(t)} />
      </AnimationProvider>,
    );

    act(() => fireFrame(0.016));
    act(() => fireFrame(0.032));
    act(() => fireFrame(0.048));

    expect(times).toEqual([0.016, 0.032, 0.048]);
  });

  it('unsubscribes on unmount — no callbacks after unmount', () => {
    const times: number[] = [];
    const { unmount } = render(
      <AnimationProvider>
        <Consumer onFrame={(t) => times.push(t)} />
      </AnimationProvider>,
    );

    act(() => fireFrame(1.0));
    expect(times).toHaveLength(1);

    unmount();

    act(() => fireFrame(2.0));
    // After unmount, the callback should no longer fire.
    expect(times).toHaveLength(1);
  });

  it('always calls the latest closure without re-subscribing', () => {
    // The stable-ref pattern means the callback can update without triggering
    // a subscribe/unsubscribe cycle.
    const log: string[] = [];
    let label = 'A';

    function DynamicConsumer() {
      useAnimationFrame(() => log.push(label));
      return null;
    }

    const { rerender } = render(
      <AnimationProvider>
        <DynamicConsumer />
      </AnimationProvider>,
    );

    act(() => fireFrame(1));
    label = 'B';
    rerender(
      <AnimationProvider>
        <DynamicConsumer />
      </AnimationProvider>,
    );
    act(() => fireFrame(2));

    // Both frames recorded; second used the updated label.
    expect(log).toEqual(['A', 'B']);
  });
});

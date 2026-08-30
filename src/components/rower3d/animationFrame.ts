// ============================================================================
// AnimationContext — the shared-tick context and the hook that subscribes to
// it. Split out of AnimationContext.tsx so that file exports only components
// and keeps working fast refresh.
// ============================================================================

import { createContext, useContext, useEffect, useRef } from 'react';

export type FrameCallback = (time: number) => void;

export interface AnimationContextValue {
  /** Subscribe to the shared tick. Returns an unsubscribe function. */
  subscribe: (callback: FrameCallback) => () => void;
}

export const AnimationContext = createContext<AnimationContextValue>({
  subscribe: () => () => undefined,
});

// ============================================================================
// Hook — subscribe to the shared tick from any child component.
// Keeps a stable ref so the callback can close over changing props/state
// without being re-subscribed every render.
// ============================================================================
export const useAnimationFrame = (callback: FrameCallback): void => {
  const ctx = useContext(AnimationContext);
  const callbackRef = useRef<FrameCallback>(callback);

  // Refreshed in an effect rather than during render: writing to a ref while
  // rendering is not safe under concurrent React, which may abandon a render
  // pass after the write. The subscription below reads `.current` at frame
  // time, so an effect-timed update is soon enough.
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    return ctx.subscribe((time) => callbackRef.current(time));
  }, [ctx]);
};

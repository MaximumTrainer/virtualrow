// ============================================================================
// AnimationContext — single shared useFrame tick for all scenery components.
//
// Instead of each scenery component (MistLayer, clouds, water surfaces) calling
// useFrame independently, they subscribe through useAnimationFrame. This reduces
// R3F internal callback list churn when many scenery components mount/unmount
// and avoids redundant clock reads per component per frame.
//
// Usage:
//   Wrap scenery subtree in <AnimationProvider>.
//   Inside any child component call:
//     useAnimationFrame((time) => { ... });
// ============================================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { useFrame } from '@react-three/fiber';

type FrameCallback = (time: number) => void;

interface AnimationContextValue {
  /** Subscribe to the shared tick. Returns an unsubscribe function. */
  subscribe: (callback: FrameCallback) => () => void;
}

const AnimationContext = createContext<AnimationContextValue>({
  subscribe: () => () => undefined,
});

// ============================================================================
// Provider — owns the single useFrame and fans out to all subscribers
// ============================================================================
export const AnimationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const callbacksRef = useRef<Set<FrameCallback>>(new Set());

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    for (const cb of callbacksRef.current) cb(time);
  });

  const subscribe = useCallback((callback: FrameCallback) => {
    callbacksRef.current.add(callback);
    return () => { callbacksRef.current.delete(callback); };
  }, []);

  return (
    <AnimationContext.Provider value={{ subscribe }}>
      {children}
    </AnimationContext.Provider>
  );
};

// ============================================================================
// Hook — subscribe to the shared tick from any child component.
// Keeps a stable ref so the callback can close over changing props/state
// without being re-subscribed every render.
// ============================================================================
export const useAnimationFrame = (callback: FrameCallback): void => {
  const ctx = useContext(AnimationContext);
  const callbackRef = useRef<FrameCallback>(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return ctx.subscribe((time) => callbackRef.current(time));
  }, [ctx]);
};

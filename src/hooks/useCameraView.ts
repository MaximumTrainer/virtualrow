import { useCallback, useEffect, useState } from 'react';
import {
  isCameraView,
  nextView,
  type CameraView,
} from '../components/rower3d/cameraRig';
import { isShortcutKey } from '../utils/keyboardShortcut';

/**
 * Which camera the rower is looking through, and remembering it (#328).
 *
 * The key and the storage live together because they are one decision: a view
 * that cycles but is forgotten on reload is worse than no cycling at all, and
 * the cycle is the only way to reach the other views.
 */

export const CAMERA_VIEW_STORAGE_KEY = 'virtualrow:camera-view';

/** The key that cycles the view. Lower-cased, so shift does not matter. */
export const CAMERA_VIEW_KEY = 'v';

const readStored = (): CameraView => {
  try {
    const stored = localStorage.getItem(CAMERA_VIEW_STORAGE_KEY);
    return isCameraView(stored) ? stored : 'chase';
  } catch {
    // Private windows and blocked site data both throw here rather than
    // returning null, and a camera is not worth failing a row over.
    return 'chase';
  }
};

export interface CameraViewControl {
  view: CameraView;
  /** Move to the next view and remember it. */
  cycle: () => void;
}

export const useCameraView = (): CameraViewControl => {
  const [view, setView] = useState<CameraView>(readStored);

  const cycle = useCallback(() => {
    setView((current) => {
      const next = nextView(current);
      try {
        localStorage.setItem(CAMERA_VIEW_STORAGE_KEY, next);
      } catch {
        // Remembering is a convenience; not remembering is not a failure.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutKey(event, CAMERA_VIEW_KEY)) cycle();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycle]);

  return { view, cycle };
};

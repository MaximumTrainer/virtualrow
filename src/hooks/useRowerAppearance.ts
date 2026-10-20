import { useCallback, useMemo, useState } from 'react';
import {
  createLocalStorageRowerAppearanceService,
  DEFAULT_ROWER_APPEARANCE,
  type RowerAppearancePreference,
  type RowerAppearanceService,
} from '../lib/services/rowerAppearanceService';

export interface RowerAppearanceControl {
  appearance: RowerAppearancePreference;
  setSlot: <K extends keyof RowerAppearancePreference>(
    slot: K,
    value: RowerAppearancePreference[K],
  ) => void;
  reset: () => void;
}

export const useRowerAppearance = (
  service: RowerAppearanceService = createLocalStorageRowerAppearanceService(),
): RowerAppearanceControl => {
  const [appearance, setAppearance] = useState<RowerAppearancePreference>(() => service.read());

  const setSlot = useCallback<RowerAppearanceControl['setSlot']>(
    (slot, value) => {
      setAppearance((current) => {
        const next = { ...current, [slot]: value };
        service.write(next);
        return next;
      });
    },
    [service],
  );

  const reset = useCallback(() => {
    setAppearance(() => {
      service.write(DEFAULT_ROWER_APPEARANCE);
      return { ...DEFAULT_ROWER_APPEARANCE };
    });
  }, [service]);

  return useMemo(
    () => ({ appearance, setSlot, reset }),
    [appearance, setSlot, reset],
  );
};

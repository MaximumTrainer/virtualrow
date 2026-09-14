import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preloadCrew } from '../components/rower3d/crewPreload';
import { CREW_URL } from '../components/rower3d/crewModel';

const preload = vi.hoisted(() => vi.fn());

vi.mock('@react-three/drei', () => ({ useGLTF: { preload } }));

describe('preloadCrew', () => {
  beforeEach(() => preload.mockClear());

  it('warms only the crew that is in the boat', () => {
    preloadCrew('female');

    expect(preload).toHaveBeenCalledOnce();
    expect(preload).toHaveBeenCalledWith(CREW_URL.female);
  });

  it('never fetches the crew that is not', () => {
    preloadCrew('male');

    expect(preload).not.toHaveBeenCalledWith(CREW_URL.female);
  });
});

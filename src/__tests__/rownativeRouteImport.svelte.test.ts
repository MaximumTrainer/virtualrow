import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import RownativeImportHarness from './fixtures/RownativeImportHarness.svelte';
import type { Services } from '../lib/ports';
import type { WaterRoute } from '../lib/types/index';

const ROUTE: WaterRoute = {
  id: 'rownative-42',
  name: 'Lake Casitas',
  location: 'Ojai, CA',
  distance: 2000,
  estimatedTime: 8,
  difficulty: 'moderate',
  coordinates: [
    { lat: 34.3, lng: -119.3 },
    { lat: 34.31, lng: -119.31 },
  ],
  source: 'rownative',
} as unknown as WaterRoute;

/** A services bundle stubbing only the ports this component touches. */
function stubServices(): Partial<Services> {
  return {
    rownativeService: {
      resolveCourseId: vi.fn((raw: string) => raw.trim()),
      importCourseById: vi.fn(async () => ROUTE),
      searchCourses: vi.fn(async () => []),
      getCourseIndex: vi.fn(async () => []),
      importCourse: vi.fn(async () => ROUTE),
      fetchCourseGeometry: vi.fn(async () => []),
      attachTrack: vi.fn(),
      detachTrack: vi.fn(),
      attachedTrack: vi.fn(() => null),
    } as unknown as Services['rownativeService'],
    routeService: {
      findRouteByRownativeId: vi.fn(() => undefined),
    } as unknown as Services['routeService'],
  };
}

// #542 P1: RownativeRouteImport ported to Svelte, same DOM the specs use.
describe('RownativeRouteImport.svelte', () => {
  it('renders the course-import input', () => {
    const { container } = render(RownativeImportHarness, {
      overrides: stubServices(),
      onRouteImported: vi.fn(),
    });

    expect(container.querySelector('.rownative-import')).not.toBeNull();
    expect(
      screen.getByLabelText('Rownative course ID or link'),
    ).toBeTruthy();
  });

  it('imports a pasted course id and calls onRouteImported', async () => {
    const overrides = stubServices();
    const onRouteImported = vi.fn();
    const { container } = render(RownativeImportHarness, { overrides, onRouteImported });

    const input = screen.getByLabelText('Rownative course ID or link');
    await fireEvent.input(input, { target: { value: 'rownative-42' } });

    await fireEvent.click(container.querySelector('.rownative-controls .filter-btn--active')!);

    await waitFor(() => expect(onRouteImported).toHaveBeenCalledTimes(1));
    expect(onRouteImported).toHaveBeenCalledWith(ROUTE);
    expect(overrides.rownativeService!.importCourseById).toHaveBeenCalledWith('rownative-42');
  });
});

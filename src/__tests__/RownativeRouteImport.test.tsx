import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RownativeRouteImport } from '../components/RownativeRouteImport';
import { ServicesProvider, defaultServices } from '../context/ServicesContext';
import type { Services } from '../ports';

describe('RownativeRouteImport', () => {
  it('hides the empty state when course loading fails', async () => {
    const user = userEvent.setup();
    const searchCourses = vi.fn().mockRejectedValue(new Error('boom'));
    const rownativeService = {
      ...defaultServices.rownativeService,
      searchCourses,
    } as unknown as Services['rownativeService'];

    render(
      <ServicesProvider services={{ rownativeService }}>
        <RownativeRouteImport onRouteImported={vi.fn()} />
      </ServicesProvider>
    );

    await user.click(screen.getByRole('button', { name: /search rownative\.icu/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load courses from rownative.icu right now.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching courses.')).not.toBeInTheDocument();
    expect(searchCourses).toHaveBeenCalledWith('');
  });
});

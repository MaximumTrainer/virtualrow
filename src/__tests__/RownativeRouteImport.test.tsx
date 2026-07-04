import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesProvider, defaultServices } from '../context/ServicesContext';
import { RownativeRouteImport } from '../components/RownativeRouteImport';
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';

function createImportedRoute(name = 'Imported Route'): WaterRoute {
  return {
    id: 'new-route',
    name,
    description: 'desc',
    distance: 4.2,
    difficulty: 'moderate',
    location: 'Amsterdam',
    coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }],
    elevationGain: 0,
    estimatedTime: 72,
    tags: ['rownative'],
    createdAt: new Date(),
    source: 'imported',
  };
}

describe('RownativeRouteImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithServices(overrides?: Partial<Services>) {
    const onRouteImported = vi.fn();
    const onOpenKmlImport = vi.fn();
    render(
      <ServicesProvider services={{ ...defaultServices, ...overrides }}>
        <RownativeRouteImport onRouteImported={onRouteImported} onOpenKmlImport={onOpenKmlImport} />
      </ServicesProvider>,
    );
    return { onRouteImported, onOpenKmlImport };
  }

  it('replaces in-app rownative search input with open/link actions', async () => {
    const user = userEvent.setup();
    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: { ...defaultServices.rownativeService, getLinkedAccount: () => null } as unknown as Services['rownativeService'],
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    expect(screen.queryByPlaceholderText(/search course name/i)).toBeNull();
    expect(screen.getByRole('link', { name: /open rownative\.icu/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link rownative account/i })).toBeTruthy();
  });

  it('handles link state transitions from not linked to linked', async () => {
    const user = userEvent.setup();
    const startLinkFlow = vi.fn().mockResolvedValue({ linkUrl: 'https://rownative.icu/link', requestId: 'req-1' });
    const completeLinkFlow = vi.fn().mockResolvedValue({
      virtualRowUserId: 'vr-1',
      rownativeUserId: 'rn-1',
      rownativeDisplayName: 'Rownative User',
      linkedAt: Date.now(),
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => ({ closed: false } as Window));

    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => null,
        startLinkFlow,
        completeLinkFlow,
      } as unknown as Services['rownativeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /link rownative account/i }));
    expect(startLinkFlow).toHaveBeenCalledWith('vr-1');
    expect(openSpy).toHaveBeenCalledWith('https://rownative.icu/link', '_blank', 'noopener,noreferrer');
    expect(screen.getByText('Linking')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /complete linking/i }));
    expect(completeLinkFlow).toHaveBeenCalledWith('vr-1', 'req-1');
    expect(screen.getByText('Linked')).toBeTruthy();
    expect(screen.getByText('Rownative User')).toBeTruthy();
  });

  it('pulls KML and imports route through routeService', async () => {
    const user = userEvent.setup();
    const onImportedRoute = createImportedRoute('Pulled Route');
    const pullLinkedRouteKml = vi.fn().mockResolvedValue({
      kml: '<kml><Document><Placemark><LineString><coordinates>1,1,0 2,2,0</coordinates></LineString></Placemark></Document></kml>',
      routeName: 'Pulled Route',
      location: 'Canal',
    });
    const importRouteFromKML = vi.fn().mockReturnValue({ status: 'success', route: onImportedRoute });

    const { onRouteImported } = renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => ({ virtualRowUserId: 'vr-1', rownativeUserId: 'rn-1', linkedAt: Date.now() }),
        pullLinkedRouteKml,
      } as unknown as Services['rownativeService']),
      routeService: ({
        ...defaultServices.routeService,
        importRouteFromKML,
      } as unknown as Services['routeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /pull route kml/i }));

    expect(pullLinkedRouteKml).toHaveBeenCalledWith({ virtualRowUserId: 'vr-1' });
    expect(importRouteFromKML).toHaveBeenCalled();
    expect(onRouteImported).toHaveBeenCalledWith(onImportedRoute);
  });

  it('shows a pull failure message when imported KML is invalid', async () => {
    const user = userEvent.setup();
    const pullLinkedRouteKml = vi.fn().mockResolvedValue({
      kml: '<kml></kml>',
    });
    const importRouteFromKML = vi.fn().mockReturnValue({ status: 'error', error: 'No valid route found in KML.' });

    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => ({ virtualRowUserId: 'vr-1', rownativeUserId: 'rn-1', linkedAt: Date.now() }),
        pullLinkedRouteKml,
      } as unknown as Services['rownativeService']),
      routeService: ({
        ...defaultServices.routeService,
        importRouteFromKML,
      } as unknown as Services['routeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /pull route kml/i }));

    expect(screen.getByRole('alert').textContent).toContain('No valid route found in KML.');
    expect(screen.getByText('Pull failed')).toBeTruthy();
  });

  it('finalizes first KML candidate when multiple candidates are returned', async () => {
    const user = userEvent.setup();
    const pulledRoute = createImportedRoute('Candidate Route');
    const pullLinkedRouteKml = vi.fn().mockResolvedValue({
      kml: '<kml></kml>',
      routeName: 'Candidate Route',
      location: 'Harbor',
    });
    const importRouteFromKML = vi.fn().mockReturnValue({
      status: 'selectionRequired',
      candidates: [{ name: 'Candidate A', description: '', coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }] }],
    });
    const finalizeKMLImport = vi.fn().mockReturnValue(pulledRoute);

    const { onRouteImported } = renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => ({ virtualRowUserId: 'vr-1', rownativeUserId: 'rn-1', linkedAt: Date.now() }),
        pullLinkedRouteKml,
      } as unknown as Services['rownativeService']),
      routeService: ({
        ...defaultServices.routeService,
        importRouteFromKML,
        finalizeKMLImport,
      } as unknown as Services['routeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /pull route kml/i }));

    expect(finalizeKMLImport).toHaveBeenCalledOnce();
    expect(onRouteImported).toHaveBeenCalledWith(pulledRoute);
  });

  it('shows an error when browser blocks the rownative link popup', async () => {
    const user = userEvent.setup();
    const startLinkFlow = vi.fn().mockResolvedValue({ linkUrl: 'https://rownative.icu/link' });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => null,
        startLinkFlow,
      } as unknown as Services['rownativeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /link rownative account/i }));

    expect(screen.getByRole('alert').textContent).toContain('blocked the rownative link window');
    expect(screen.getByText('Link failed')).toBeTruthy();
  });

  it('shows a pull failure when selectionRequired returns no candidates', async () => {
    const user = userEvent.setup();
    const pullLinkedRouteKml = vi.fn().mockResolvedValue({ kml: '<kml></kml>' });
    const importRouteFromKML = vi.fn().mockReturnValue({ status: 'selectionRequired', candidates: [] });

    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => ({ virtualRowUserId: 'vr-1', rownativeUserId: 'rn-1', linkedAt: Date.now() }),
        pullLinkedRouteKml,
      } as unknown as Services['rownativeService']),
      routeService: ({
        ...defaultServices.routeService,
        importRouteFromKML,
      } as unknown as Services['routeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /pull route kml/i }));

    expect(screen.getByRole('alert').textContent).toContain('No selectable routes were found in the pulled KML.');
    expect(screen.getByText('Pull failed')).toBeTruthy();
  });

  it('unlinks an existing linked account and resets status', async () => {
    const user = userEvent.setup();
    const unlinkAccount = vi.fn().mockResolvedValue(undefined);

    renderWithServices({
      authService: { ...defaultServices.authService, getUser: () => ({ id: 'vr-1', name: 'User', email: 'u@test.com' }) } as Services['authService'],
      rownativeService: ({
        ...defaultServices.rownativeService,
        getLinkedAccount: () => ({ virtualRowUserId: 'vr-1', rownativeUserId: 'rn-1', linkedAt: Date.now() }),
        unlinkAccount,
      } as unknown as Services['rownativeService']),
    });

    await user.click(screen.getByRole('button', { name: /open rownative\.icu/i }));
    await user.click(screen.getByRole('button', { name: /unlink rownative account/i }));

    expect(unlinkAccount).toHaveBeenCalledWith('vr-1');
    expect(screen.getByText('Not linked')).toBeTruthy();
  });
});

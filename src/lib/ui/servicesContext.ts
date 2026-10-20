/**
 * Svelte services context (#542 P1, FR2).
 *
 * Replaces the React `ServicesContext` / `useServices()` pair. The root shell
 * calls {@link setServices} once during init with the production
 * {@link defaultServices} bundle (or a partial override); any descendant
 * resolves the bundle with {@link getServices}. Both must be called during a
 * component's initialisation, like all Svelte context access.
 *
 * `getServices` falls back to `defaultServices` when no provider is mounted,
 * so a component rendered in isolation (a test that does not wrap its tree)
 * still resolves the production ports — the same safety net the React
 * `useContext(ServicesContext)` default gave.
 */
import { getContext, setContext } from 'svelte';
import type { Services } from '../ports';
import { defaultServices } from './services';

const SERVICES_KEY = Symbol('virtualrow.services');

/**
 * Install a services bundle for this subtree. Anything omitted from
 * `overrides` is filled from {@link defaultServices}, so a test can stub a
 * single port without constructing the rest. Returns the resolved bundle.
 */
export function setServices(overrides?: Partial<Services>): Services {
  const value: Services = overrides ? { ...defaultServices, ...overrides } : defaultServices;
  setContext(SERVICES_KEY, value);
  return value;
}

/** Resolve the {@link Services} bundle from the nearest {@link setServices}. */
export function getServices(): Services {
  return getContext<Services | undefined>(SERVICES_KEY) ?? defaultServices;
}

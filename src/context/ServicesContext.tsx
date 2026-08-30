/**
 * React composition root for application services.
 *
 * Following the architecture rules in `agents.md`, components should depend on
 * the {@link Services} *port* interface rather than directly importing the
 * concrete `*Service` singletons. The `ServicesProvider` below is mounted
 * once (in `main.tsx`) with the production adapters, and tests/stories can
 * mount a different provider with stub adapters to inject behaviour.
 *
 * The context object, the default bundle and `useServices` live in
 * `useServices.ts`.
 */
import { type ReactNode } from 'react';
import type { Services } from '../ports';
import { ServicesContext, defaultServices } from './useServices';

export interface ServicesProviderProps {
  /**
   * Optional override bundle. Anything you omit is filled from
   * `defaultServices`, so tests can stub a single port without having to
   * construct the others.
   */
  services?: Partial<Services>;
  children: ReactNode;
}

/**
 * Mount once at the root of the React tree (see `main.tsx`). All descendants
 * can then resolve services via `useServices`.
 */
export function ServicesProvider({ services, children }: ServicesProviderProps) {
  const value: Services = services
    ? { ...defaultServices, ...services }
    : defaultServices;
  return (
    <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
  );
}

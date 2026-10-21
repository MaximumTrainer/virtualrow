/**
 * The route catalogue store (#542 P1, Routes screen).
 *
 * A Svelte-runes port of the route-catalogue state App.tsx held at the top of
 * the component: the loaded routes, the difficulty filter and its derived
 * `filteredRoutes` / `dimmedRouteIds`, the athlete's default route (via
 * `defaultRoutePreferenceStore`), the selected route and its enrichment, the
 * map detail overlay, the drawer open/closed state, and the file-import panel.
 *
 * It is cross-screen state — the Routes screen selects a route and the Row
 * screen rows it — so it is provided once in the app shell (`+layout.svelte`)
 * and read from both routes via {@link routesContext}. Services are injected
 * (defaulting to the production bundle) so a test can supply stubs, mirroring
 * `AuthStore`.
 *
 * Enrichment is not a reactive effect here: App.tsx ran it from a
 * `useEffect([selectedRoute])`, and the store reproduces that by enriching from
 * the one place the selection is assigned (`#select`), which keeps the loading
 * map in step without an `$effect.root`.
 */
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';
import { OUTLINE_ONLY_TAG } from '../services/routeService';
import { TrackParseError, detectTrackFormat } from '../utils/trackParsers';
import { defaultServices } from './services';

/** The bundled demo route, selected when nothing else resolves (App.tsx). */
const DEMO_ROUTE_ID = '1';

type DifficultyFilter = 'all' | 'easy' | 'moderate' | 'hard';

/** Provenance of a route's geometry, for the badge (ported from App.tsx). */
export function routeGeometrySource(route: WaterRoute): WaterRoute['geometrySource'] {
  if (route.geometrySource) return route.geometrySource;
  return route.tags?.includes(OUTLINE_ONLY_TAG) ? 'gate-chain' : undefined;
}

/** The rownative sync status encoded in a route's tags, if any (App.tsx). */
export function extractRouteStatus(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith('status:'))?.replace('status:', '');
}

export class RoutesStore {
  #routeService: Services['routeService'];
  #enrichment: Services['routeEnrichmentService'];
  #defaultPref: Services['defaultRoutePreferenceStore'];

  /** Set once the opening route has been chosen, so an import or a later load
   *  does not snap the selection back (App.tsx `hasPreselectedRef`). */
  #hasPreselected = false;

  routes = $state<WaterRoute[]>([]);
  selectedRoute = $state<WaterRoute | null>(null);
  difficultyFilter = $state<DifficultyFilter>('all');
  defaultRouteId = $state<string | null>(null);
  routeDetailOpen = $state<WaterRoute | null>(null);
  routeEnrichments = $state<Record<string, RouteEnrichmentData>>({});
  routeEnrichmentLoading = $state<Record<string, boolean>>({});

  // Import panel.
  isImportOpen = $state(false);
  importRouteName = $state('');
  importError = $state<string | null>(null);

  // The Routes screen is map-primary and the catalogue slides in from the side
  // (#505 D6-c): open by default on ≥900px, closed on narrower screens.
  routesDrawerOpen = $state<boolean>(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 900px)').matches,
  );

  constructor(services: Services = defaultServices) {
    this.#routeService = services.routeService;
    this.#enrichment = services.routeEnrichmentService;
    this.#defaultPref = services.defaultRoutePreferenceStore;
  }

  /** Load the catalogue (App.tsx's mount effect: `routeService.getAllRoutes()`). */
  load(): void {
    this.routes = this.#routeService.getAllRoutes();
  }

  readonly filteredRoutes = $derived.by(() => {
    const byDifficulty =
      this.difficultyFilter === 'all'
        ? this.routes
        : this.routes.filter((r) => r.difficulty === this.difficultyFilter);
    // distanceMin/Max were a fixed 0..100 km window in App.tsx; kept so the set
    // matches exactly.
    return byDifficulty.filter((r) => r.distance >= 0 && r.distance <= 100);
  });

  // #505 D7-c: the overview map shows every pin and dims the ones filtered out.
  readonly dimmedRouteIds = $derived.by(() => {
    const kept = new Set(this.filteredRoutes.map((r) => r.id));
    const dimmed = new Set<string>();
    for (const r of this.routes) if (!kept.has(r.id)) dimmed.add(r.id);
    return dimmed;
  });

  /**
   * Resolve the default route and, once, the opening selection
   * (App.tsx's preselect effect, minus the deep-link branch which lands with
   * the Row screen). Idempotent for the selection, live for the star so it
   * follows a later sign-in or sign-out. Call when routes or the user change.
   */
  syncDefaults(userId: string | null, authLoading: boolean): void {
    if (this.routes.length === 0) return;

    const resolved = this.#defaultPref.resolveDefaultRouteId(
      userId,
      this.routes.map((r) => r.id),
    );
    this.defaultRouteId = resolved;

    if (this.#hasPreselected || authLoading) return;
    this.#select(
      (resolved ? this.routes.find((r) => r.id === resolved) : undefined) ??
        this.routes.find((r) => r.id === DEMO_ROUTE_ID) ??
        this.routes[0],
    );
    this.#hasPreselected = true;
  }

  /** Star / un-star a route as this athlete's default (App.tsx AC6.5/AC6.6). */
  toggleDefaultRoute(userId: string | null, routeId: string): void {
    if (!userId) return;
    if (this.defaultRouteId === routeId) {
      this.#defaultPref.clearDefaultRouteId(userId);
      this.defaultRouteId = null;
      return;
    }
    this.#defaultPref.setDefaultRouteId(userId, routeId);
    this.defaultRouteId = routeId;
  }

  /** An explicit choice from the catalogue; outranks the stored default for the
   *  visit. Navigation to the Row screen is the caller's job. */
  selectRoute(route: WaterRoute): void {
    this.#hasPreselected = true;
    this.#select(route);
  }

  /** A freshly imported or deep-linked course (App.tsx `handleRouteImported`). */
  routeImported(route: WaterRoute): void {
    this.routes = this.#routeService.getAllRoutes();
    this.#hasPreselected = true;
    this.#select(route);
  }

  readonly selectedRouteEnrichmentLoading = $derived(
    this.selectedRoute ? !!this.routeEnrichmentLoading[this.selectedRoute.id] : false,
  );

  /** Assign the selection and bring its enrichment in (App.tsx's enrichment
   *  effect, driven from the assignment rather than a reactive effect). */
  #select(route: WaterRoute | null | undefined): void {
    this.selectedRoute = route ?? null;
    if (route) this.#enrich(route);
  }

  #enrich(route: WaterRoute): void {
    const cached = this.#enrichment.readCached(route.id);
    if (cached.data) {
      this.routeEnrichments = { ...this.routeEnrichments, [route.id]: cached.data };
    }
    if (cached.data && !cached.stale) {
      this.routeEnrichmentLoading = { ...this.routeEnrichmentLoading, [route.id]: false };
      return;
    }
    this.routeEnrichmentLoading = { ...this.routeEnrichmentLoading, [route.id]: true };
    void this.#enrichment
      .enrichRoute(route)
      .then((enrichment) => {
        this.routeEnrichments = { ...this.routeEnrichments, [route.id]: enrichment };
      })
      .finally(() => {
        this.routeEnrichmentLoading = { ...this.routeEnrichmentLoading, [route.id]: false };
      });
  }

  /**
   * Import a route file, dispatching on its type (App.tsx `handleRouteFileImport`,
   * issue #194 F7). Returns the imported route on success (null on failure, with
   * `importError` set); the caller selects it and navigates.
   */
  importFile(file: File): Promise<WaterRoute | null> {
    this.importError = null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const fallbackName = this.importRouteName.trim() || file.name.replace(/\.[^.]+$/, '');
        const format = detectTrackFormat(file.name);
        try {
          if (!format) {
            throw new TrackParseError(
              `${file.name} is not a route file VirtualRow can read. Use a .gpx, .kml or .geojson file.`,
            );
          }
          let imported: WaterRoute | undefined;
          if (format === 'gpx') {
            imported = this.#routeService.importRouteFromGPX(text, {
              name: fallbackName,
              difficulty: 'moderate',
              location: 'Imported',
              tags: ['imported', 'gpx'],
            });
          } else if (format === 'kml') {
            const result = this.#routeService.importRouteFromKML(text, {
              name: this.importRouteName.trim() || undefined,
              difficulty: 'moderate',
              tags: ['imported', 'kml'],
            });
            if (result.status === 'error') throw new TrackParseError(result.error);
            if (result.status === 'selectionRequired') {
              imported = this.#routeService.finalizeKMLImport(result.candidates[0], {
                name: this.importRouteName.trim() || undefined,
                difficulty: 'moderate',
                tags: ['imported', 'kml'],
              });
            } else {
              imported = result.route;
            }
          } else {
            const parsed = JSON.parse(text) as {
              properties?: { name?: string; country?: string };
            };
            imported = this.#routeService.importRouteFromGeoJSON(text, {
              name: this.importRouteName.trim() || parsed?.properties?.name || fallbackName,
              difficulty: 'moderate',
              location: parsed?.properties?.country ?? 'Imported',
              tags: ['imported', 'geojson'],
            });
          }
          if (!imported) {
            throw new TrackParseError(`${file.name} has no route line with at least 2 points.`);
          }
          this.routeImported(imported);
          this.isImportOpen = false;
          this.importRouteName = '';
          resolve(imported);
        } catch (error) {
          this.importError =
            error instanceof Error ? error.message : `${file.name} could not be imported.`;
          resolve(null);
        }
      };
      reader.readAsText(file);
    });
  }
}

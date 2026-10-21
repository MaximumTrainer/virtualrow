<!--
  RownativeRouteImport — add a rownative.icu course (#542 P1, Routes screen).
  Port of the React RownativeRouteImport.tsx: same DOM, class names, aria,
  placeholders and copy so the course-import Playwright specs keep passing.
  Reads services from the Svelte services context; the CSS is imported verbatim
  and stays global.
-->
<script lang="ts">
  import { getServices } from './servicesContext';
  import {
    RownativeCourseNotFoundError,
    type RownativeCourseSummary,
  } from '../services/rownativeService';
  import type { WaterRoute } from '../types/index';
  import './RownativeRouteImport.css';

  /** What the file picker offers, and what parseTrackFile can actually read. */
  const TRACK_FILE_TYPES = '.gpx,.kml,.geojson,.json';

  const MAX_RESULTS = 30;

  /**
   * Read a picked file as text.
   *
   * `FileReader` rather than `file.text()`, which is the same choice App.tsx
   * made for the route-import input: it is what every browser this app supports
   * has, and jsdom implements it, so a component test exercises the real path
   * instead of a polyfill.
   */
  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(file);
    });

  interface Props {
    onRouteImported: (route: WaterRoute) => void;
  }

  let { onRouteImported }: Props = $props();

  const { rownativeService, routeService } = getServices();

  let selector = $state('');
  let isImporting = $state(false);
  let error = $state<string | null>(null);
  let notFoundId = $state<string | null>(null);
  let notice = $state<string | null>(null);

  let query = $state('');
  let results = $state<RownativeCourseSummary[] | null>(null);
  let totalCourses = $state(0);
  let isSearching = $state(false);
  let importingId = $state<string | null>(null);

  // A rownative course file describes gates, not a path, so 34 of them render
  // as straight lines until someone who has rowed the course attaches a track.
  // Everything needed for that existed and none of it was reachable (#313).
  let attachBusyId = $state<string | null>(null);
  let attachError = $state<{ courseId: string; message: string } | null>(null);
  /** Course id to attached file name, so the list can show what is on each. */
  let attached = $state<Record<string, string>>({});
  // Not reactive: just a handle per course input so a repeat pick re-fires.
  const fileInputs: Record<string, HTMLInputElement | null> = {};

  /** Capture each per-course file input so its value can be reset after use. */
  function registerInput(node: HTMLInputElement, courseId: string) {
    fileInputs[courseId] = node;
    return {
      destroy() {
        if (fileInputs[courseId] === node) delete fileInputs[courseId];
      },
    };
  }

  /** What the store says right now, preferring anything this session changed. */
  function attachedFileName(courseId: string): string | null {
    if (courseId in attached) return attached[courseId] || null;
    return rownativeService.attachedTrack(courseId)?.fileName ?? null;
  }

  async function handleAttachFile(courseId: string, file: File) {
    attachError = null;
    attachBusyId = courseId;
    try {
      const { track, route } = await rownativeService.attachTrack(
        courseId,
        file.name,
        await readFileAsText(file),
      );
      attached = { ...attached, [courseId]: track.fileName };
      notice = `${track.fileName} attached — ${route.name} now follows your track.`;
      onRouteImported(route);
    } catch (e) {
      // The parser and the gate check both explain themselves, naming the
      // formats read or the gate missed and by how far. Neither is improved by
      // being replaced with "could not attach".
      attachError = {
        courseId,
        message: e instanceof Error ? e.message : 'That file could not be attached.',
      };
    } finally {
      attachBusyId = null;
      // So picking the same file twice in a row still fires a change event.
      const input = fileInputs[courseId];
      if (input) input.value = '';
    }
  }

  async function handleDetach(courseId: string) {
    attachError = null;
    attachBusyId = courseId;
    try {
      const route = await rownativeService.detachTrack(courseId);
      attached = { ...attached, [courseId]: '' };
      notice = `Track removed — ${route.name} is back to its own geometry.`;
      onRouteImported(route);
    } catch (e) {
      attachError = {
        courseId,
        message: e instanceof Error ? e.message : 'That track could not be removed.',
      };
    } finally {
      attachBusyId = null;
    }
  }

  async function importCourseId(courseId: string) {
    const existing = routeService.findRouteByRownativeId(courseId);
    if (existing) {
      notice = `${existing.name} is already in your routes.`;
      onRouteImported(existing);
      return;
    }
    const route = await rownativeService.importCourseById(courseId);
    notice = null;
    onRouteImported(route);
  }

  async function handleImportPasted() {
    error = null;
    notFoundId = null;
    notice = null;

    let courseId: string;
    try {
      courseId = rownativeService.resolveCourseId(selector);
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : 'Enter a rownative course ID or a rownative.icu course link.';
      return;
    }

    isImporting = true;
    try {
      await importCourseId(courseId);
      selector = '';
    } catch (e) {
      if (e instanceof RownativeCourseNotFoundError) {
        notFoundId = e.courseId;
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : `Could not load rownative course ${courseId}.`;
      }
    } finally {
      isImporting = false;
    }
  }

  async function runSearch(term: string) {
    isSearching = true;
    error = null;
    try {
      const [found, all] = await Promise.all([
        rownativeService.searchCourses(term, MAX_RESULTS),
        rownativeService.getCourseIndex(),
      ]);
      results = found;
      totalCourses = all.length;
    } catch (e) {
      results = null;
      error =
        e instanceof Error ? e.message : 'Unable to load rownative course data. Please try again.';
    } finally {
      isSearching = false;
    }
  }

  async function handleImportResult(course: RownativeCourseSummary) {
    error = null;
    notFoundId = null;
    importingId = course.id;
    try {
      await importCourseId(course.id);
    } catch (e) {
      error = e instanceof Error ? e.message : `Could not load ${course.name}.`;
    } finally {
      importingId = null;
    }
  }
</script>

<div class="rownative-import" role="region" aria-label="Rownative course import">
  <div class="rownative-section">
    <div class="rownative-controls">
      <input
        type="text"
        class="import-name-input"
        placeholder="Course ID or rownative.icu link"
        bind:value={selector}
        onkeydown={(e) => {
          if (e.key === 'Enter' && selector.trim()) void handleImportPasted();
        }}
        aria-label="Rownative course ID or link"
      />
      <button
        type="button"
        class="filter-btn filter-btn--active"
        onclick={() => void handleImportPasted()}
        disabled={isImporting || selector.trim().length === 0}
      >
        {isImporting ? 'Importing…' : 'Import'}
      </button>
    </div>
  </div>

  {#if error}
    <p class="import-error" role="alert">
      ⚠ {error}
      {#if notFoundId}
        <button
          type="button"
          class="rownative-search-shortcut"
          onclick={() => {
            error = null;
            notFoundId = null;
            void runSearch('');
          }}
        >
          Search by name
        </button>
      {/if}
    </p>
  {/if}

  {#if notice}
    <p class="rownative-status" role="status">{notice}</p>
  {/if}

  <div class="rownative-section">
    <div class="rownative-controls">
      <input
        type="search"
        class="import-name-input"
        placeholder="Search rownative courses"
        bind:value={query}
        onkeydown={(e) => {
          if (e.key === 'Enter') void runSearch(query);
        }}
        aria-label="Search rownative courses by name"
      />
      <button
        type="button"
        class="filter-btn"
        onclick={() => void runSearch(query)}
        disabled={isSearching}
      >
        {isSearching ? 'Searching…' : 'Search'}
      </button>
    </div>
  </div>

  {#if results}
    <div class="rownative-results">
      <p class="rownative-status">
        {results.length === 0
          ? `No courses match "${query}". Try a shorter search.`
          : `Showing ${results.length} of ${totalCourses} courses`}
      </p>
      <ul class="rownative-result-list">
        {#each results as course (course.id)}
          <li>
            <button
              type="button"
              class="rownative-result"
              onclick={() => void handleImportResult(course)}
              disabled={importingId !== null}
            >
              <span class="rownative-result-name">{course.name}</span>
              <span class="rownative-result-meta">
                <span>{course.country}</span>
                <span class="rownative-result-distance">
                  {(course.distanceMeters / 1000).toFixed(2)} km
                </span>
                {#if course.status}
                  <span class="badge badge-status badge-status--{course.status}">
                    {course.status}
                  </span>
                {/if}
              </span>
              {#if importingId === course.id}
                <span class="rownative-result-busy">Importing…</span>
              {/if}
            </button>

            <!-- Attaching a track is what turns a gates-only course from
                 straight lines into the river it actually is, so the control
                 sits on the course rather than behind a separate screen. -->
            <div class="rownative-attach">
              <label class="rownative-attach-label">
                <span>{attachedFileName(course.id) ? 'Replace track' : 'Attach track'}</span>
                <input
                  type="file"
                  accept={TRACK_FILE_TYPES}
                  class="rownative-attach-input"
                  aria-label={`Attach a track to ${course.name}`}
                  disabled={attachBusyId !== null}
                  use:registerInput={course.id}
                  onchange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) void handleAttachFile(course.id, file);
                  }}
                />
              </label>

              {#if attachedFileName(course.id)}
                <span class="rownative-attach-current">{attachedFileName(course.id)}</span>
                <button
                  type="button"
                  class="rownative-attach-remove"
                  aria-label={`Remove the track attached to ${course.name}`}
                  disabled={attachBusyId !== null}
                  onclick={() => void handleDetach(course.id)}
                >
                  Remove
                </button>
              {/if}

              {#if attachBusyId === course.id}
                <span class="rownative-attach-busy" role="status">
                  Checking against the course gates…
                </span>
              {/if}
            </div>

            {#if attachError?.courseId === course.id}
              <p class="import-error rownative-attach-error" role="alert">
                ⚠ {attachError.message}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

import { useCallback, useRef, useState } from 'react';
import { useServices } from '../context/useServices';
import { RownativeCourseNotFoundError, type RownativeCourseSummary } from '../services/rownativeService';
import type { WaterRoute } from '../types/index';
import './RownativeRouteImport.css';

/** What the file picker offers, and what parseTrackFile can actually read. */
const TRACK_FILE_TYPES = '.gpx,.kml,.geojson,.json';

/**
 * Read a picked file as text.
 *
 * `FileReader` rather than `file.text()`, which is the same choice App.tsx made
 * for the route-import input: it is what every browser this app supports has,
 * and jsdom implements it, so a component test exercises the real path instead
 * of a polyfill.
 */
const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
}

const MAX_RESULTS = 30;

export function RownativeRouteImport({ onRouteImported }: RownativeRouteImportProps) {
  const { rownativeService, routeService } = useServices();
  const [selector, setSelector] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RownativeCourseSummary[] | null>(null);
  const [totalCourses, setTotalCourses] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // A rownative course file describes gates, not a path, so 34 of them render
  // as straight lines until someone who has rowed the course attaches a track.
  // Everything needed for that existed and none of it was reachable (#313).
  const [attachBusyId, setAttachBusyId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<{ courseId: string; message: string } | null>(null);
  /** Course id to attached file name, so the list can show what is on each. */
  const [attached, setAttached] = useState<Record<string, string>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  /** What the store says right now, preferring anything this session changed. */
  const attachedFileName = useCallback((courseId: string): string | null => {
    if (courseId in attached) return attached[courseId] || null;
    return rownativeService.attachedTrack(courseId)?.fileName ?? null;
  }, [attached, rownativeService]);

  const handleAttachFile = useCallback(async (courseId: string, file: File) => {
    setAttachError(null);
    setAttachBusyId(courseId);
    try {
      const { track, route } = await rownativeService.attachTrack(courseId, file.name, await readFileAsText(file));
      setAttached((prev) => ({ ...prev, [courseId]: track.fileName }));
      setNotice(`${track.fileName} attached — ${route.name} now follows your track.`);
      onRouteImported(route);
    } catch (e) {
      // The parser and the gate check both explain themselves, naming the
      // formats read or the gate missed and by how far. Neither is improved by
      // being replaced with "could not attach".
      setAttachError({
        courseId,
        message: e instanceof Error ? e.message : 'That file could not be attached.',
      });
    } finally {
      setAttachBusyId(null);
      // So picking the same file twice in a row still fires a change event.
      const input = fileInputs.current[courseId];
      if (input) input.value = '';
    }
  }, [onRouteImported, rownativeService]);

  const handleDetach = useCallback(async (courseId: string) => {
    setAttachError(null);
    setAttachBusyId(courseId);
    try {
      const route = await rownativeService.detachTrack(courseId);
      setAttached((prev) => ({ ...prev, [courseId]: '' }));
      setNotice(`Track removed — ${route.name} is back to its own geometry.`);
      onRouteImported(route);
    } catch (e) {
      setAttachError({
        courseId,
        message: e instanceof Error ? e.message : 'That track could not be removed.',
      });
    } finally {
      setAttachBusyId(null);
    }
  }, [onRouteImported, rownativeService]);

  const importCourseId = useCallback(async (courseId: string) => {
    const existing = routeService.findRouteByRownativeId(courseId);
    if (existing) {
      setNotice(`${existing.name} is already in your routes.`);
      onRouteImported(existing);
      return;
    }
    const route = await rownativeService.importCourseById(courseId);
    setNotice(null);
    onRouteImported(route);
  }, [onRouteImported, routeService, rownativeService]);

  const handleImportPasted = async () => {
    setError(null);
    setNotFoundId(null);
    setNotice(null);

    let courseId: string;
    try {
      courseId = rownativeService.resolveCourseId(selector);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a rownative course ID or a rownative.icu course link.');
      return;
    }

    setIsImporting(true);
    try {
      await importCourseId(courseId);
      setSelector('');
    } catch (e) {
      if (e instanceof RownativeCourseNotFoundError) {
        setNotFoundId(e.courseId);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : `Could not load rownative course ${courseId}.`);
      }
    } finally {
      setIsImporting(false);
    }
  };

  const runSearch = useCallback(async (term: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const [found, all] = await Promise.all([
        rownativeService.searchCourses(term, MAX_RESULTS),
        rownativeService.getCourseIndex(),
      ]);
      setResults(found);
      setTotalCourses(all.length);
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : 'Unable to load rownative course data. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [rownativeService]);

  const handleImportResult = async (course: RownativeCourseSummary) => {
    setError(null);
    setNotFoundId(null);
    setImportingId(course.id);
    try {
      await importCourseId(course.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not load ${course.name}.`);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="rownative-import" role="region" aria-label="Rownative course import">
      <div className="rownative-section">
        <div className="rownative-controls">
          <input
            type="text"
            className="import-name-input"
            placeholder="Course ID or rownative.icu link"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && selector.trim()) void handleImportPasted(); }}
            aria-label="Rownative course ID or link"
          />
          <button
            type="button"
            className="filter-btn filter-btn--active"
            onClick={() => void handleImportPasted()}
            disabled={isImporting || selector.trim().length === 0}
          >
            {isImporting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>

      {error && (
        <p className="import-error" role="alert">
          ⚠ {error}
          {notFoundId && (
            <button
              type="button"
              className="rownative-search-shortcut"
              onClick={() => {
                setError(null);
                setNotFoundId(null);
                void runSearch('');
              }}
            >
              Search by name
            </button>
          )}
        </p>
      )}

      {notice && <p className="rownative-status" role="status">{notice}</p>}

      <div className="rownative-section">
        <div className="rownative-controls">
          <input
            type="search"
            className="import-name-input"
            placeholder="Search rownative courses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(query); }}
            aria-label="Search rownative courses by name"
          />
          <button
            type="button"
            className="filter-btn"
            onClick={() => void runSearch(query)}
            disabled={isSearching}
          >
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {results && (
        <div className="rownative-results">
          <p className="rownative-status">
            {results.length === 0
              ? `No courses match "${query}". Try a shorter search.`
              : `Showing ${results.length} of ${totalCourses} courses`}
          </p>
          <ul className="rownative-result-list">
            {results.map((course) => (
              <li key={course.id}>
                <button
                  type="button"
                  className="rownative-result"
                  onClick={() => void handleImportResult(course)}
                  disabled={importingId !== null}
                >
                  <span className="rownative-result-name">{course.name}</span>
                  <span className="rownative-result-meta">
                    <span>{course.country}</span>
                    <span className="rownative-result-distance">
                      {(course.distanceMeters / 1000).toFixed(2)} km
                    </span>
                    {course.status && (
                      <span className={`badge badge-status badge-status--${course.status}`}>
                        {course.status}
                      </span>
                    )}
                  </span>
                  {importingId === course.id && <span className="rownative-result-busy">Importing…</span>}
                </button>

                {/* Attaching a track is what turns a gates-only course from
                    straight lines into the river it actually is, so the control
                    sits on the course rather than behind a separate screen. */}
                <div className="rownative-attach">
                  <label className="rownative-attach-label">
                    <span>{attachedFileName(course.id) ? 'Replace track' : 'Attach track'}</span>
                    <input
                      type="file"
                      accept={TRACK_FILE_TYPES}
                      className="rownative-attach-input"
                      aria-label={`Attach a track to ${course.name}`}
                      disabled={attachBusyId !== null}
                      ref={(el) => { fileInputs.current[course.id] = el; }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleAttachFile(course.id, file);
                      }}
                    />
                  </label>

                  {attachedFileName(course.id) && (
                    <>
                      <span className="rownative-attach-current">{attachedFileName(course.id)}</span>
                      <button
                        type="button"
                        className="rownative-attach-remove"
                        aria-label={`Remove the track attached to ${course.name}`}
                        disabled={attachBusyId !== null}
                        onClick={() => void handleDetach(course.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}

                  {attachBusyId === course.id && (
                    <span className="rownative-attach-busy" role="status">Checking against the course gates…</span>
                  )}
                </div>

                {attachError?.courseId === course.id && (
                  <p className="import-error rownative-attach-error" role="alert">⚠ {attachError.message}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

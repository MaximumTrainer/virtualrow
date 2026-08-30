import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../context/useServices';
import { RownativeCourseNotFoundError, type RownativeCourseSummary } from '../services/rownativeService';
import { trackAttachmentStore, type AttachedTrack } from '../services/trackAttachmentStore';
import { classifyPolygons, fitCandidateToGates } from '../services/rownativeGeometry';
import { parseTrackFile } from '../utils/trackParsers';
import type { WaterRoute } from '../types/index';
import './RownativeRouteImport.css';

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
}

const MAX_RESULTS = 30;

/**
 * Load rownative.icu courses into VirtualRow.
 *
 * rownative.icu has no browser-callable API (its worker is CORS-locked to its
 * own origin) and will not redirect back into VirtualRow, so everything here
 * works from our side against the public GitHub mirror: paste a course id or
 * link, or search the mirror catalogue by name.
 */
export function RownativeRouteImport({ onRouteImported }: RownativeRouteImportProps) {
  const { rownativeService, routeService } = useServices();
  const [isOpen, setIsOpen] = useState(false);
  const [selector, setSelector] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [attachCourseId, setAttachCourseId] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachedTrack[]>([]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RownativeCourseSummary[] | null>(null);
  const [totalCourses, setTotalCourses] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    setAttachments(trackAttachmentStore.list());
  }, []);

  const importCourseId = useCallback(async (courseId: string, options: { replaceExisting?: boolean } = {}) => {
    // Already imported — select it rather than creating a duplicate, unless the
    // geometry has just changed underneath it.
    const existing = routeService.findRouteByRownativeId(courseId);
    if (existing && options.replaceExisting) {
      routeService.deleteRoute(existing.id);
    } else if (existing) {
      setNotice(`${existing.name} is already in your routes.`);
      onRouteImported(existing);
      return;
    }
    const route = await rownativeService.importCourseById(courseId);
    setNotice(null);
    onRouteImported(route);
  }, [onRouteImported, routeService, rownativeService]);

  /**
   * Attach a track file to a course.
   *
   * The track is validated against that course's own gates before it is
   * stored, so a file for the wrong river is refused while the user can still
   * do something about it, rather than silently ignored at import time.
   */
  const handleAttachTrack = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setAttachError(null);

    let courseId: string;
    try {
      courseId = rownativeService.resolveCourseId(attachCourseId);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Enter the course this track belongs to.');
      input.value = '';
      return;
    }

    try {
      const coordinates = parseTrackFile(file.name, await file.text());
      const course = await rownativeService.fetchCourseGeometry(courseId);
      const fit = fitCandidateToGates(coordinates, classifyPolygons(course).gates);
      if (!fit.ok) throw fit.error;

      trackAttachmentStore.set(courseId, file.name, coordinates);
      setAttachments(trackAttachmentStore.list());
      await importCourseId(courseId, { replaceExisting: true });
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : `${file.name} could not be attached.`);
    } finally {
      input.value = '';
    }
  }, [attachCourseId, importCourseId, rownativeService]);

  const handleRemoveTrack = useCallback((courseId: string) => {
    trackAttachmentStore.remove(courseId);
    setAttachments(trackAttachmentStore.list());
  }, []);

  const handleImportPasted = async () => {
    setError(null);
    setNotFoundId(null);
    setNotice(null);

    // Resolve before any network call, so bad input never reaches fetch.
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
    <div className="rownative-import">
      <button
        type="button"
        className="btn-import-route btn-import-route--rownative"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        🌊 Add a rownative.icu course
      </button>

      {isOpen && (
        <div className="route-import-panel rownative-import-panel" role="region" aria-label="Rownative course import">
          <a
            className="rownative-open-link filter-btn"
            href="https://rownative.icu/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse rownative.icu ↗
          </a>

          <div className="rownative-fallback">
            <p>Paste a course ID or a rownative.icu course link.</p>
            <div className="rownative-controls">
              <input
                type="text"
                className="import-name-input"
                placeholder="e.g. 5, or https://rownative.icu/course/5"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
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

          <div className="rownative-fallback rownative-attach">
            <p>
              Rowed one of these courses? Attach your GPX, KML or GeoJSON track and VirtualRow
              rows its real shape instead of straight lines between the gates.
            </p>
            <div className="rownative-controls">
              <input
                type="text"
                className="import-name-input"
                placeholder="Course ID for this track"
                value={attachCourseId}
                onChange={(e) => setAttachCourseId(e.target.value)}
                aria-label="Course ID to attach a track to"
              />
              <input
                type="file"
                accept=".gpx,.kml,.geojson,.json"
                aria-label="Track file"
                disabled={attachCourseId.trim().length === 0}
                onChange={(e) => void handleAttachTrack(e)}
              />
            </div>
            {attachError && <p className="import-error" role="alert">⚠ {attachError}</p>}
            {attachments.length > 0 && (
              <ul className="rownative-attachment-list">
                {attachments.map((track) => (
                  <li key={track.courseId}>
                    <span>
                      Course {track.courseId}: {track.fileName} ({track.coordinates.length} points)
                    </span>
                    <button
                      type="button"
                      className="filter-btn"
                      onClick={() => handleRemoveTrack(track.courseId)}
                    >
                      Remove attached track
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rownative-fallback">
            <p>Or search the rownative.icu catalogue by name.</p>
            <div className="rownative-controls">
              <input
                type="search"
                className="import-name-input"
                placeholder="Search course name"
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
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

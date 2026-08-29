import { useState } from 'react';
import { useServices } from '../context/ServicesContext';
import type { WaterRoute } from '../types/index';
import { parseCourseSelector, startHandoff } from '../utils/rownativeHandoff';
import './RownativeRouteImport.css';

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
}

/**
 * Entry point to rownative.icu's course catalogue.
 *
 * The user browses and filters on rownative.icu — which already does that far
 * better than we would — and returns here with the course they picked; the
 * return leg is handled by `useRownativeHandoff`. No account linking is
 * involved: both products already identify the same person through
 * intervals.icu, so the handoff carries only a course id.
 *
 * Until rownative.icu ships the send-back affordance, the fallback field below
 * accepts a pasted course id or link and loads it through the same path.
 */
export function RownativeRouteImport({ onRouteImported }: RownativeRouteImportProps) {
  const { rownativeService, routeService } = useServices();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selector, setSelector] = useState('');

  const handleBrowse = () => {
    setError(null);
    // Navigate in this tab: the return leg must land in the window the user is
    // actually using, so a pop-up would strand the result somewhere they can't see.
    window.location.assign(startHandoff());
  };

  const handleLoadSelector = async () => {
    const courseId = parseCourseSelector(selector);
    if (!courseId) {
      setError('Enter a rownative.icu course id, or a link such as https://rownative.icu/?course=106.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const existing = routeService.findRouteByRownativeId(courseId);
      const route = existing ?? (await rownativeService.importCourseById(courseId));
      onRouteImported(route);
      setSelector('');
      setIsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not load rownative course ${courseId}.`);
    } finally {
      setIsLoading(false);
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
        🌊 Find a course on rownative.icu
      </button>

      {isOpen && (
        <div className="route-import-panel rownative-import-panel" role="region" aria-label="Rownative course import">
          <p className="rownative-status">
            Browse rownative.icu, pick a course, and it opens here ready to row.
          </p>

          <button type="button" className="filter-btn filter-btn--active" onClick={handleBrowse}>
            Browse courses on rownative.icu
          </button>

          {error && (
            <p className="import-error" role="alert">
              ⚠ {error}
            </p>
          )}

          <div className="rownative-fallback">
            <p>Already have a course id or link? Paste it here.</p>
            <div className="rownative-controls">
              <input
                type="text"
                className="import-name-input"
                placeholder="Course id or rownative.icu link"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                aria-label="Rownative course id or link"
              />
              <button
                type="button"
                className="filter-btn"
                onClick={() => void handleLoadSelector()}
                disabled={isLoading || selector.trim().length === 0}
              >
                {isLoading ? 'Loading…' : 'Load course'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

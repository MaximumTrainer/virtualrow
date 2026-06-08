import { useState } from 'react';
import { useServices } from '../context/ServicesContext';
import type { RownativeCourseSummary } from '../services/rownativeService';
import type { WaterRoute } from '../types/index';
import './RownativeRouteImport.css';

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
  onOpenKmlImport: () => void;
}

export function RownativeRouteImport({ onRouteImported, onOpenKmlImport }: RownativeRouteImportProps) {
  const { rownativeService } = useServices();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<RownativeCourseSummary[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [showManualFallback, setShowManualFallback] = useState(false);

  const loadCourses = async (searchQuery: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const matches = await rownativeService.searchCourses(searchQuery);
      setCourses(matches);
      setShowManualFallback(false);
    } catch {
      setCourses([]);
      setShowManualFallback(true);
      setError('Unable to load courses from rownative.icu right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && courses.length === 0 && !isLoading) {
      void loadCourses(query);
    }
  };

  const handleSearch = async (value: string) => {
    setQuery(value);
    await loadCourses(value);
  };

  const handleImport = async (course: RownativeCourseSummary) => {
    setImportingId(course.id);
    setError(null);
    try {
      const imported = await rownativeService.importCourse(course);
      onRouteImported(imported);
      setIsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to import course "${course.name}".`);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="rownative-import">
      <button className="btn-import-route btn-import-route--rownative" onClick={handleToggle} aria-expanded={isOpen}>
        🌊 Search rownative.icu
      </button>

      {isOpen && (
        <div className="route-import-panel rownative-import-panel" role="region" aria-label="Search rownative courses">
          <input
            type="search"
            className="import-name-input"
            placeholder="Search course name..."
            value={query}
            onChange={(e) => void handleSearch(e.target.value)}
            aria-label="Search rownative courses"
          />

          {isLoading && <p className="rownative-status">Loading courses…</p>}
          {error && (
            <p className="import-error" role="alert">
              ⚠ {error}
            </p>
          )}

          {showManualFallback && (
            <div className="rownative-fallback">
              <p>
                To import a rownative.icu course: go to{' '}
                <a href="https://rownative.icu/" target="_blank" rel="noreferrer">
                  rownative.icu
                </a>
                , find your course, export it as KML, then use the KML Import below.
              </p>
              <button type="button" className="filter-btn" onClick={onOpenKmlImport}>
                Open KML Import
              </button>
            </div>
          )}

          {!showManualFallback && !isLoading && (
            <div className="rownative-results" role="list">
              {courses.map((course) => (
                <div className="rownative-result-item" key={course.id} role="listitem">
                  <div className="rownative-result-text">
                    <strong>{course.name}</strong>
                    <span>
                      {(course.distanceMeters / 1000).toFixed(1)} km • {course.country}
                    </span>
                  </div>
                  <button
                    className="filter-btn filter-btn--active"
                    disabled={importingId === course.id}
                    onClick={() => void handleImport(course)}
                  >
                    {importingId === course.id ? 'Importing…' : 'Import'}
                  </button>
                </div>
              ))}
              {courses.length === 0 && <p className="rownative-status">No matching courses.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

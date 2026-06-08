import { useState, useRef } from 'react';
import { routeService } from '../services/routeService';
import type { WaterRoute } from '../types/index';
import type { KMLImportCandidate } from '../services/routeService';
import './RouteImport.css';

interface RouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
  initiallyOpen?: boolean;
}

type Difficulty = 'easy' | 'moderate' | 'hard';

export function RouteImport({ onRouteImported, initiallyOpen = false }: RouteImportProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<KMLImportCandidate[] | null>(null);
  const [pendingMeta, setPendingMeta] = useState<{ name: string; difficulty: Difficulty } | null>(null);
  const [routeName, setRouteName] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('moderate');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setError(null);
    setCandidates(null);
    setPendingMeta(null);
  };

  const processFile = (file: File) => {
    reset();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const nameFromFile = file.name.replace(/\.(kml|gpx|geojson|json)$/i, '');
    const effectiveName = routeName.trim() || nameFromFile;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;

      if (ext === 'kml') {
        const result = routeService.importRouteFromKML(content, { name: effectiveName, difficulty });
        if (result.status === 'success') {
          onRouteImported(result.route);
          setIsOpen(false);
          setRouteName('');
        } else if (result.status === 'error') {
          setError(result.error);
        } else {
          setCandidates(result.candidates);
          setPendingMeta({ name: effectiveName, difficulty });
        }
      } else if (ext === 'gpx') {
        const route = routeService.importRouteFromGPX(content, { name: effectiveName, difficulty });
        if (route) {
          onRouteImported(route);
          setIsOpen(false);
          setRouteName('');
        } else {
          setError('Could not parse GPX file. Make sure it contains a <trk> or <rte> with at least 2 points.');
        }
      } else if (ext === 'geojson' || ext === 'json') {
        const route = routeService.importRouteFromGeoJSON(content, { name: effectiveName, difficulty });
        if (route) {
          onRouteImported(route);
          setIsOpen(false);
          setRouteName('');
        } else {
          setError('Could not parse GeoJSON file. Make sure it contains a LineString feature with at least 2 coordinates.');
        }
      } else {
        setError(`Unsupported file type ".${ext}". Please use a .kml, .gpx, or .geojson file.`);
      }
    };
    reader.onerror = () => setError('Failed to read the file. Please try again.');
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so same file can be re-selected after an error
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSelectCandidate = (candidate: KMLImportCandidate) => {
    if (!pendingMeta) return;
    const route = routeService.finalizeKMLImport(candidate, pendingMeta);
    onRouteImported(route);
    setCandidates(null);
    setIsOpen(false);
    setRouteName('');
  };

  return (
    <div className="route-import">
      <button
        className="btn-import-route"
        onClick={() => { setIsOpen((v) => !v); reset(); }}
        aria-expanded={isOpen}
      >
        📁 Import Route
      </button>

      {isOpen && (
        <div className="route-import-panel" role="region" aria-label="Import route">
          <div className="import-fields">
            <input
              type="text"
              placeholder="Route name (optional)"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              className="import-name-input"
              aria-label="Route name"
            />
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="import-difficulty-select"
              aria-label="Difficulty"
            >
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div
            className={`drop-zone${isDragOver ? ' drop-zone--active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Drop a route file here or click to browse"
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <span className="drop-zone-label">Drop a file here or click to browse</span>
            <span className="drop-zone-formats">.kml · .gpx · .geojson</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".kml,.gpx,.geojson,.json"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />

          {error && (
            <p className="import-error" role="alert">
              ⚠ {error}
            </p>
          )}

          {candidates && (
            <div className="candidate-list" role="list">
              <p className="candidate-prompt">Multiple routes found — select one to import:</p>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  className="candidate-item"
                  onClick={() => handleSelectCandidate(c)}
                  role="listitem"
                >
                  <strong className="candidate-name">{c.name}</strong>
                  <span className="candidate-meta">{c.coordinates.length} pts</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

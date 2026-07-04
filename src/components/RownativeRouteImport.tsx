import { useState } from 'react';
import { useServices } from '../context/ServicesContext';
import type { WaterRoute } from '../types/index';
import './RownativeRouteImport.css';

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
  onOpenKmlImport: () => void;
}

export function RownativeRouteImport({ onRouteImported, onOpenKmlImport }: RownativeRouteImportProps) {
  const { authService, rownativeService, routeService } = useServices();
  const [isOpen, setIsOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Not linked');
  const [linkedAccountName, setLinkedAccountName] = useState<string | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [linkRequestId, setLinkRequestId] = useState<string | undefined>(undefined);
  const [routeSelector, setRouteSelector] = useState('');
  const currentUser = authService.getUser();
  const currentUserId = currentUser?.id ?? '';

  const loadLinkStatus = () => {
    setError(null);
    if (!currentUserId) {
      setIsLinked(false);
      setLinkedAccountName(null);
      setStatus('Sign in to VirtualRow to link rownative.');
      return;
    }
    const linked = rownativeService.getLinkedAccount(currentUserId);
    if (!linked) {
      setIsLinked(false);
      setLinkedAccountName(null);
      setStatus('Not linked');
      return;
    }

    setIsLinked(true);
    setLinkedAccountName(linked.rownativeDisplayName ?? linked.rownativeUserId);
    setStatus('Linked');
  };

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      loadLinkStatus();
      setError(null);
    }
  };

  const handleStartLink = async () => {
    setIsLinking(true);
    setError(null);
    try {
      const result = await rownativeService.startLinkFlow(currentUserId);
      const popup = window.open(result.linkUrl, '_blank', 'noopener,noreferrer');
      if (!popup) {
        setStatus('Link failed');
        setError('Your browser blocked the rownative link window. Allow pop-ups and try again.');
        return;
      }
      setLinkRequestId(result.requestId);
      setStatus('Linking');
    } catch (e) {
      setStatus('Link failed');
      setError(e instanceof Error ? e.message : 'Unable to start rownative linking.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleCompleteLink = async () => {
    setIsLinking(true);
    setError(null);
    try {
      const linked = await rownativeService.completeLinkFlow(currentUserId, linkRequestId);
      setIsLinked(true);
      setLinkedAccountName(linked.rownativeDisplayName ?? linked.rownativeUserId);
      setStatus('Linked');
    } catch (e) {
      setStatus('Link failed');
      setError(e instanceof Error ? e.message : 'Unable to confirm rownative linking yet.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    setIsUnlinking(true);
    setError(null);
    try {
      await rownativeService.unlinkAccount(currentUserId);
      setIsLinked(false);
      setLinkedAccountName(null);
      setLinkRequestId(undefined);
      setStatus('Not linked');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to unlink rownative account.');
    } finally {
      setIsUnlinking(false);
    }
  };

  const handlePullRoute = async () => {
    setIsPulling(true);
    setError(null);
    try {
      const trimmedSelector = routeSelector.trim();
      const selection = trimmedSelector.includes('://')
        ? { routeUrl: trimmedSelector }
        : { routeId: trimmedSelector };
      const kmlResult = await rownativeService.pullLinkedRouteKml({
        virtualRowUserId: currentUserId,
        ...(trimmedSelector ? selection : {}),
      });
      const importResult = routeService.importRouteFromKML(kmlResult.kml, {
        name: kmlResult.routeName,
        location: kmlResult.location ?? 'rownative.icu',
        tags: ['rownative', 'imported', 'kml'],
      });

      if (importResult.status === 'error') {
        throw new Error(importResult.error);
      }

      const imported = importResult.status === 'success'
        ? importResult.route
        : (() => {
            if (importResult.candidates.length === 0) {
              throw new Error('No selectable routes were found in the pulled KML.');
            }
            return routeService.finalizeKMLImport(importResult.candidates[0], {
              name: kmlResult.routeName,
              location: kmlResult.location ?? 'rownative.icu',
              tags: ['rownative', 'imported', 'kml'],
            });
          })();
      onRouteImported(imported);
      setStatus('Pull success');
      setIsOpen(false);
    } catch (e) {
      setStatus('Pull failed');
      setError(e instanceof Error ? e.message : 'Unable to pull a route from rownative.');
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="rownative-import">
      <button className="btn-import-route btn-import-route--rownative" onClick={handleToggle} aria-expanded={isOpen}>
        🌊 Open rownative.icu
      </button>

      {isOpen && (
        <div className="route-import-panel rownative-import-panel" role="region" aria-label="Rownative route import">
          <p className="rownative-status">
            Status: <strong>{status}</strong>
          </p>
          {linkedAccountName && (
            <p className="rownative-status">
              Linked account: <strong>{linkedAccountName}</strong>
            </p>
          )}
          <a
            className="filter-btn filter-btn--active rownative-open-link"
            href="https://rownative.icu/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open rownative.icu
          </a>
          {error && (
            <p className="import-error" role="alert">
              ⚠ {error}
            </p>
          )}

          <div className="rownative-controls">
            {!isLinked && (
              <>
                <button type="button" className="filter-btn filter-btn--active" onClick={() => void handleStartLink()} disabled={isLinking}>
                  {isLinking ? 'Starting link…' : 'Link rownative account'}
                </button>
                <button type="button" className="filter-btn" onClick={() => void handleCompleteLink()} disabled={isLinking || !currentUserId}>
                  {isLinking ? 'Checking…' : 'Complete linking'}
                </button>
              </>
            )}

            {isLinked && (
              <>
                <input
                  type="text"
                  className="import-name-input"
                  placeholder="Optional route id or URL"
                  value={routeSelector}
                  onChange={(e) => setRouteSelector(e.target.value)}
                  aria-label="Rownative route id or URL"
                />
                <button type="button" className="filter-btn filter-btn--active" onClick={() => void handlePullRoute()} disabled={isPulling}>
                  {isPulling ? 'Pulling…' : 'Pull route KML'}
                </button>
                <button type="button" className="filter-btn" onClick={() => void handleUnlink()} disabled={isUnlinking}>
                  {isUnlinking ? 'Unlinking…' : 'Unlink rownative account'}
                </button>
              </>
            )}
          </div>

          <div className="rownative-fallback">
            <p>
              Prefer manual import? Export KML on rownative.icu and import it directly in VirtualRow.
            </p>
            <button type="button" className="filter-btn" onClick={onOpenKmlImport}>
              Open KML Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

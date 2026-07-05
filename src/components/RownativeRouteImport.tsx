import { useState } from 'react';
import { useServices } from '../context/ServicesContext';
import type { KMLImportCandidate } from '../services/routeService';
import type { WaterRoute } from '../types/index';
import './RownativeRouteImport.css';

interface RownativeRouteImportProps {
  onRouteImported: (route: WaterRoute) => void;
}

export function RownativeRouteImport({ onRouteImported }: RownativeRouteImportProps) {
  const { rownativeService } = useServices();
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
  const [kmlCandidates, setKmlCandidates] = useState<KMLImportCandidate[] | null>(null);
  const [pendingKmlMeta, setPendingKmlMeta] = useState<{ name?: string; location?: string; tags?: string[] } | null>(null);
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
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setStatus('Link failed');
      setError('Your browser blocked the rownative link window. Allow pop-ups and try again.');
      setIsLinking(false);
      return;
    }
    try {
      const result = await rownativeService.startLinkFlow(currentUserId);
      popup.location.href = result.linkUrl;
      setLinkRequestId(result.requestId);
      setStatus('Linking');
    } catch (e) {
      popup.close();
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
      setLinkRequestId(undefined);
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
      const kmlMeta = {
        name: kmlResult.routeName,
        location: kmlResult.location ?? 'rownative.icu',
        tags: ['rownative', 'imported', 'kml'],
      };
      const importResult = routeService.importRouteFromKML(kmlResult.kml, kmlMeta);

      if (importResult.status === 'error') {
        throw new Error(importResult.error);
      }

      if (importResult.status === 'selectionRequired') {
        if (importResult.candidates.length === 0) {
          throw new Error('No selectable routes were found in the pulled KML.');
        }
        setKmlCandidates(importResult.candidates);
        setPendingKmlMeta(kmlMeta);
        setStatus('Select route');
        return;
      }

      onRouteImported(importResult.route);
      setStatus('Pull success');
      setIsOpen(false);
    } catch (e) {
      setStatus('Pull failed');
      setError(e instanceof Error ? e.message : 'Unable to pull a route from rownative.');
    } finally {
      setIsPulling(false);
    }
  };

  const handleSelectCandidate = (candidate: KMLImportCandidate) => {
    try {
      const imported = routeService.finalizeKMLImport(candidate, pendingKmlMeta ?? {});
      onRouteImported(imported);
      setKmlCandidates(null);
      setPendingKmlMeta(null);
      setStatus('Pull success');
      setIsOpen(false);
    } catch (e) {
      setStatus('Pull failed');
      setError(e instanceof Error ? e.message : 'Unable to import the selected route.');
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

          {showManualFallback && (
            <div className="rownative-fallback">
              <p>
                Browse courses directly on
                {' '}
                <a href="https://rownative.icu/" target="_blank" rel="noreferrer">
                  rownative.icu
                </a>
                {' '}and retry the import here once the catalog is reachable again.
              </p>
            </div>
          )}

          {kmlCandidates && (
            <div className="rownative-controls">
              <p className="rownative-status">Multiple routes found. Select one to import:</p>
              {kmlCandidates.map((candidate, i) => (
                <button
                  key={i}
                  type="button"
                  className="filter-btn"
                  onClick={() => handleSelectCandidate(candidate)}
                >
                  {candidate.name || `Route ${i + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

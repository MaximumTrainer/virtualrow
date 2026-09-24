import React, { useState } from 'react';
import { shareCardBlob, shareCardFileName } from '../utils/shareCard';
import { triggerBlobDownload } from '../utils/exporters';
import type { WorkoutSession } from '../types/index';
import './ShareCardButton.css';

/**
 * Saves the row as a picture somebody can post (#337).
 *
 * The card is drawn on a canvas in the browser and downloaded from it. Nothing
 * is uploaded, so there is no service to be down, no account to have, and no
 * copy of the row anywhere the rower did not put it.
 */

export interface ShareCardButtonProps {
  session: WorkoutSession;
  className?: string;
}

export const ShareCardButton: React.FC<ShareCardButtonProps> = ({ session, className }) => {
  const [drawing, setDrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setDrawing(true);
    setProblem(null);
    try {
      const blob = await shareCardBlob(session);
      triggerBlobDownload(blob, 'image/png', shareCardFileName(session));
    } catch {
      // A failed picture is not a failed row, and on the summary - the only
      // place the row exists until it is saved - those read the same unless
      // one of them says so.
      setProblem('The share card could not be drawn here. Your row is safe.');
    } finally {
      setDrawing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className ?? 'btn-share-card'}
        onClick={save}
        // Drawing 1200x630 takes a moment on a phone, and a button that looks
        // inert invites a second and a third card.
        disabled={drawing}
      >
        {drawing ? 'Drawing…' : 'Share card'}
      </button>
      {problem && (
        <p className="share-card-problem" role="alert">
          {problem}
        </p>
      )}
    </>
  );
};

export default ShareCardButton;

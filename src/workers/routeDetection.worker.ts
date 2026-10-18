/**
 * #493 D23 b: route detection off the main thread. The work itself lives in
 * utils/routeDetection.ts, where it is tested; this only wires it to messages.
 */
import { answerDetectionRequest } from '../utils/routeDetection';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  scope.postMessage(answerDetectionRequest(event.data));
};

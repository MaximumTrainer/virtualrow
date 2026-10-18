/**
 * #493 detection as one call: the water mask, the samples along the route and
 * the route's water type, from the Overpass response. Pure, so the same code
 * runs in the detection worker (D23 b) and inline where a worker can't run.
 *
 * Input and result are plain data: they cross to the worker and back by
 * structured clone. The mask stays inside, since only the samples and the
 * class leave it.
 */
import type { Coordinate } from '../types/index';
import type { OverpassElement } from '../services/routeEnrichmentService';
import { buildWaterMask, type MaskBounds } from './osmWaterMask';
import { detectRoute, type DetectedSample, type RouteDetection } from './shoreDetection';
import { classifyDetectedRoute, type RouteWaterClass } from './waterClassification';

export interface RouteDetectionInput {
  coordinates: Coordinate[];
  elements: OverpassElement[];
  coastlineBounds: MaskBounds;
}

export interface RouteDetectionResult {
  samples: DetectedSample[];
  summary: RouteDetection['summary'];
  detected: RouteWaterClass;
}

export const runRouteDetection = ({ coordinates, elements, coastlineBounds }: RouteDetectionInput): RouteDetectionResult => {
  const mask = buildWaterMask(elements, { coastlineBounds });
  const { samples, summary } = detectRoute(coordinates, mask);
  return { samples, summary, detected: classifyDetectedRoute(samples, mask, elements) };
};

export interface DetectionRequest {
  id: number;
  input: RouteDetectionInput;
}

export type DetectionResponse = { id: number; result: RouteDetectionResult } | { id: number; error: string };

const isRequest = (data: unknown): data is DetectionRequest =>
  typeof data === 'object' && data !== null && typeof (data as DetectionRequest).id === 'number';

/** The worker's whole job, kept here so it is tested without a worker. */
export const answerDetectionRequest = (data: unknown): DetectionResponse => {
  if (!isRequest(data)) return { id: -1, error: 'malformed detection request' };
  try {
    return { id: data.id, result: runRouteDetection(data.input) };
  } catch (error) {
    return { id: data.id, error: error instanceof Error ? error.message : String(error) };
  }
};

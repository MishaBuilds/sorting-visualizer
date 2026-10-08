/**
 * Static presentation data for the collapsible Algorithm Inspector card.
 * Complexities come from the algorithm's own getInfo() — the tags are the
 * only added content here.
 */

import type { AlgorithmId, SortConfig } from '../types';
import { AlgorithmRegistry } from './base';

export const ALGORITHM_TAGS: Record<AlgorithmId, string> = {
  bubble: 'Iteration',
  quick: 'Divide & Conquer',
  merge: 'Divide & Conquer',
  heap: 'Selection · Heap',
};

export interface InspectorData {
  id: AlgorithmId;
  name: string;
  tag: string;
  description: string;
  bestComplexity: string;
  averageComplexity: string;
  worstComplexity: string;
  spaceComplexity: string;
  stable: boolean;
}

export function getInspectorData(id: AlgorithmId, config: SortConfig): InspectorData | null {
  const AlgorithmClass = AlgorithmRegistry.get(id);
  if (!AlgorithmClass) return null;

  const info = new AlgorithmClass(config).getInfo();
  return {
    id,
    name: info.name,
    tag: ALGORITHM_TAGS[id],
    description: info.description,
    bestComplexity: info.bestComplexity,
    averageComplexity: info.averageComplexity,
    worstComplexity: info.worstComplexity,
    spaceComplexity: info.spaceComplexity,
    stable: info.stable,
  };
}

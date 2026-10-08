/**
 * Core type definitions for the sorting visualizer
 */

import type * as THREE from 'three';

export type AlgorithmId = 'bubble' | 'quick' | 'merge' | 'heap';

export type VisualizationMode = 'cubes' | 'bars' | 'numbers';

export type DataDistribution = 'random' | 'nearly-sorted' | 'reversed' | 'few-unique';

export type AppState = 'idle' | 'generating' | 'sorting' | 'paused' | 'completed';

export type OperationType =
  | 'compare'
  | 'swap'
  | 'move'
  | 'overwrite'
  | 'pivot'
  | 'heapify'
  | 'merge'
  | 'mark-sorted'
  | 'mark-range';

export interface SortOperation {
  type: OperationType;
  indices: number[];
  values?: number[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface SortStatistics {
  comparisons: number;
  swaps: number;
  arrayAccesses: number;
  operations: number;
  elapsedTime: number;
  progress: number;
}

export interface AlgorithmInfo {
  id: AlgorithmId;
  name: string;
  description: string;
  bestComplexity: string;
  averageComplexity: string;
  worstComplexity: string;
  spaceComplexity: string;
  stable: boolean;
}

export interface SortConfig {
  algorithm: AlgorithmId;
  elementCount: number;
  visualizationMode: VisualizationMode;
  speed: number;
  dataDistribution: DataDistribution;
  soundEnabled: boolean;
}

export interface ElementState {
  value: number;
  originalIndex: number;
  currentIndex: number;
  state: 'default' | 'comparing' | 'swapping' | 'pivot' | 'sorted' | 'range' | 'merged';
  targetPosition?: THREE.Vector3;
}

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface ChartDataPoint {
  timestamp: number;
  comparisons: number;
  swaps: number;
  operations: number;
}

export interface SortingContext {
  array: number[];
  operations: SortOperation[];
  statistics: SortStatistics;
  isComplete: boolean;
}
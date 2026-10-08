/**
 * Main Entry Point - Sorting Visualizer
 */

import type { SortConfig } from './types';
import { UIManager } from './ui';
import { initializeAlgorithms } from './algorithms';

// Initialize all algorithms
initializeAlgorithms();

// Default configuration
const defaultConfig: SortConfig = {
  algorithm: 'quick',
  elementCount: 10000,
  visualizationMode: 'cubes',
  speed: 1.0,
  dataDistribution: 'random',
  soundEnabled: false,
  performanceMode: 'normal',
};

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('App container not found');
    return;
  }

  // Initialize UI Manager
  const uiManager = new UIManager(appContainer, defaultConfig);

  // Handle page unload
  window.addEventListener('beforeunload', () => {
    uiManager.dispose();
  });

  // Expose for debugging
  (window as any).sortVisualizer = uiManager;

  console.log('Sorting Visualizer initialized');
  console.log('Available algorithms:', ['bubble', 'quick', 'merge', 'heap']);
  console.log('Config:', defaultConfig);
});

// Handle global errors
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
});
/**
 * Color palette for visualization states
 */

import * as THREE from 'three';

export const COLORS = {
  // Element states
  DEFAULT: new THREE.Color(0x3a4a5c),       // Muted blue-gray
  COMPARING: new THREE.Color(0xff6b35),     // Bright orange
  SWAPPING: new THREE.Color(0xffd700),      // Gold
  PIVOT: new THREE.Color(0x00ff88),         // Bright green
  SORTED: new THREE.Color(0x4ecdc4),        // Teal
  RANGE: new THREE.Color(0x7b68ee),         // Medium slate blue
  MERGED: new THREE.Color(0xff69b4),        // Hot pink

  // Background & environment
  BACKGROUND: new THREE.Color(0x0d1117),    // Very dark blue-gray
  GRID: new THREE.Color(0x21262d),          // Slightly lighter
  FOG: new THREE.Color(0x0d1117),           // Same as background

  // UI accents
  ACCENT_PRIMARY: new THREE.Color(0x58a6ff),   // Bright blue
  ACCENT_SECONDARY: new THREE.Color(0xa371f7), // Purple
  ACCENT_SUCCESS: new THREE.Color(0x3fb950),   // Green
  ACCENT_WARNING: new THREE.Color(0xd29922),   // Amber
  ACCENT_DANGER: new THREE.Color(0xf85149),    // Red

  // Text
  TEXT_PRIMARY: new THREE.Color(0xe6edf3),
  TEXT_SECONDARY: new THREE.Color(0x8b949e),
  TEXT_MUTED: new THREE.Color(0x6e7681),
} as const;

// Emissive colors for glowing effect
export const EMISSIVE_COLORS = {
  DEFAULT: new THREE.Color(0x000000),
  COMPARING: new THREE.Color(0x331a0a),
  SWAPPING: new THREE.Color(0x332a00),
  PIVOT: new THREE.Color(0x003315),
  SORTED: new THREE.Color(0x002a26),
  RANGE: new THREE.Color(0x1a1533),
  MERGED: new THREE.Color(0x331525),
} as const;

// Color lerp helper
export function lerpColor(start: THREE.Color, end: THREE.Color, factor: number): THREE.Color {
  return start.clone().lerp(end, Math.max(0, Math.min(1, factor)));
}

// Get color for element state
export function getColorForState(state: string): THREE.Color {
  switch (state) {
    case 'comparing': return COLORS.COMPARING;
    case 'swapping': return COLORS.SWAPPING;
    case 'pivot': return COLORS.PIVOT;
    case 'sorted': return COLORS.SORTED;
    case 'range': return COLORS.RANGE;
    case 'merged': return COLORS.MERGED;
    default: return COLORS.DEFAULT;
  }
}

export function getEmissiveForState(state: string): THREE.Color {
  switch (state) {
    case 'comparing': return EMISSIVE_COLORS.COMPARING;
    case 'swapping': return EMISSIVE_COLORS.SWAPPING;
    case 'pivot': return EMISSIVE_COLORS.PIVOT;
    case 'sorted': return EMISSIVE_COLORS.SORTED;
    case 'range': return EMISSIVE_COLORS.RANGE;
    case 'merged': return EMISSIVE_COLORS.MERGED;
    default: return EMISSIVE_COLORS.DEFAULT;
  }
}
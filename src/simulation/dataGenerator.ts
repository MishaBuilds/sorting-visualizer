/**
 * Data generation utilities for different distributions
 */

import type { DataDistribution } from '../types';

export function generateArray(count: number, distribution: DataDistribution = 'random'): number[] {
  switch (distribution) {
    case 'random':
      return generateRandom(count);
    case 'nearly-sorted':
      return generateNearlySorted(count);
    case 'reversed':
      return generateReversed(count);
    case 'few-unique':
      return generateFewUnique(count);
    default:
      return generateRandom(count);
  }
}

function generateRandom(count: number): number[] {
  const array = new Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = i + 1;
  }
  // Fisher-Yates shuffle
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateNearlySorted(count: number): number[] {
  const array = new Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = i + 1;
  }
  // Swap ~10% of elements
  const swaps = Math.floor(count * 0.1);
  for (let i = 0; i < swaps; i++) {
    const a = Math.floor(Math.random() * count);
    const b = Math.floor(Math.random() * count);
    [array[a], array[b]] = [array[b], array[a]];
  }
  return array;
}

function generateReversed(count: number): number[] {
  const array = new Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = count - i;
  }
  return array;
}

function generateFewUnique(count: number): number[] {
  const array = new Array(count);
  const uniqueValues = Math.max(2, Math.floor(Math.sqrt(count)));
  for (let i = 0; i < count; i++) {
    array[i] = Math.floor(Math.random() * uniqueValues) + 1;
  }
  return array;
}

export function generateCustomArray(count: number, generator: (index: number) => number): number[] {
  const array = new Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = generator(i);
  }
  return array;
}

export const DATA_DISTRIBUTIONS: { id: DataDistribution; name: string; description: string }[] = [
  { id: 'random', name: 'Random', description: 'Completely shuffled array' },
  { id: 'nearly-sorted', name: 'Nearly Sorted', description: 'Already sorted with ~10% elements swapped' },
  { id: 'reversed', name: 'Reversed', description: 'Sorted in descending order' },
  { id: 'few-unique', name: 'Few Unique', description: 'Only √n unique values repeated' },
];
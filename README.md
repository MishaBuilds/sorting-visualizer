# Sorting 10,000 Elements Live

An interactive **3D sorting-algorithm visualizer** that really sorts real arrays and shows every
comparison, swap, and move on a live Three.js scene — by default **10,000 elements** rendered as a
single instanced mesh, streaming hundreds of thousands of operations frame by frame with live
statistics.

**Live site:** https://session24.github.io/sorting-visualizer/

## Features

- **Real sorting, not a canned animation** — the actual algorithms run on the actual array and emit
  an operation stream (`COMPARE`, `SWAP`, `MOVE`, `OVERWRITE`, `PIVOT`, `HEAPIFY`, `MERGE`,
  `MARK_SORTED`) that drives the renderer.
- **Scale from 1,000 to 100,000 elements** (plus a validated custom count) — 10,000 renders as
  10,000 × 12 triangles in one draw call.
- **Three visualization modes**, switchable at any time — even mid-sort:
  - **3D Cubes** — a field of colored cubes;
  - **3D Bars** — heights proportional to values;
  - **Numbers** — an adaptive 2D overlay of value labels.
- **Real-time statistics** — comparisons, swaps, array accesses, elapsed time, progress and status,
  all taken from the algorithm's own counters.
- **Current-operation panel** — shows exactly what the algorithm is doing right now.
- **Live camera controls** — rotate, zoom, pan, plus an animated **Reset Camera**.
- **Playback controls** — Sort / Pause / Resume / Reset / Randomize, with a speed multiplier up to
  10×.
- **Data distributions** — random, nearly sorted, reversed, few unique.
- **Dark, technical UI** — responsive layout with a hover readout of index and value.

## Algorithms

| Algorithm | Time (avg) | Space | Notes |
|-----------|-----------|-------|-------|
| **Bubble Sort** | O(n²) | O(1) | Repeated adjacent swaps; visualizes the sorted tail growing pass by pass. |
| **Quick Sort** | O(n log n) avg | O(log n) | In-place partitioning around a pivot; highlights pivot selection and partition ranges. |
| **Merge Sort** | O(n log n) | O(n) | Top-down merges; visualizes ranges being merged — no swaps, only moves/overwrites. |
| **Heap Sort** | O(n log n) | O(1) | Builds a max-heap then extracts elements; highlights heapify ranges. |

Each algorithm is a TypeScript generator that yields one batch of operations at a time, so the UI
stays responsive at 100,000 elements thanks to backpressure between generation and rendering.

## Tech stack

- **[Three.js](https://threejs.org/)** — WebGL rendering via a single `InstancedMesh` with
  per-instance colors and dirty-set uploads.
- **[TypeScript](https://www.typescriptlang.org/)** — strict, no `any` in the core layers.
- **[Vite](https://vite.dev/)** — dev server and production build with fully relative paths
  (`base: './'`), so the site works under any sub-path.
- **[Vitest](https://vitest.dev/)** — unit tests for the algorithms and the simulation layer.
- Layered architecture: `src/algorithms` → `src/simulation` → `src/rendering` → `src/ui`.

## Local run

```bash
npm install
npm dev          # dev server at http://127.0.0.1:5173/
```

Quality gates (all run in CI before deployment):

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # typecheck + production build into dist/
npm run preview     # serve the production build locally
```

## Deployment

Every push to `main` triggers a GitHub Actions workflow that runs the typecheck, tests and
production build, then publishes `dist/` to **GitHub Pages** — free hosting, no paid services,
no backend, no database.

## License

MIT — free to use, study and share.

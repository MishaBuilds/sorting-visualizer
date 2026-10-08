/**
 * One Compare Mode lane: a self-contained scene (bars-style instanced
 * grid) rendered into a scissored viewport of the shared WebGLRenderer.
 *
 * Deliberately simpler than the main renderer — no lerp animations, no
 * shadows, no raycasting — so up to 4 lanes stay cheap. The data flow is
 * the same physical-slot model driven by the real operation stream.
 */

import * as THREE from 'three';
import type { SortOperation, LaneRect } from '../types';
import { COLORS, getColorForState } from './colors';

interface LaneInstance {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  color: THREE.Color;
  value: number;
  slot: number;
}

export class CompareLane {
  readonly scene: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private instances: LaneInstance[] = [];
  /** slot -> instance index (same model as the main renderer) */
  private instanceAtSlot: number[] = [];
  private dirty = new Set<number>();
  private elementCount: number;
  private maxValue = 1;

  private gridCols = 1;
  private gridRows = 1;
  private gridSpacing = 1.1;
  private gridStartX = 0;
  private gridStartZ = 0;

  constructor(count: number) {
    this.elementCount = Math.max(1, count);

    this.scene = new THREE.Scene();
    this.scene.background = COLORS.BACKGROUND;

    // Cheap lighting: ambient + key + accent fill (no shadow maps)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(30, 60, 30);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x58a6ff, 0.4);
    fill.position.set(-30, 20, -30);
    this.scene.add(fill);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.elementCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.computeGrid();
    this.initInstances();
    this.initCamera();
  }

  private computeGrid(): void {
    const n = this.elementCount;
    this.gridCols = Math.max(1, Math.ceil(Math.sqrt(n)));
    this.gridRows = Math.ceil(n / this.gridCols);
    this.gridStartX = -((this.gridCols - 1) * this.gridSpacing) / 2;
    this.gridStartZ = -((this.gridRows - 1) * this.gridSpacing) / 2;
  }

  private initInstances(): void {
    this.instances = [];
    this.instanceAtSlot = [];
    this.dirty.clear();
    for (let i = 0; i < this.elementCount; i++) {
      const x = this.gridStartX + (i % this.gridCols) * this.gridSpacing;
      const z = this.gridStartZ + Math.floor(i / this.gridCols) * this.gridSpacing;
      this.instances.push({
        position: new THREE.Vector3(x, 0.2, z),
        scale: new THREE.Vector3(0.8, 0.4, 0.8),
        color: COLORS.DEFAULT.clone(),
        value: 0,
        slot: i,
      });
      this.instanceAtSlot.push(i);
      this.dirty.add(i);
    }
  }

  private initCamera(): void {
    const maxDim = Math.max(this.gridCols, this.gridRows) * this.gridSpacing;
    const distance = maxDim * 1.3 + 16;
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, Math.max(1000, distance * 5));
    this.camera.position.set(0, distance * 0.5, distance * 0.85);
    this.camera.lookAt(0, 0, 0);
  }

  /** Fresh array for this lane (called once per compare run). */
  updateArray(values: number[]): void {
    let maxValue = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > maxValue) maxValue = values[i];
    }
    this.maxValue = maxValue > 0 ? maxValue : 1;

    const count = Math.min(values.length, this.elementCount);
    for (let i = 0; i < count; i++) {
      const inst = this.instances[i];
      inst.value = values[i];
      inst.slot = i;
      this.instanceAtSlot[i] = i;
      this.applyPresentation(inst);
      this.refreshPosition(inst);
      inst.color.copy(COLORS.DEFAULT);
      this.dirty.add(i);
    }
    this.flush();
  }

  private applyPresentation(inst: LaneInstance): void {
    const normalized = this.maxValue > 0 ? inst.value / this.maxValue : 0;
    inst.scale.set(0.8, 0.4 + normalized * 9.6, 0.8);
    const hue = 0.6 * (1 - normalized);
    inst.color.setHSL(hue, 0.7, 0.45);
  }

  private refreshPosition(inst: LaneInstance): void {
    inst.position.x = this.gridStartX + (inst.slot % this.gridCols) * this.gridSpacing;
    inst.position.z = this.gridStartZ + Math.floor(inst.slot / this.gridCols) * this.gridSpacing;
    inst.position.y = inst.scale.y / 2;
  }

  private setState(inst: LaneInstance, state: string): void {
    inst.color.copy(getColorForState(state));
  }

  /** Replay real operations onto this lane's grid. */
  applyOperations(operations: SortOperation[]): void {
    const owner = this.instanceAtSlot;
    const valid = (slot: number) => slot >= 0 && slot < owner.length;

    for (const op of operations) {
      const { indices, type } = op;
      switch (type) {
        case 'compare':
          for (const slot of indices) {
            if (valid(slot)) {
              const inst = this.instances[owner[slot]];
              this.setState(inst, 'comparing');
              this.dirty.add(owner[slot]);
            }
          }
          break;

        case 'swap': {
          if (indices.length === 2 && valid(indices[0]) && valid(indices[1])) {
            const [i, j] = indices;
            const a = owner[i];
            const b = owner[j];
            if (a === b) break;
            const instA = this.instances[a];
            const instB = this.instances[b];
            const slotA = instA.slot;
            instA.slot = instB.slot;
            instB.slot = slotA;
            owner[i] = b;
            owner[j] = a;
            this.refreshPosition(instA);
            this.refreshPosition(instB);
            this.setState(instA, 'swapping');
            this.setState(instB, 'swapping');
            this.dirty.add(a);
            this.dirty.add(b);
          }
          break;
        }

        case 'move':
        case 'overwrite': {
          const slot = indices[indices.length - 1];
          const value = op.values && op.values.length > 0 ? op.values[0] : undefined;
          if (valid(slot) && value !== undefined) {
            const idx = owner[slot];
            const inst = this.instances[idx];
            inst.value = value;
            this.applyPresentation(inst);
            this.refreshPosition(inst);
            this.setState(inst, 'swapping');
            this.dirty.add(idx);
          }
          break;
        }

        case 'pivot':
          for (const slot of indices) {
            if (valid(slot)) {
              this.setState(this.instances[owner[slot]], 'pivot');
              this.dirty.add(owner[slot]);
            }
          }
          break;

        case 'heapify':
          for (const slot of indices) {
            if (valid(slot)) {
              this.setState(this.instances[owner[slot]], 'range');
              this.dirty.add(owner[slot]);
            }
          }
          break;

        case 'merge':
          if (indices.length >= 4) {
            const [leftStart, leftEnd, rightStart, rightEnd] = indices;
            for (let s = leftStart; s <= leftEnd; s++) {
              if (valid(s)) {
                this.setState(this.instances[owner[s]], 'merged');
                this.dirty.add(owner[s]);
              }
            }
            for (let s = rightStart; s <= rightEnd; s++) {
              if (valid(s)) {
                this.setState(this.instances[owner[s]], 'merged');
                this.dirty.add(owner[s]);
              }
            }
          }
          break;

        case 'mark-sorted':
          for (const slot of indices) {
            if (valid(slot)) {
              this.setState(this.instances[owner[slot]], 'sorted');
              this.dirty.add(owner[slot]);
            }
          }
          break;

        case 'mark-range':
          if (indices.length === 2) {
            const [start, end] = indices;
            for (let s = start; s <= end; s++) {
              if (valid(s)) {
                this.setState(this.instances[owner[s]], 'range');
                this.dirty.add(owner[s]);
              }
            }
          }
          break;
      }
    }

    this.flush();
  }

  markSorted(indices: number[]): void {
    for (const slot of indices) {
      if (slot >= 0 && slot < this.instanceAtSlot.length) {
        this.setState(this.instances[this.instanceAtSlot[slot]], 'sorted');
        this.dirty.add(this.instanceAtSlot[slot]);
      }
    }
    this.flush();
  }

  /** Upload only what changed since the last flush. */
  private flush(): void {
    if (this.dirty.size === 0) return;
    for (const i of this.dirty) {
      const inst = this.instances[i];
      this.dummy.position.copy(inst.position);
      this.dummy.scale.copy(inst.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, inst.color);
    }
    this.dirty.clear();
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Draw this lane into its rect (top-left origin, CSS px). */
  render(gl: THREE.WebGLRenderer, rect: LaneRect, canvasHeight: number): void {
    const yGl = canvasHeight - rect.y - rect.h;
    gl.setViewport(rect.x, yGl, rect.w, rect.h);
    gl.setScissor(rect.x, yGl, rect.w, rect.h);
    gl.setScissorTest(true);
    this.camera.aspect = Math.max(0.01, rect.w / Math.max(1, rect.h));
    this.camera.updateProjectionMatrix();
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.scene.clear();
  }
}

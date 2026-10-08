/**
 * Main 3D Renderer using Three.js InstancedMesh for high performance.
 *
 * Visual model ("physical slots"):
 * - The array is laid out as a grid of slots; instanceAtSlot[slot] tells which
 *   instance currently occupies a slot.
 * - Instances carry their value. On SWAP the two involved instances exchange
 *   slots (they visibly move and stay there), so the value follows the instance
 *   and every slot always shows the value the algorithm has at that index.
 * - Value-changing operations (OVERWRITE / MOVE) update the value displayed by
 *   the instance that currently occupies the target slot.
 * - Only "dirty" instances are re-uploaded to the GPU each frame, which keeps
 *   100 000 elements cheap.
 * - "Numbers" mode draws value labels on a 2D overlay with adaptive sampling,
 *   so the label count stays bounded regardless of element count.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SortOperation, VisualizationMode } from '../types';
import { COLORS, getColorForState, getEmissiveForState } from './colors';

interface InstanceData {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  color: THREE.Color;
  emissive: THREE.Color;
  targetPosition: THREE.Vector3;
  targetScale: THREE.Vector3;
  targetColor: THREE.Color;
  targetEmissive: THREE.Color;
  animationProgress: number;
  isAnimating: boolean;
  /** Real value carried by this instance */
  value: number;
  /** Grid slot this instance currently occupies */
  slot: number;
  /** Transient scale multiplier (pivot highlight), decays back to 1 */
  bump: number;
}

export class SortRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private dummy: THREE.Object3D;
  private instanceData: InstanceData[] = [];
  /** slot -> instance index */
  private instanceAtSlot: number[] = [];
  private elementCount = 0;
  private maxValue = 1;
  private visualizationMode: VisualizationMode = 'cubes';
  private animationFrameId: number | null = null;
  private animationSpeed = 1;

  // Grid layout cache
  private gridCols = 1;
  private gridRows = 1;
  private gridStartX = 0;
  private gridStartZ = 0;
  private gridSpacing = 1.05;

  // Instances whose matrix/color changed since the last GPU upload
  private dirtyIndices = new Set<number>();

  // Camera state for reset
  private initialCameraPosition: THREE.Vector3;
  private initialCameraTarget: THREE.Vector3;
  private cameraResetActive = false;

  // Scene dressing: shadow-catching ground + the light that casts shadows
  private ground!: THREE.Mesh;
  private mainLight!: THREE.DirectionalLight;

  // Compare Mode: when set, animate() renders viewport lanes instead of
  // the main scene (single WebGLRenderer, scissored viewports).
  private compareRenderFn: ((gl: THREE.WebGLRenderer) => void) | null = null;

  // Performance Mode: settle animations faster to shorten per-frame work
  private performanceFast = false;

  // Performance settings
  private maxInstances = 100000;

  // Raycasting for hover (coalesced: at most one raycast per frame)
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoverDirty = false;
  private hoveredIndex: number | null = null;
  private onHoverCallback: ((index: number | null, value: number | null) => void) | null = null;

  // Numbers-mode overlay
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null;
  private labelFrustum = new THREE.Frustum();
  private labelMatrix = new THREE.Matrix4();
  private scratchA = new THREE.Vector3();
  private scratchB = new THREE.Vector3();

  // Callbacks
  private onRenderCallback: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'number-overlay';
    this.overlayCanvas.style.display = 'none';
    this.container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.dummy = new THREE.Object3D();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.initialCameraPosition = new THREE.Vector3();
    this.initialCameraTarget = new THREE.Vector3();

    this.initRenderer();
    this.initScene();
    this.initCamera();
    this.initControls();
    this.initLights();
    this.initEventListeners();
    this.resizeOverlay();
    this.animationFrameId = requestAnimationFrame((time) => this.animate(time));
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = COLORS.BACKGROUND;
    this.scene.fog = new THREE.Fog(COLORS.FOG, 100, 500);

    // Subtle ground plane: catches shadows (adds depth) and gives the
    // grid a visual anchor. Sized with the grid in updateCameraForElementCount.
    const groundGeometry = new THREE.PlaneGeometry(1, 1);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0e14,
      roughness: 0.95,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.5;
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.scene.add(this.ground);
  }

  private initCamera(): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, 40);
    this.camera.lookAt(0, 0, 0);

    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraTarget.set(0, 0, 0);
  }

  private initControls(): void {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minPolarAngle = 0.1;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private initLights(): void {
    // Soft ambient base — enough to read dark faces without washing color
    const ambientLight = new THREE.AmbientLight(COLORS.TEXT_PRIMARY, 0.5);
    this.scene.add(ambientLight);

    // Sky/ground hemisphere for gentle vertical gradient (better depth)
    const hemiLight = new THREE.HemisphereLight(0x9db8d2, 0x1a2230, 0.35);
    this.scene.add(hemiLight);

    // Main directional light (casts the grid's shadows onto the ground)
    const mainLight = new THREE.DirectionalLight(COLORS.TEXT_PRIMARY, 1.8);
    mainLight.position.set(20, 40, 20);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 200;
    mainLight.shadow.camera.left = -50;
    mainLight.shadow.camera.right = 50;
    mainLight.shadow.camera.top = 50;
    mainLight.shadow.camera.bottom = -50;
    mainLight.shadow.bias = -0.001;
    mainLight.shadow.normalBias = 0.02;
    this.scene.add(mainLight);
    this.mainLight = mainLight;

    // Fill light
    const fillLight = new THREE.DirectionalLight(COLORS.ACCENT_PRIMARY, 0.35);
    fillLight.position.set(-20, 20, -20);
    this.scene.add(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(COLORS.ACCENT_SECONDARY, 0.25);
    rimLight.position.set(0, -10, -30);
    this.scene.add(rimLight);

    // Point lights for glow effect
    const pointLight1 = new THREE.PointLight(COLORS.ACCENT_PRIMARY, 0.5, 100);
    pointLight1.position.set(30, 20, 30);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(COLORS.ACCENT_SECONDARY, 0.3, 100);
    pointLight2.position.set(-30, 20, -30);
    this.scene.add(pointLight2);
  }

  private initEventListeners(): void {
    window.addEventListener('resize', () => this.onResize());
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());
  }

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.resizeOverlay();
  }

  private onMouseMove(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    // Raycast at most once per animation frame (mousemove can fire much faster)
    this.hoverDirty = true;
  }

  private processHover(): void {
    if (!this.instancedMesh) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.instancedMesh, false);

    if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
      const index = intersects[0].instanceId;
      if (index !== this.hoveredIndex) {
        this.hoveredIndex = index;
        const data = this.instanceData[index];
        this.onHoverCallback?.(data ? data.slot : index, data ? data.value : null);
      }
    } else if (this.hoveredIndex !== null) {
      this.hoveredIndex = null;
      this.onHoverCallback?.(null, null);
    }
  }

  private onMouseLeave(): void {
    this.hoverDirty = false;
    this.hoveredIndex = null;
    this.onHoverCallback?.(null, null);
  }

  private resizeOverlay(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlayCanvas.width = Math.floor(width * dpr);
    this.overlayCanvas.height = Math.floor(height * dpr);
    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;
    this.overlayCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Initialize or update the instanced mesh with new element count
   */
  setElementCount(count: number): void {
    const clamped = Math.max(1, Math.min(count, this.maxInstances));
    if (clamped === this.elementCount && this.instancedMesh) return;

    this.elementCount = clamped;
    this.recomputeGrid();
    this.createInstancedMesh();
    this.resetInstanceData();
    this.updateCameraForElementCount(true);
  }

  private recomputeGrid(): void {
    this.gridSpacing = this.visualizationMode === 'bars' ? 1.1 : 1.05;
    const n = Math.max(1, this.elementCount);
    this.gridCols = Math.max(1, Math.ceil(Math.sqrt(n)));
    this.gridRows = Math.ceil(n / this.gridCols);
    this.gridStartX = -((this.gridCols - 1) * this.gridSpacing) / 2;
    this.gridStartZ = -((this.gridRows - 1) * this.gridSpacing) / 2;
  }

  private createInstancedMesh(): void {
    // Remove old mesh
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1);

    // Material with custom shader for per-instance colors
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
      vertexColors: false, // We use instance colors
      flatShading: false,
    });

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.elementCount);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.elementCount * 3), 3);
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    (this.instancedMesh.material as THREE.MeshStandardMaterial).transparent = true;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;
    this.instancedMesh.frustumCulled = false; // instances span the whole grid

    this.scene.add(this.instancedMesh);
  }

  private resetInstanceData(): void {
    this.instanceData = [];
    this.instanceAtSlot = [];
    this.dirtyIndices.clear();

    for (let i = 0; i < this.elementCount; i++) {
      const x = this.gridStartX + (i % this.gridCols) * this.gridSpacing;
      const z = this.gridStartZ + Math.floor(i / this.gridCols) * this.gridSpacing;

      const data: InstanceData = {
        position: new THREE.Vector3(x, 0, z),
        scale: new THREE.Vector3(1, 1, 1),
        color: COLORS.DEFAULT.clone(),
        emissive: COLORS.DEFAULT.clone(),
        targetPosition: new THREE.Vector3(x, 0, z),
        targetScale: new THREE.Vector3(1, 1, 1),
        targetColor: COLORS.DEFAULT.clone(),
        targetEmissive: COLORS.DEFAULT.clone(),
        animationProgress: 1,
        isAnimating: false,
        value: 0,
        slot: i,
        bump: 1,
      };
      this.instanceData.push(data);
      this.instanceAtSlot.push(i);
      this.dirtyIndices.add(i);
    }
  }

  private updateCameraForElementCount(refit = false): void {
    const width = this.gridCols * this.gridSpacing;
    const depth = this.gridRows * this.gridSpacing;
    const maxDim = Math.max(width, depth);

    const distance = maxDim * 1.35 + 18;
    this.controls.maxDistance = distance * 3;
    this.controls.minDistance = Math.max(5, maxDim * 0.25);

    // Scale fog and far plane with the scene so large grids stay visible
    this.camera.far = Math.max(1000, distance * 4);
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = distance * 0.9;
      this.scene.fog.far = distance * 3;
    }

    // Ground follows the grid: size covers it, height sits just below the
    // elements of the active mode (cubes are centered on y=0, bars stand
    // on y=0), so shadows land on a visible surface at any element count.
    const groundSize = maxDim * 2 + 40;
    this.ground.scale.set(groundSize, groundSize, 1);
    this.ground.position.y = this.visualizationMode === 'cubes' ? -0.52 : -0.02;

    // Shadow frustum must cover the whole grid at every scale
    const shadowExtent = Math.max(60, maxDim * 0.8);
    const shadowCam = this.mainLight.shadow.camera;
    shadowCam.left = -shadowExtent;
    shadowCam.right = shadowExtent;
    shadowCam.top = shadowExtent;
    shadowCam.bottom = -shadowExtent;
    shadowCam.far = Math.max(200, shadowExtent * 3);
    shadowCam.updateProjectionMatrix();

    if (refit) {
      // Frame the whole grid from a pleasing angle
      this.camera.position.set(0, distance * 0.42, distance * 0.9);
      this.controls.target.set(0, 0, 0);
      this.initialCameraPosition.copy(this.camera.position);
      this.initialCameraTarget.copy(this.controls.target);
      this.controls.update();
    }
  }

  /**
   * Set visualization mode (cubes, bars, numbers)
   */
  setVisualizationMode(mode: VisualizationMode): void {
    if (mode === this.visualizationMode) return;
    this.visualizationMode = mode;
    this.recomputeGrid();
    this.createInstancedMesh();
    this.updateCameraForElementCount(false);

    // Presentation-only: keep each instance's logical state (value, slot,
    // owner mapping, colors) and only re-derive the geometry for the new
    // mode. Resetting here would desync a running operation replay and
    // corrupt the final displayed array.
    for (let i = 0; i < this.instanceData.length; i++) {
      const data = this.instanceData[i];
      this.applyModeScale(data);
      this.refreshTargetPosition(data);
      // Morph smoothly from the old mode's geometry to the new one
      data.isAnimating = true;
      data.animationProgress = 0;
      this.dirtyIndices.add(i);
    }
    this.applyTransforms(); // upload into the freshly created mesh

    const showOverlay = mode === 'numbers' && !this.compareRenderFn;
    this.overlayCanvas.style.display = showOverlay ? 'block' : 'none';
    if (showOverlay) this.resizeOverlay();
  }

  /**
   * Target scale for the current visualization mode, derived from the
   * value (ground height follows from refreshTargetPosition).
   */
  private applyModeScale(data: InstanceData): void {
    const normalized = this.maxValue > 0 ? data.value / this.maxValue : 0;

    if (this.visualizationMode === 'bars') {
      // Wider dynamic range (0.4 → 10) makes height differences read at a glance
      data.targetScale.set(0.8, 0.4 + normalized * 9.6, 0.8);
    } else if (this.visualizationMode === 'numbers') {
      data.targetScale.set(0.85, 0.35, 0.85);
    } else {
      data.targetScale.set(0.95, 0.95, 0.95);
    }
  }

  /**
   * Derive scale / ground height / value color from the instance's value.
   */
  private applyPresentation(data: InstanceData): void {
    this.applyModeScale(data);

    const normalized = this.maxValue > 0 ? data.value / this.maxValue : 0;
    const hue = 0.6 * (1 - normalized); // Blue to red
    data.targetColor.setHSL(hue, 0.7, 0.45);
    data.targetEmissive.setHex(0x000000);
  }

  /**
   * Recompute the instance's grid XZ (and ground Y) from its current slot.
   */
  private refreshTargetPosition(data: InstanceData): void {
    data.targetPosition.x = this.gridStartX + (data.slot % this.gridCols) * this.gridSpacing;
    data.targetPosition.z = this.gridStartZ + Math.floor(data.slot / this.gridCols) * this.gridSpacing;
    data.targetPosition.y = this.visualizationMode === 'cubes' ? 0 : data.targetScale.y / 2;
  }

  /**
   * Update array values and positions
   */
  updateArray(values: number[]): void {
    if (!this.instancedMesh || values.length === 0) return;

    // Loop instead of Math.max(...values): spreading 100 000 arguments
    // overflows the call stack.
    let maxValue = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > maxValue) maxValue = values[i];
    }
    this.maxValue = maxValue > 0 ? maxValue : 1;

    // Fresh layout: instances map 1:1 to slots again
    for (let i = 0; i < this.elementCount; i++) {
      this.instanceAtSlot[i] = i;
    }

    const count = Math.min(values.length, this.elementCount);
    for (let i = 0; i < count; i++) {
      const data = this.instanceData[i];
      if (!data) continue;

      data.value = values[i];
      data.slot = i;
      data.bump = 1;
      this.applyPresentation(data);
      this.refreshTargetPosition(data);

      // Animate from the current state to the fresh layout
      data.isAnimating = true;
      data.animationProgress = 0;
      this.dirtyIndices.add(i);
    }

    this.applyTransforms();
  }

  /**
   * Apply operations from the algorithm
   */
  applyOperations(operations: SortOperation[]): void {
    if (!this.instancedMesh) return;

    for (const op of operations) {
      this.applyOperation(op);
    }

    this.applyTransforms();
  }

  private setState(instanceIndex: number, state: string, bump?: number): void {
    const data = this.instanceData[instanceIndex];
    if (!data) return;
    data.targetColor.copy(getColorForState(state));
    data.targetEmissive.copy(getEmissiveForState(state));
    // Optional scale pop — strongest for the pivot, subtle for compares
    if (bump !== undefined) data.bump = Math.max(data.bump, bump);
    data.isAnimating = true;
    data.animationProgress = 0;
    this.dirtyIndices.add(instanceIndex);
  }

  private applyOperation(op: SortOperation): void {
    const { indices, type } = op;
    const owner = this.instanceAtSlot;
    const valid = (slot: number) => slot >= 0 && slot < owner.length;

    switch (type) {
      case 'compare':
        for (const slot of indices) {
          if (valid(slot)) this.setState(owner[slot], 'comparing', 1.08);
        }
        break;

      case 'swap': {
        if (indices.length === 2 && valid(indices[0]) && valid(indices[1])) {
          const [i, j] = indices;
          const a = owner[i];
          const b = owner[j];
          if (a === b) break;

          const dataA = this.instanceData[a];
          const dataB = this.instanceData[b];

          // Instances exchange slots; values stay with their instance,
          // so the two elements really move and the slot values swap.
          const slotA = dataA.slot;
          dataA.slot = dataB.slot;
          dataB.slot = slotA;
          owner[i] = b;
          owner[j] = a;
          this.refreshTargetPosition(dataA);
          this.refreshTargetPosition(dataB);

          this.setState(a, 'swapping', 1.18);
          this.setState(b, 'swapping', 1.18);
        }
        break;
      }

      case 'move':
      case 'overwrite': {
        // move: [from, to]  overwrite: [index] -> write target is the last index
        const slot = indices[indices.length - 1];
        const value = op.values && op.values.length > 0 ? op.values[0] : undefined;
        if (valid(slot) && value !== undefined) {
          const instance = owner[slot];
          const data = this.instanceData[instance];
          data.value = value;
          this.applyPresentation(data);
          this.refreshTargetPosition(data);
          this.setState(instance, 'swapping', 1.15);
        }
        break;
      }

      case 'pivot':
        for (const slot of indices) {
          if (valid(slot)) {
            // Distinctive pop — decays back to 1 in applyTransforms
            this.setState(owner[slot], 'pivot', 1.4);
          }
        }
        break;

      case 'heapify':
        for (const slot of indices) {
          if (valid(slot)) this.setState(owner[slot], 'range');
        }
        break;

      case 'merge':
        if (indices.length >= 4) {
          const [leftStart, leftEnd, rightStart, rightEnd] = indices;
          for (let s = leftStart; s <= leftEnd; s++) {
            if (valid(s)) this.setState(owner[s], 'merged');
          }
          for (let s = rightStart; s <= rightEnd; s++) {
            if (valid(s)) this.setState(owner[s], 'merged');
          }
        }
        break;

      case 'mark-sorted':
        for (const slot of indices) {
          if (valid(slot)) this.setState(owner[slot], 'sorted');
        }
        break;

      case 'mark-range':
        if (indices.length === 2) {
          const [start, end] = indices;
          for (let s = start; s <= end; s++) {
            if (valid(s)) this.setState(owner[s], 'range');
          }
        }
        break;
    }
  }

  /**
   * Upload dirty instances to the GPU (matrices + colors) and advance
   * their animations. Only dirty instances are touched, so cost is
   * proportional to activity, not to element count.
   */
  private applyTransforms(): void {
    if (!this.instancedMesh) return;

    const colorAttr = this.instancedMesh.instanceColor as THREE.InstancedBufferAttribute;
    const colorArray = colorAttr.array as Float32Array;

    for (const i of this.dirtyIndices) {
      const data = this.instanceData[i];
      if (!data) {
        this.dirtyIndices.delete(i);
        continue;
      }

      // Highlight pop: widen on X/Z only so bar heights and ground
      // contact stay stable while the element glows.
      if (data.bump !== 1) {
        data.bump += (1 - data.bump) * (this.performanceFast ? 0.3 : 0.1);
        if (Math.abs(1 - data.bump) < 0.01) data.bump = 1;
      }
      this.scratchA.copy(data.targetScale);
      if (data.bump !== 1) {
        this.scratchA.x *= data.bump;
        this.scratchA.z *= data.bump;
      }

      if (data.isAnimating) {
        const step = (this.performanceFast ? 0.6 : 0.15) * this.animationSpeed;
        data.animationProgress = Math.min(1, data.animationProgress + step);
        const t = this.easeOutCubic(data.animationProgress);
        data.position.lerp(data.targetPosition, t);
        data.scale.lerp(this.scratchA, t);
        data.color.lerp(data.targetColor, t);
        data.emissive.lerp(data.targetEmissive, t);

        if (data.animationProgress >= 1) {
          data.isAnimating = false;
          data.position.copy(data.targetPosition);
          data.scale.copy(this.scratchA);
          data.color.copy(data.targetColor);
          data.emissive.copy(data.targetEmissive);
        }
      } else {
        data.position.copy(data.targetPosition);
        data.scale.copy(this.scratchA);
        data.color.copy(data.targetColor);
        data.emissive.copy(data.targetEmissive);
      }

      // Build matrix
      this.dummy.position.copy(data.position);
      this.dummy.scale.copy(data.scale);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

      // Set color
      colorArray[i * 3] = data.color.r;
      colorArray[i * 3 + 1] = data.color.g;
      colorArray[i * 3 + 2] = data.color.b;

      if (!data.isAnimating && data.bump === 1) {
        this.dirtyIndices.delete(i);
      }
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Mark elements as sorted (final state)
   */
  markSorted(indices: number[]): void {
    if (!this.instancedMesh) return;
    for (const slot of indices) {
      if (slot >= 0 && slot < this.instanceAtSlot.length) {
        this.setState(this.instanceAtSlot[slot], 'sorted');
      }
    }
  }

  /**
   * Reset all elements to default state
   */
  reset(): void {
    for (let i = 0; i < this.instanceData.length; i++) {
      const data = this.instanceData[i];
      data.targetColor.copy(COLORS.DEFAULT);
      data.targetEmissive.copy(COLORS.DEFAULT);
      data.targetScale.set(1, 1, 1);
      data.bump = 1;
      data.isAnimating = true;
      data.animationProgress = 0;
      this.dirtyIndices.add(i);
    }
    this.applyTransforms();
  }

  /**
   * Reset camera to initial position (animated)
   */
  resetCamera(): void {
    this.cameraResetActive = true;
  }

  /**
   * Draw value labels for "numbers" mode on the 2D overlay.
   * The grid is sampled so neighbouring labels stay >= ~40px apart:
   * zooming in reveals more detail while the label count stays bounded.
   */
  private renderNumberLabels(): void {
    const ctx = this.overlayCtx;
    if (!ctx || !this.instancedMesh) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    // Screen-space size of one grid slot measured at the scene center
    this.scratchA.set(0, 0, 0).project(this.camera);
    this.scratchB.set(this.gridSpacing, 0, 0).project(this.camera);
    if (this.scratchA.z > 1 || this.scratchB.z > 1) return;
    const px = Math.hypot(
      (this.scratchB.x - this.scratchA.x) * width * 0.5,
      (this.scratchB.y - this.scratchA.y) * height * 0.5
    );
    if (!isFinite(px) || px <= 0.5) return;

    const stride = Math.max(1, Math.ceil(44 / px));
    const fontSize = Math.max(11, Math.min(18, px * 0.5));
    const maxLabelDistanceSq = 400 * 400;

    ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, fontSize * 0.3);
    ctx.strokeStyle = 'rgba(8, 11, 16, 0.95)';
    ctx.fillStyle = 'rgba(241, 246, 250, 1)';

    this.camera.updateMatrixWorld();
    this.labelMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.labelFrustum.setFromProjectionMatrix(this.labelMatrix);

    const camPos = this.camera.position;

    for (let row = 0; row < this.gridRows; row += stride) {
      for (let col = 0; col < this.gridCols; col += stride) {
        const slot = row * this.gridCols + col;
        if (slot >= this.elementCount) break;

        const instance = this.instanceAtSlot[slot];
        const data = this.instanceData[instance];
        if (!data) continue;

        this.scratchA.set(data.position.x, data.position.y + data.scale.y / 2 + 0.45, data.position.z);
        if (camPos.distanceToSquared(this.scratchA) > maxLabelDistanceSq) continue;
        if (!this.labelFrustum.containsPoint(this.scratchA)) continue;

        this.scratchA.project(this.camera);
        const sx = (this.scratchA.x * 0.5 + 0.5) * width;
        const sy = (-this.scratchA.y * 0.5 + 0.5) * height;
        if (sx < -30 || sx > width + 30 || sy < -16 || sy > height + 16) continue;

        const label = String(data.value);
        ctx.strokeText(label, sx, sy);
        ctx.fillText(label, sx, sy);
      }
    }
  }

  /**
   * Animation loop
   */
  private animate = (_time: number): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Benchmark Lab view: keep the loop alive (cheap re-registration) but
    // skip ALL GPU/scene work so the 3D scene never competes with the lab.
    if (this.suspended) return;

    this.controls.update();

    if (this.cameraResetActive) {
      this.camera.position.lerp(this.initialCameraPosition, 0.15);
      this.controls.target.lerp(this.initialCameraTarget, 0.15);
      if (this.camera.position.distanceTo(this.initialCameraPosition) < 0.5) {
        this.camera.position.copy(this.initialCameraPosition);
        this.controls.target.copy(this.initialCameraTarget);
        this.cameraResetActive = false;
      }
      this.controls.update();
    }

    if (this.hoverDirty) {
      this.hoverDirty = false;
      if (!this.compareRenderFn) this.processHover();
    }

    if (this.dirtyIndices.size > 0) {
      this.applyTransforms();
    }

    if (this.compareRenderFn) {
      // Compare Mode: the lanes own the screen — scissored viewports
      // inside the single shared WebGL context (main scene is skipped).
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.setClearColor(COLORS.BACKGROUND, 1);
      this.renderer.clear();
      this.compareRenderFn(this.renderer);
      // Restore full-viewport state for normal rendering next frame
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.onRenderCallback?.();
      return;
    }

    this.renderer.render(this.scene, this.camera);

    if (this.visualizationMode === 'numbers') {
      this.renderNumberLabels();
    }

    this.onRenderCallback?.();
  };

  /**
   * Set hover callback
   */
  onHover(callback: (index: number | null, value: number | null) => void): void {
    this.onHoverCallback = callback;
  }

  /**
   * Set render callback
   */
  onRender(callback: () => void): void {
    this.onRenderCallback = callback;
  }

  /**
   * Get camera for external control
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Get controls for external control
   */
  getControls(): OrbitControls {
    return this.controls;
  }

  /**
   * Compare Mode: supply a renderer callback that draws viewport lanes
   * (scissored) instead of the main scene; pass null to go back.
   * Also disables orbit/hover/numbers overlay while lanes own the screen.
   */
  setCompareRenderFn(fn: ((gl: THREE.WebGLRenderer) => void) | null): void {
    this.compareRenderFn = fn;
    const active = fn !== null;
    this.controls.enabled = !active;
    this.overlayCanvas.style.display = active
      ? 'none'
      : this.visualizationMode === 'numbers' ? 'block' : 'none';
    if (active) {
      this.hoverDirty = false;
      if (this.hoveredIndex !== null) {
        this.hoveredIndex = null;
        this.onHoverCallback?.(null, null);
      }
    }
  }

  /**
   * Performance Mode: settle animations in ~2 frames instead of ~7 to
   * shorten per-frame CPU/GPU work on very large arrays, and drop the
   * shadow pass (it re-renders the whole scene every frame) so frame
   * time stays flat at 25 000 – 100 000 elements.
   */
  setPerformanceMode(fast: boolean): void {
    this.performanceFast = fast;
    const shadows = !fast;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      if (this.instancedMesh) {
        this.instancedMesh.castShadow = shadows;
        this.instancedMesh.receiveShadow = shadows;
      }
      this.ground.receiveShadow = shadows;
      // materials must recompile for the changed lighting path
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => (m.needsUpdate = true));
        }
      });
    }
  }

  /**
   * Benchmark Lab view: suspend all rendering work (single flag, no extra
   * WebGL context, no leaked state). The rAF chain stays alive but returns
   * immediately; resuming restores the exact previous scene.
   */
  private suspended = false;

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.controls.dispose();
    this.renderer.dispose();
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
    }
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.scene.clear();
    if (this.overlayCanvas.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    }
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  /**
   * Get current element count
   */
  getElementCount(): number {
    return this.elementCount;
  }

  /**
   * Get visualization mode
   */
  getVisualizationMode(): VisualizationMode {
    return this.visualizationMode;
  }

  /**
   * Set animation speed
   */
  setAnimationSpeed(speed: number): void {
    this.animationSpeed = Math.max(0.1, speed);
  }
}

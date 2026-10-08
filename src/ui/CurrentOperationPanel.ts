/**
 * Current Operation Panel UI Component
 */

import type { SortOperation } from '../types';

interface OperationElements {
  operationType: HTMLElement;
  operationDetails: HTMLElement;
  indices: HTMLElement;
  operationValues: HTMLElement;
}

export class CurrentOperationPanel {
  private container: HTMLElement;
  private elements: OperationElements = {} as OperationElements;
  private updateThrottle = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.cacheElements();
    this.reset();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="operation-panel">
        <h2>CURRENT OPERATION</h2>
        <div class="operation-content">
          <div class="operation-type" id="op-type">—</div>
          <div class="operation-details" id="op-details">—</div>
          <div class="operation-indices" id="op-indices"></div>
          <div class="operation-values" id="op-values"></div>
        </div>
      </div>
    `;
  }

  private cacheElements(): void {
    this.elements = {
      operationType: this.container.querySelector('#op-type')!,
      operationDetails: this.container.querySelector('#op-details')!,
      indices: this.container.querySelector('#op-indices')!,
      operationValues: this.container.querySelector('#op-values')!,
    };
  }

  update(operations: SortOperation[]): void {
    if (operations.length === 0) return;

    // Throttle updates to avoid UI overwhelm
    this.updateThrottle++;
    if (this.updateThrottle % 3 !== 0) return;

    // Get the most recent meaningful operation
    const op = operations[operations.length - 1];
    this.renderOperation(op);
  }

  private renderOperation(op: SortOperation): void {
    const { type, indices, values, metadata } = op;

    let typeLabel = '';
    let details = '';

    switch (type) {
      case 'compare':
        typeLabel = 'COMPARING';
        details = `${indices[0]} ↔ ${indices[1]}`;
        break;
      case 'swap':
        typeLabel = 'SWAPPING';
        details = `${indices[0]} ⇄ ${indices[1]}`;
        break;
      case 'move':
        typeLabel = 'MOVING';
        details = `${indices[0]} → ${indices[1]}`;
        break;
      case 'overwrite':
        typeLabel = 'OVERWRITING';
        details = `index ${indices[0]}`;
        break;
      case 'pivot':
        typeLabel = 'PIVOT SELECTED';
        details = `index ${indices[0]}`;
        break;
      case 'heapify':
        typeLabel = 'HEAPIFY';
        details = `index ${indices[0]}`;
        break;
      case 'merge': {
        typeLabel = 'MERGING';
        const leftRange = metadata?.leftRange as [number, number] | undefined;
        const rightRange = metadata?.rightRange as [number, number] | undefined;
        if (leftRange && rightRange) {
          details = `[${leftRange[0]}..${leftRange[1]}] + [${rightRange[0]}..${rightRange[1]}]`;
        } else {
          details = `indices ${indices[0]}..${indices[3]}`;
        }
        break;
      }
      case 'mark-sorted':
        typeLabel = 'MARKED SORTED';
        details = `index ${indices[0]}`;
        break;
      case 'mark-range':
        typeLabel = 'PROCESSING RANGE';
        details = `${indices[0]} .. ${indices[1]}`;
        break;
      default:
        typeLabel = String(type).toUpperCase();
        details = indices.join(', ');
    }

    this.elements.operationType.textContent = typeLabel;
    this.elements.operationType.className = `operation-type op-${type}`;

    if (values && values.length > 0) {
      const vals = values.slice(0, 4).join(', ') + (values.length > 4 ? '...' : '');
      this.elements.operationValues.textContent = `Values: [${vals}]`;
    } else {
      this.elements.operationValues.textContent = '';
    }

    this.elements.operationDetails.textContent = details;
    this.elements.indices.textContent = `Indices: [${indices.join(', ')}]`;
  }

  setIdle(): void {
    this.elements.operationType.textContent = '—';
    this.elements.operationType.className = 'operation-type';
    this.elements.operationDetails.textContent = 'Waiting for sort to start...';
    this.elements.indices.textContent = '';
    this.elements.operationValues.textContent = '';
  }

  setCompleted(): void {
    this.elements.operationType.textContent = 'COMPLETED';
    this.elements.operationType.className = 'operation-type op-completed';
    this.elements.operationDetails.textContent = 'Array is fully sorted';
    this.elements.indices.textContent = '';
    this.elements.operationValues.textContent = '';
  }

  reset(): void {
    this.setIdle();
  }
}
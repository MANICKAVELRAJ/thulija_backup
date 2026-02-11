import { Component, ViewChild, ElementRef, OnInit, Inject, PLATFORM_ID, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';

interface DraggableItem {
  id: number;
  label: string;
  position: { x: number; y: number };
  type: 'action1' | 'action2' | 'continue' | 'reject';
  properties?: WorkflowProperties;
}

interface WorkflowProperties {
  [key: string]: any;
  sequence?: number;
  name?: string;
  input_property_name_id?: number;
  input_property_value?: string;
  return_input_property_value?: string | null;
  work_flow_action_id?: number;
  reject_action_id?: number | null;
  output_property_name_id?: number;
  output_property_value?: string;
  output_property_query_by?: string | null;
  output_property_reject_value?: string | null;
  output_property_reject_query_by?: string | null;
  output_property_onwards_query_by?: string | null;
  execute?: string;
  work_flow_access_level_id?: number;
  createdby?: number;
  createddate?: string;
  lastmodifiedby?: number | null;
  lastmodifieddate?: string | null;
  position?: { x: number; y: number };
}

interface Arrow {
  from: DraggableItem;
  to: DraggableItem;
  path: string;
}

interface SavedState {
  items: DraggableItem[];
  arrows: { fromId: number; toId: number }[];
  nextId: number;
}

interface HistoryState {
  items: DraggableItem[];
  arrows: { fromId: number; toId: number }[];
  nextId: number;
  sequenceCounter: number;
  lastCreatedItemId: number | null;
}

@Component({
  selector: 'app-featuresadded',
  templateUrl: './featuresadded.component.html',
  styleUrl: './featuresadded.component.css'
})
export class FeaturesaddedComponent {
  @ViewChild('scrollContainer') scrollContainerRef!: ElementRef<HTMLDivElement>;

  isExpanded = true;
  propertyPanelOpen = false;
  selectedItem: DraggableItem | null = null;
  propertyForm: WorkflowProperties = {};

  items: DraggableItem[] = [];
  arrows: Arrow[] = [];
  workflowData: any[] = [];

  canvasWidth = 3200;
  canvasHeight = 3200;

  private draggedItem: DraggableItem | null = null;
  private offset = { x: 0, y: 0 };
  private isDragging = false;
  private nextId = 1;
  private lastCreatedItem: DraggableItem | null = null;
  private linkedButtons: DraggableItem[] = [];
  private clickTimeout: any = null;
  private sequenceCounter = 1;
  private isBrowser: boolean;

  // Undo/Redo history
  private history: HistoryState[] = [];
  private historyIndex: number = -1;
  private maxHistorySize: number = 50;
  private isRestoringState: boolean = false;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    this.loadWorkflowData();
    this.loadSavedState();
    this.saveToHistory(); // Save initial state
  }

  // Keyboard event handler
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Delete key - delete selected item
    if (event.key === 'Delete' && this.selectedItem && !this.isRestoringState) {
      event.preventDefault();
      this.deleteSelectedItem();
    }

    // Ctrl+Z - Undo
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    }

    // Ctrl+Y or Ctrl+Shift+Z - Redo
    if ((event.ctrlKey && event.key === 'y') || (event.ctrlKey && event.shiftKey && event.key === 'z')) {
      event.preventDefault();
      this.redo();
    }

    // F11 - Toggle fullscreen
    if (event.key === 'F11') {
      event.preventDefault();
      this.toggleFullscreen();
    }

    // Escape - Exit fullscreen
    if (event.key === 'Escape' && this.isFullscreen()) {
      this.exitFullscreen();
    }
  }

  // Delete selected item
  deleteSelectedItem() {
    if (!this.selectedItem || this.isRestoringState) return;

    const itemToDelete = this.selectedItem;
    
    // Close property panel first
    this.closePropertyPanel();

    // Find all items connected to this item
    const connectedItemIds = new Set<number>();
    
    // If deleting an Action 2, find its Continue and Reject buttons
    if (itemToDelete.type === 'action2') {
      this.arrows.forEach(arrow => {
        if (arrow.from.id === itemToDelete.id) {
          connectedItemIds.add(arrow.to.id);
        }
      });
    }

    // Remove arrows connected to the item
    this.arrows = this.arrows.filter(arrow => {
      const shouldRemove = arrow.from.id === itemToDelete.id || 
                          arrow.to.id === itemToDelete.id ||
                          connectedItemIds.has(arrow.from.id) ||
                          connectedItemIds.has(arrow.to.id);
      return !shouldRemove;
    });

    // Remove connected items (Continue/Reject buttons)
    this.items = this.items.filter(item => !connectedItemIds.has(item.id));

    // Remove the main item
    this.items = this.items.filter(item => item.id !== itemToDelete.id);

    // Rebuild arrows with proper references
    this.rebuildArrowReferences();

    // Update lastCreatedItem if necessary
    if (this.lastCreatedItem?.id === itemToDelete.id || connectedItemIds.has(this.lastCreatedItem?.id || -1)) {
      // Find the last valid item that's not a reject button
      const validItems = this.items.filter(item => item.type !== 'reject');
      this.lastCreatedItem = validItems.length > 0 ? validItems[validItems.length - 1] : null;
    }

    this.updateAllArrows();
    this.saveState();
    this.saveToHistory();
  }

  // Undo/Redo functionality
  private saveToHistory() {
    if (this.isRestoringState) return;

    // Remove any states after current index (for redo)
    this.history = this.history.slice(0, this.historyIndex + 1);

    // Create deep copy of current state with proper serialization
    const state: HistoryState = {
      items: this.items.map(item => ({
        id: item.id,
        label: item.label,
        position: { x: item.position.x, y: item.position.y },
        type: item.type,
        properties: item.properties ? JSON.parse(JSON.stringify(item.properties)) : undefined
      })),
      arrows: this.arrows.map(arrow => ({
        fromId: arrow.from.id,
        toId: arrow.to.id
      })),
      nextId: this.nextId,
      sequenceCounter: this.sequenceCounter,
      lastCreatedItemId: this.lastCreatedItem?.id || null
    };

    this.history.push(state);
    this.historyIndex++;

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.historyIndex--;
    }

    // console.log('History saved. Index:', this.historyIndex, 'Items:', this.items.length);
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreState(this.history[this.historyIndex]);
      console.log('Undo - Index:', this.historyIndex);
    } else {
      console.log('Cannot undo - at beginning of history');
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreState(this.history[this.historyIndex]);
      console.log('Redo - Index:', this.historyIndex);
    } else {
      console.log('Cannot redo - at end of history');
    }
  }

  private restoreState(state: HistoryState) {
    this.isRestoringState = true;

    try {
      // Close property panel
      this.closePropertyPanel();

      // Restore basic state
      this.nextId = state.nextId;
      this.sequenceCounter = state.sequenceCounter;

      // Deep copy items with all properties
      this.items = state.items.map(item => ({
        id: item.id,
        label: item.label,
        position: { x: item.position.x, y: item.position.y },
        type: item.type,
        properties: item.properties ? JSON.parse(JSON.stringify(item.properties)) : undefined
      }));

      // Clear existing arrows
      this.arrows = [];

      // Restore arrows with proper item references
      state.arrows.forEach(arrowData => {
        const fromItem = this.items.find(i => i.id === arrowData.fromId);
        const toItem = this.items.find(i => i.id === arrowData.toId);
        if (fromItem && toItem) {
          this.arrows.push({ from: fromItem, to: toItem, path: '' });
        }
      });

      // Restore lastCreatedItem
      if (state.lastCreatedItemId) {
        this.lastCreatedItem = this.items.find(i => i.id === state.lastCreatedItemId) || null;
      } else {
        this.lastCreatedItem = null;
      }

      // Update all arrow paths
      this.updateAllArrows();

      // Save to localStorage
      this.saveState();

      console.log('State restored. Items:', this.items.length, 'Arrows:', this.arrows.length);
    } finally {
      this.isRestoringState = false;
    }
  }

  private rebuildArrowReferences() {
    // Rebuild arrows to ensure they reference the correct item objects
    const newArrows: Arrow[] = [];
    
    this.arrows.forEach(arrow => {
      const fromItem = this.items.find(i => i.id === arrow.from.id);
      const toItem = this.items.find(i => i.id === arrow.to.id);
      
      if (fromItem && toItem) {
        newArrows.push({ from: fromItem, to: toItem, path: arrow.path });
      }
    });
    
    this.arrows = newArrows;
  }

  // Fullscreen functionality
  toggleFullscreen() {
    if (!this.isBrowser) return;

    if (!this.isFullscreen()) {
      this.enterFullscreen();
    } else {
      this.exitFullscreen();
    }
  }

  private enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if ((elem as any).webkitRequestFullscreen) {
      (elem as any).webkitRequestFullscreen();
    } else if ((elem as any).msRequestFullscreen) {
      (elem as any).msRequestFullscreen();
    }
  }

  private exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  }

  private isFullscreen(): boolean {
    return !!(document.fullscreenElement || 
              (document as any).webkitFullscreenElement || 
              (document as any).msFullscreenElement);
  }

  loadWorkflowData() {
    this.http.get<any[]>('assets/workflowprocess.json').subscribe(
      data => {
        this.workflowData = data;
      },
      error => {
        console.error('Error loading workflow data:', error);
      }
    );
  }

  loadSavedState() {
    if (!this.isBrowser) {
      return;
    }

    try {
      const savedState = localStorage.getItem('workflowState');
      if (savedState) {
        const state: SavedState = JSON.parse(savedState);
        this.items = state.items;
        this.nextId = state.nextId;
        
        this.arrows = [];
        state.arrows.forEach(arrowData => {
          const fromItem = this.items.find(i => i.id === arrowData.fromId);
          const toItem = this.items.find(i => i.id === arrowData.toId);
          if (fromItem && toItem) {
            this.createArrow(fromItem, toItem);
          }
        });
        
        if (this.items.length > 0) {
          const lastItem = this.items[this.items.length - 1];
          if (lastItem.type !== 'reject') {
            this.lastCreatedItem = lastItem;
          }
        }

        const maxSeq = Math.max(...this.items.map(i => i.properties?.sequence || 0), 0);
        this.sequenceCounter = maxSeq + 1;

        this.updateAllArrows();
        console.log('State loaded from localStorage');
      }
    } catch (e) {
      console.error('Error loading saved state:', e);
    }
  }

  saveState() {
    if (!this.isBrowser || this.isRestoringState) {
      return;
    }

    try {
      this.items.forEach(item => {
        if (item.properties) {
          item.properties.position = { ...item.position };
        }
      });

      const arrowData = this.arrows.map(arrow => ({
        fromId: arrow.from.id,
        toId: arrow.to.id
      }));

      const state: SavedState = {
        items: this.items,
        arrows: arrowData,
        nextId: this.nextId
      };

      localStorage.setItem('workflowState', JSON.stringify(state));
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }

  toggleSidenav() {
    this.isExpanded = !this.isExpanded;
    setTimeout(() => this.updateAllArrows(), 320);
  }

  private getSidenavWidth(): number {
    if (window.innerWidth <= 768) {
      return this.isExpanded ? 72 : 0;
    }
    return this.isExpanded ? 240 : 72;
  }

  onToolbarButtonMouseDown(event: MouseEvent, label: string) {
    if (this.isRestoringState) return;
    
    event.preventDefault();

    const scrollEl = this.scrollContainerRef?.nativeElement;
    const scrollLeft = scrollEl?.scrollLeft ?? 0;
    const scrollTop = scrollEl?.scrollTop ?? 0;

    const position = { x: scrollLeft + 120, y: scrollTop + 120 };

    const newItem: DraggableItem = {
      id: this.nextId++,
      label,
      position: { ...position },
      type: label === 'Action 1' ? 'action1' : 'action2',
      properties: this.getDefaultProperties(label, position)
    };

    this.items.push(newItem);

    if (this.lastCreatedItem) {
      this.createArrow(this.lastCreatedItem, newItem);
    }

    this.linkedButtons = [];

    if (label === 'Action 2') {
      const continuePos = { x: newItem.position.x + 240, y: newItem.position.y - 70 };
      const rejectPos = { x: newItem.position.x + 240, y: newItem.position.y + 70 };

      const continueBtn: DraggableItem = {
        id: this.nextId++,
        label: 'Continue',
        position: { ...continuePos },
        type: 'continue',
        properties: this.getDefaultProperties('Continue', continuePos)
      };

      const rejectBtn: DraggableItem = {
        id: this.nextId++,
        label: 'Reject',
        position: { ...rejectPos },
        type: 'reject',
        properties: { position: { ...rejectPos } }
      };

      this.items.push(continueBtn, rejectBtn);

      this.createArrow(newItem, continueBtn);
      this.createArrow(newItem, rejectBtn);

      this.linkedButtons = [continueBtn, rejectBtn];
      this.lastCreatedItem = continueBtn;
    } else {
      this.lastCreatedItem = newItem;
    }

    this.updateAllArrows();
    this.saveState();
    this.saveToHistory();
    this.startDragging(newItem, event);
  }

  private getDefaultProperties(label: string, position: { x: number; y: number }): WorkflowProperties {
    const matchingData = this.workflowData.find(w => w.sequence === this.sequenceCounter);
    
    if (matchingData) {
      const props = { ...matchingData };
      delete props.id;
      delete props.project_id;
      delete props.logical_module_id;
      delete props.page_id;
      
      props.position = { ...position };
      
      this.sequenceCounter++;
      return props;
    }

    return {
      sequence: this.sequenceCounter++,
      name: label,
      input_property_name_id: 0,
      input_property_value: '',
      return_input_property_value: null,
      work_flow_action_id: 0,
      reject_action_id: null,
      output_property_name_id: 0,
      output_property_value: '',
      output_property_query_by: null,
      output_property_reject_value: null,
      output_property_reject_query_by: null,
      output_property_onwards_query_by: null,
      execute: '',
      work_flow_access_level_id: 0,
      createdby: 1,
      createddate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      lastmodifiedby: null,
      lastmodifieddate: null,
      position: { ...position }
    };
  }

  onMouseDown(event: MouseEvent, item: DraggableItem) {
    if (this.isRestoringState) return;
    
    event.preventDefault();
    
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }

    this.clickTimeout = setTimeout(() => {
      if (!this.isDragging) {
        this.onItemClick(item);
      }
      this.clickTimeout = null;
    }, 200);

    this.linkedButtons = [];
    
    // If dragging an Action 2, also drag its linked buttons
    if (item.type === 'action2') {
      const linkedItems = this.arrows
        .filter(arrow => arrow.from.id === item.id)
        .map(arrow => arrow.to);
      this.linkedButtons = linkedItems;
    }
    
    this.startDragging(item, event);
  }

  onItemClick(item: DraggableItem) {
    this.selectedItem = item;
    
    if (item.type === 'reject') {
      return;
    }

    this.propertyForm = { ...item.properties };
    this.propertyPanelOpen = true;
  }

  closePropertyPanel() {
    this.propertyPanelOpen = false;
    this.selectedItem = null;
    this.propertyForm = {};
  }

  saveProperties() {
    if (this.selectedItem && !this.isRestoringState) {
      this.propertyForm.position = { ...this.selectedItem.position };
      this.selectedItem.properties = { ...this.propertyForm };
      this.saveState();
      this.saveToHistory();
      this.closePropertyPanel();
    }
  }

  cancelProperties() {
    this.closePropertyPanel();
  }

  private startDragging(item: DraggableItem, event: MouseEvent) {
    this.draggedItem = item;
    this.isDragging = false;

    const target = event.target as HTMLElement;
    const draggableEl = target.closest('.draggable-item') as HTMLElement;

    if (draggableEl) {
      const rect = draggableEl.getBoundingClientRect();
      this.offset = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    } else {
      this.offset = { x: 70, y: 35 };
    }

    const moveHandler = (e: MouseEvent) => this.onMouseMove(e);
    const upHandler = () => {
      this.onMouseUp();
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };

    document.addEventListener('mousemove', moveHandler, { passive: false });
    document.addEventListener('mouseup', upHandler);
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.draggedItem || this.isRestoringState) return;

    if (!this.isDragging) {
      this.isDragging = true;
      if (this.clickTimeout) {
        clearTimeout(this.clickTimeout);
        this.clickTimeout = null;
      }
    }

    event.preventDefault();

    const scrollEl = this.scrollContainerRef?.nativeElement;
    if (!scrollEl) return;

    const sidenavWidth = this.getSidenavWidth();

    const newX = event.clientX - this.offset.x - sidenavWidth + scrollEl.scrollLeft;
    const newY = event.clientY - this.offset.y + scrollEl.scrollTop;

    const deltaX = newX - this.draggedItem.position.x;
    const deltaY = newY - this.draggedItem.position.y;

    this.draggedItem.position = { x: newX, y: newY };

    if (this.draggedItem.properties) {
      this.draggedItem.properties.position = { x: newX, y: newY };
    }

    for (const linkedBtn of this.linkedButtons) {
      linkedBtn.position.x += deltaX;
      linkedBtn.position.y += deltaY;
      
      if (linkedBtn.properties) {
        linkedBtn.properties.position = { x: linkedBtn.position.x, y: linkedBtn.position.y };
      }
    }

    this.updateAllArrows();
  }

  private onMouseUp() {
    if (this.isDragging && !this.isRestoringState) {
      this.saveState();
      this.saveToHistory();
    }
    this.isDragging = false;
    this.draggedItem = null;
    this.linkedButtons = [];
  }

  private createArrow(from: DraggableItem, to: DraggableItem) {
    this.arrows.push({ from, to, path: '' });
  }

  private updateAllArrows() {
    for (const arrow of this.arrows) {
      arrow.path = this.calculateArrowPath(arrow.from, arrow.to);
    }
  }

  private calculateArrowPath(from: DraggableItem, to: DraggableItem): string {
    const boxW = 140;
    const boxH = 64;

    const fx = from.position.x + boxW / 2;
    const fy = from.position.y + boxH / 2;
    const tx = to.position.x + boxW / 2;
    const ty = to.position.y + boxH / 2;

    const dx = tx - fx;
    const dy = ty - fy;
    const angle = Math.atan2(dy, dx);

    const fromX = fx + Math.cos(angle) * (boxW / 2);
    const fromY = fy + Math.sin(angle) * (boxH / 2);

    const toX = tx - Math.cos(angle) * (boxW / 2 + 12);
    const toY = ty - Math.sin(angle) * (boxH / 2 + 12);

    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;

    return `M${fromX},${fromY} Q${midX},${midY} ${toX},${toY}`;
  }

  clearCanvas() {
    if (this.isRestoringState) return;
    
    this.items = [];
    this.arrows = [];
    this.lastCreatedItem = null;
    this.nextId = 1;
    this.sequenceCounter = 1;
    this.closePropertyPanel();
    
    // Clear history and save new empty state
    this.history = [];
    this.historyIndex = -1;
    this.saveToHistory();
    
    if (this.isBrowser) {
      try {
        localStorage.removeItem('workflowState');
      } catch (e) {
        console.error('Error clearing localStorage:', e);
      }
    }
  }

  getIconName(type: string): string {
    if (type === 'action1' || type === 'action2') return 'extension';
    if (type === 'continue') return 'thumb_up';
    if (type === 'reject') return 'close';
    return 'help_outline';
  }

  getPropertyKeys(): string[] {
    return Object.keys(this.propertyForm).filter(key => 
      key !== 'id' && 
      key !== 'project_id' && 
      key !== 'logical_module_id' && 
      key !== 'page_id'
    );
  }

  getPropertyValue(key: string): any {
    if (key === 'position' && typeof this.propertyForm[key] === 'object') {
      return JSON.stringify(this.propertyForm[key]);
    }
    return this.propertyForm[key];
  }

  setPropertyValue(key: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    
    if (key === 'position') {
      try {
        this.propertyForm[key] = JSON.parse(target.value);
      } catch (e) {
        console.error('Invalid JSON for position');
      }
    } else {
      this.propertyForm[key] = target.value;
    }
  }

  formatLabel(key: string): string {
    return key.replace(/_/g, ' ');
  }

  isNumberField(key: string): boolean {
    return key.includes('_id') || key === 'sequence' || key === 'createdby' || key === 'lastmodifiedby';
  }

  isDateField(key: string): boolean {
    return key.includes('date');
  }

  isTextField(key: string): boolean {
    return !this.isNumberField(key) && !this.isDateField(key);
  }
}
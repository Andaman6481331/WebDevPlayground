<script setup>
import { ref, watch, onMounted, nextTick } from 'vue';

const props = defineProps({
    htmlCode: String,
    cssCode: String,
    jsCode: String
});

const emit = defineEmits(['undo', 'redo', 'update-code']);

const previewFrame = ref(null);
const selectionCanvas = ref(null);
const selectionInfo = ref(null);
const shapeModal = ref(null);
const editSelectionModal = ref(null);
const editInstructionInput = ref('');
const selectedElementsInfoText = ref('');

// State
const isSelectionMode = ref(false);
const selectedShape = ref(null);
const isDrawing = ref(false);
const startX = ref(0);
const startY = ref(0);
const allSelections = ref([]);
const selectionCounter = ref(1);

// Watch for code changes to update preview
watch(() => [props.htmlCode, props.cssCode, props.jsCode], () => {
    updatePreview();
}, { deep: true });

onMounted(() => {
    updatePreview();
});

function updatePreview() {
    if (!previewFrame.value) return;

    const completeHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>${props.cssCode}</style>
        </head>
        <body>
            ${props.htmlCode}
            <script>
                try {
                    ${props.jsCode}
                } catch (error) {
                    console.error('JavaScript Error:', error);
                }
            <\/script>
        </body>
        </html>
    `;

    const blob = new Blob([completeHTML], { type: 'text/html' });
    previewFrame.value.src = URL.createObjectURL(blob);
}

// Ensure undo/redo buttons are handled by parent (App.vue) passing down props if needed, 
// or just emitting events which we are doing.

// ========== SHAPE SELECTION LOGIC ==========

const openShapeModal = () => {
    if (isSelectionMode.value) {
        if (allSelections.value.length > 0) {
            if (confirm(`You have ${allSelections.value.length} selection(s). Click OK to finish and edit, or Cancel to continue selecting.`)) {
                finishSelection();
            }
        } else {
            deactivateSelectionMode();
        }
    } else {
        shapeModal.value.showModal();
    }
};

const closeShapeModal = () => {
    shapeModal.value.close();
};

const selectShape = (shape) => {
    selectedShape.value = shape;
    shapeModal.value.close();
    activateSelectionMode();
};

function activateSelectionMode() {
    isSelectionMode.value = true;
    
    if (allSelections.value.length === 0) {
        selectionCounter.value = 1;
    }
    
    nextTick(() => {
        const previewWrapper = document.querySelector('.preview-wrapper'); // Can use ref here too if we tag it
        if (!previewWrapper || !selectionCanvas.value) return;

        const rect = previewWrapper.getBoundingClientRect();
        
        selectionCanvas.value.width = rect.width - 24;
        selectionCanvas.value.height = rect.height - 24;
        
        redrawAllSelections();
    });
}

function deactivateSelectionMode() {
    isSelectionMode.value = false;
    
    if (selectionCanvas.value) {
        const ctx = selectionCanvas.value.getContext('2d');
        ctx.clearRect(0, 0, selectionCanvas.value.width, selectionCanvas.value.height);
    }
    
    allSelections.value = [];
    selectionCounter.value = 1;
    selectedShape.value = null;
}

function handleSelectionStart(e) {
    if (!isSelectionMode.value) return;
    isDrawing.value = true;
    const rect = selectionCanvas.value.getBoundingClientRect();
    startX.value = e.clientX - rect.left;
    startY.value = e.clientY - rect.top;
}

function handleSelectionMove(e) {
    if (!isDrawing.value) return;
    
    const rect = selectionCanvas.value.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    redrawAllSelections();
    
    const ctx = selectionCanvas.value.getContext('2d');
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(102, 126, 234, 0.15)';
    ctx.setLineDash([5, 5]);
    
    if (selectedShape.value === 'rectangle') {
        const width = currentX - startX.value;
        const height = currentY - startY.value;
        ctx.fillRect(startX.value, startY.value, width, height);
        ctx.strokeRect(startX.value, startY.value, width, height);
    } else if (selectedShape.value === 'circle') {
        const radius = Math.sqrt(Math.pow(currentX - startX.value, 2) + Math.pow(currentY - startY.value, 2));
        ctx.beginPath();
        ctx.arc(startX.value, startY.value, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
    
    ctx.setLineDash([]);
}

function handleSelectionEnd(e) {
    if (!isDrawing.value) return;
    isDrawing.value = false;
    
    const rect = selectionCanvas.value.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    
    const minSize = 10;
    if (Math.abs(endX - startX.value) < minSize && Math.abs(endY - startY.value) < minSize) {
        redrawAllSelections();
        return;
    }
    
    const selectionBounds = calculateSelectionBounds(startX.value, startY.value, endX, endY);
    const elements = findElementsInSelection(selectionBounds);
    
    if (elements.length > 0) {
        allSelections.value.push({
            bounds: selectionBounds,
            elements: elements,
            number: selectionCounter.value++,
            shape: selectedShape.value
        });
        
        redrawAllSelections();
    } else {
        alert('No elements found in selection. Try selecting a larger area or different location.');
        redrawAllSelections();
    }
}

function redrawAllSelections() {
    if (!selectionCanvas.value) return;
    const ctx = selectionCanvas.value.getContext('2d');
    ctx.clearRect(0, 0, selectionCanvas.value.width, selectionCanvas.value.height);
    
    allSelections.value.forEach((selection) => {
        const bounds = selection.bounds;
        const number = selection.number;
        
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(102, 126, 234, 0.1)';
        ctx.setLineDash([]);
        
        if (bounds.shape === 'rectangle') {
            const width = bounds.right - bounds.left;
            const height = bounds.bottom - bounds.top;
            ctx.fillRect(bounds.left, bounds.top, width, height);
            ctx.strokeRect(bounds.left, bounds.top, width, height);
            drawNumberLabel(ctx, bounds.left + 5, bounds.top + 5, number);
        } else if (bounds.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(bounds.centerX, bounds.centerY, bounds.radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            drawNumberLabel(ctx, bounds.centerX - 10, bounds.centerY - 10, number);
        }
    });
}

function drawNumberLabel(ctx, x, y, number) {
    ctx.fillStyle = '#667eea';
    ctx.beginPath();
    ctx.arc(x + 12, y + 12, 15, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number.toString(), x + 12, y + 13);
}

function calculateSelectionBounds(x1, y1, x2, y2) {
    if (selectedShape.value === 'rectangle') {
        return {
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            right: Math.max(x1, x2),
            bottom: Math.max(y1, y2),
            shape: 'rectangle'
        };
    } else if (selectedShape.value === 'circle') {
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        return {
            centerX: x1,
            centerY: y1,
            radius: radius,
            shape: 'circle'
        };
    }
}

function findElementsInSelection(bounds) {
    const selectedElements = [];
    
    try {
        const iframe = previewFrame.value;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const iframeWin = iframe.contentWindow;
        
        if (!iframeDoc || !iframeDoc.body) {
            return selectedElements;
        }
        
        // 1. Get all candidates
        const allElements = iframeDoc.body.querySelectorAll('*');
        const iframeRect = iframe.getBoundingClientRect();
        
        const validCandidates = [];

        allElements.forEach(element => {
            // Rule 3: Visual Filtering (Is Visible?)
            const style = iframeWin.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return;
            }

            const elementRect = element.getBoundingClientRect();
            if (elementRect.width === 0 || elementRect.height === 0) return;

            // Normalized calculations relative to the selection canvas
            // Element rect is relative to iframe viewport, which matches our canvas coordinates
            const elLeft = elementRect.left;
            const elTop = elementRect.top;
            const elRight = elementRect.right;
            const elBottom = elementRect.bottom;
            const elWidth = elementRect.width;
            const elHeight = elementRect.height;
            const elArea = elWidth * elHeight;

            // Calculate Intersection Rectangle
            const selectionLeft = bounds.left !== undefined ? bounds.left : (bounds.centerX - bounds.radius);
            const selectionRight = bounds.right !== undefined ? bounds.right : (bounds.centerX + bounds.radius);
            const selectionTop = bounds.top !== undefined ? bounds.top : (bounds.centerY - bounds.radius);
            const selectionBottom = bounds.bottom !== undefined ? bounds.bottom : (bounds.centerY + bounds.radius);

            // Bounds for intersection (Using bounding box of selection for circle approximation)
            const interLeft = Math.max(elLeft, selectionLeft);
            const interTop = Math.max(elTop, selectionTop);
            const interRight = Math.min(elRight, selectionRight);
            const interBottom = Math.min(elBottom, selectionBottom);

            const interWidth = Math.max(0, interRight - interLeft);
            const interHeight = Math.max(0, interBottom - interTop);
            const intersectionArea = interWidth * interHeight;

            // Rule 1: Selection Threshold (>= 80% coverage)
            // Even for Circle, we check if the element's bounding box is mostly inside the circle's bounding box
            // For strict circle containment, we would need more complex math, but bounding-box intersection is standard for "drag select"
            const coverageRatio = intersectionArea / elArea;

            if (coverageRatio >= 0.8) {
                validCandidates.push({
                    element: element,
                    tagName: element.tagName,
                    className: element.className,
                    id: element.id,
                    textContent: element.textContent?.trim().substring(0, 50),
                    rect: {
                        left: elLeft,
                        top: elTop,
                        right: elRight,
                        bottom: elBottom,
                        width: elWidth,
                        height: elHeight
                    },
                    zIndex: style.zIndex === 'auto' ? 0 : parseInt(style.zIndex, 10) || 0
                });
            }
        });

        // Rule 2: Leaf-Node Priority (Inner Elements)
        // Remove parents if they contain any other selected child
        const leafElements = validCandidates.filter(candidateA => {
            const hasSelectedChild = validCandidates.some(candidateB => {
                if (candidateA.element === candidateB.element) return false;
                return candidateA.element.contains(candidateB.element);
            });
            return !hasSelectedChild;
        });

        // Rule 4: Z-Index/DOM Order Sorting
        // Sort so "top" elements come first.
        // Priority: Higher Z-Index > Later in DOM (Document Position)
        leafElements.sort((a, b) => {
            if (b.zIndex !== a.zIndex) {
                return b.zIndex - a.zIndex; // Higher Z-Index first
            }
            // If Text vs Div, etc.
            // If z-index is same, check document order. 
            // The one later in the DOM is visually on top (painted later).
            // compareDocumentPosition: 4 (FOLLOWING) means b follows a (b is below/after a).
            // We want b first if b is after a.
            if (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return 1; // b is after a, so b is "higher" -> b comes first
            } else {
                return -1;
            }
        });

        // Strip the DOM element reference before returning to avoid reactivity issues/circular refs if placed in state
        leafElements.forEach(item => {
            selectedElements.push({
                tagName: item.tagName,
                className: item.className,
                id: item.id,
                textContent: item.textContent,
                rect: item.rect
            });
        });

    } catch (error) {
        console.error('Error accessing iframe:', error);
    }
    
    return selectedElements;
}

// Helper removed or kept if needed by other logic, but logic is now inlined for optimization within the loop
function isElementInSelection(selectionBounds, elementRect) {
    // Deprecated/Unused in new algorithm logic inside findElementsInSelection
    return false;
}

function finishSelection() {
    if (allSelections.value.length === 0) {
        alert('No areas selected.');
        return;
    }
    
    // Construct summary
    let summary = `You have selected ${allSelections.value.length} area(s):\n\n`;
    allSelections.value.forEach(selection => {
        summary += `━━━ AREA #${selection.number} (${selection.shape}) ━━━\n`;
        summary += `Elements found: ${selection.elements.length}\n`;
        const elementSummary = selection.elements.slice(0, 5).map(el => {
            let desc = `  • <${el.tagName.toLowerCase()}`;
            if (el.id) desc += ` id="${el.id}"`;
            if (el.className) desc += ` class="${el.className.substring(0, 30)}"`;
            desc += '>';
            return desc;
        }).join('\n');
        summary += elementSummary;
        if (selection.elements.length > 5) summary += `\n  ...`;
        summary += '\n\n';
    });
    
    selectedElementsInfoText.value = summary;
    editInstructionInput.value = '';
    editSelectionModal.value.showModal();
}

const sendEdit = () => {
    const instruction = editInstructionInput.value.trim();
    if (!instruction) return;
    
    // Construct message with context
    let contextMessage = `${instruction}\n\n=== SELECTED AREAS ===\n`;
    allSelections.value.forEach(selection => {
        contextMessage += `\nAREA #${selection.number}:\n`;
        const context = selection.elements.map(el => ({
            tag: el.tagName,
            id: el.id,
            class: el.className,
            text: el.textContent
        }));
        contextMessage += JSON.stringify(context) + '\n';
    });
    
    // Emit event to parent to handle AI request
    emit('update-code', contextMessage);
    
    closeEditModal();
    deactivateSelectionMode();
};

const closeEditModal = () => {
    editSelectionModal.value.close();
};

</script>

<template>
    <!-- Center Panel: Live Preview -->
    <main class="preview-panel">
        <div class="panel-header">
            <h2>LIVE PREVIEW</h2>

            <!-- Undo/Redo Toggle -->
            <div class="version-toggle">
                <button class="version-btn" @click="$emit('undo')" title="Undo last change">
                    <svg class="icon" style="width: 14px; height: 14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                    </svg>
                </button>
                <button class="version-btn" @click="$emit('redo')" title="Redo change">
                    <svg class="icon" style="width: 14px; height: 14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"/>
                    </svg>
                </button>
            </div>

            <!-- Shape Selection Button -->
            <button 
                class="shape-select-btn" 
                :class="{ active: isSelectionMode }"
                @click="openShapeModal" 
                :title="isSelectionMode ? 'Finish selection' : 'Select area to edit'"
            >
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
                </svg>
            </button>

            <!-- Cancel Selection Button -->
            <button 
                v-if="isSelectionMode"
                class="shape-select-btn cancel-btn" 
                @click="deactivateSelectionMode" 
                title="Cancel selection"
            >
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>

            <div class="traffic-lights">
                <span class="light red"></span>
                <span class="light yellow"></span>
                <span class="light green"></span>
            </div>
        </div>

        <!-- Live Preview Frame -->
        <div class="preview-wrapper">
            <iframe ref="previewFrame" id="previewFrame" class="preview-frame"></iframe>
            <!-- Selection Overlay -->
            <canvas 
                ref="selectionCanvas" 
                id="selectionCanvas" 
                class="selection-canvas" 
                :class="{ active: isSelectionMode }"
                :style="{ display: isSelectionMode ? 'block' : 'none' }"
                @mousedown="handleSelectionStart"
                @mousemove="handleSelectionMove"
                @mouseup="handleSelectionEnd"
            ></canvas>
            
            <div 
                v-if="isSelectionMode"
                ref="selectionInfo" 
                class="selection-info"
            >
                <strong>Selection Mode Active</strong><br>
                Drawing: {{ selectedShape }} | Selected: {{ allSelections.length }} area(s)<br>
                <small>Click and drag to select. Click the button above to finish.</small>
            </div>
        </div>

        <!-- Modals -->
        <dialog ref="shapeModal" class="modal">
            <div class="modal-content">
                <h3>Select Shape Tool</h3>
                <p>Choose a shape to select an area in the preview for AI editing</p>
                <div class="shape-options">
                    <button class="shape-option-btn" @click="selectShape('rectangle')">
                        <svg class="shape-icon" viewBox="0 0 100 100">
                            <rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor" stroke-width="4"/>
                        </svg>
                        <span>Rectangle</span>
                    </button>
                    <button class="shape-option-btn" @click="selectShape('circle')">
                        <svg class="shape-icon" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="4"/>
                        </svg>
                        <span>Circle</span>
                    </button>
                </div>
                <div class="modal-actions">
                    <button @click="closeShapeModal" class="modal-btn secondary">Cancel</button>
                </div>
            </div>
        </dialog>

        <dialog ref="editSelectionModal" class="modal">
            <div class="modal-content">
                <h3>Edit Selected Area</h3>
                <p class="selected-elements-info">{{ selectedElementsInfoText }}</p>
                <textarea 
                    v-model="editInstructionInput" 
                    placeholder="Tell AI what to change in the selected area..."
                ></textarea>
                <div class="modal-actions">
                    <button @click="closeEditModal" class="modal-btn secondary">Cancel</button>
                    <button @click="sendEdit" class="modal-btn primary">Send to AI</button>
                </div>
            </div>
        </dialog>
    </main>
</template>

<style scoped>
/* ========== CENTER PANEL (PREVIEW) ========== */
.preview-panel {
    grid-column: 1 / -1;
    grid-row: 1;
    background: #f5f5f7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 100%;
    height: 100%;
}

.panel-header {
    padding: 12px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
}

/* Shape Selection Button */
.shape-select-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    margin-right: 12px;
}

.shape-select-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.shape-select-btn.active {
    background: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.shape-select-btn .icon {
    width: 16px;
    height: 16px;
    stroke: white;
}

/* Preview Wrapper Positioning */
.preview-wrapper {
    flex: 1;
    background: white;
    padding: 12px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
}

.preview-frame {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 4px;
    background: white;
}

/* Selection Canvas Overlay */
.selection-canvas {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    bottom: 12px;
    cursor: crosshair;
    z-index: 100;
    pointer-events: none;
}

.selection-canvas.active {
    pointer-events: all;
}

/* Selection Info */
.selection-info {
    position: absolute;
    top: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 101;
    pointer-events: none;
}

/* Shape Modal Styles */
.modal {
    background: transparent;
    border: none;
    padding: 0;
}

.modal::backdrop {
    background: rgba(0, 0, 0, 0.5);
}

.modal-content {
    background: #2a2a2a;
    padding: 24px;
    border-radius: 12px;
    width: 400px;
    border: 1px solid #3a3a3a;
    color: white;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
}

.shape-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 20px 0;
}

.shape-option-btn {
    background: #1a1a1a;
    border: 2px solid #3a3a3a;
    border-radius: 8px;
    padding: 24px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    transition: all 0.2s ease;
}

.shape-option-btn:hover {
    border-color: #667eea;
    background: #333;
    transform: translateY(-2px);
}

.shape-icon {
    width: 60px;
    height: 60px;
    stroke: #667eea;
}

.shape-option-btn span {
    color: #e0e0e0;
    font-size: 14px;
    font-weight: 600;
}

/* Edit Selection Modal */
.modal-content textarea {
    width: 100%;
    height: 100px;
    background: #111;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ddd;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    padding: 12px;
    resize: vertical;
    margin-top: 12px;
}

.selected-elements-info {
    background: #1a1a1a;
    padding: 10px;
    border-radius: 4px;
    font-size: 11px;
    color: #aaa;
    margin: 8px 0;
    white-space: pre-wrap;
    max-height: 150px;
    overflow-y: auto;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 16px;
}

.modal-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
}

.modal-btn.secondary {
    background: #444;
    color: white;
}

.modal-btn.primary {
    background: #667eea;
    color: white;
}
</style>
<style scoped>
/* ========== CENTER PANEL (PREVIEW) ========== */

.panel-header {
    padding: 12px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
}

.editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.header-actions {
    display: flex;
    gap: 8px;
}

.panel-header .action-btn {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 4px;
    border: none;
    transition: all 0.2s;
}

.panel-header .action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}
/* Shape Selection Button */
.shape-select-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    margin-right: 12px;
}

.shape-select-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.shape-select-btn.active {
    background: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.shape-select-btn .icon {
    width: 16px;
    height: 16px;
    stroke: white;
}

/* Preview Wrapper Positioning */
.preview-wrapper {
    flex: 1;
    background: white;
    padding: 12px;
    overflow: hidden;
    position: relative;
}

/* Selection Canvas Overlay */
.selection-canvas {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    bottom: 12px;
    cursor: crosshair;
    z-index: 100;
    pointer-events: none;
}

.selection-canvas.active {
    pointer-events: all;
}

/* Selection Info */
.selection-info {
    position: absolute;
    top: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 101;
    pointer-events: none;
}

/* Shape Modal Styles */
.shape-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 20px 0;
}

.shape-option-btn {
    background: #2a2a2a;
    border: 2px solid #3a3a3a;
    border-radius: 8px;
    padding: 24px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    transition: all 0.2s ease;
}

.shape-option-btn:hover {
    border-color: #667eea;
    background: #333;
    transform: translateY(-2px);
}

.shape-icon {
    width: 80px;
    height: 80px;
    stroke: #667eea;
}

.shape-option-btn span {
    color: #e0e0e0;
    font-size: 14px;
    font-weight: 600;
}

/* Edit Selection Modal */
#editInstructionInput {
    width: 100%;
    height: 120px;
    background: #111;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ddd;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    padding: 12px;
    resize: vertical;
    margin-top: 12px;
}

#editInstructionInput:focus {
    outline: none;
    border-color: #667eea;
}

.selected-elements-info {
    background: #2a2a2a;
    padding: 10px;
    border-radius: 4px;
    font-size: 12px;
    color: #aaa;
    margin: 8px 0;
}
</style>
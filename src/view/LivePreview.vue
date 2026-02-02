<script setup>
import { ref, watch, onMounted, nextTick } from 'vue';

const props = defineProps({
    htmlCode: String,
    cssCode: String,
    jsCode: String
});

const emit = defineEmits(['undo', 'redo', 'update-code', 'direct-update-code']);

const previewFrame = ref(null);
const previewWrapper = ref(null);
const selectionCanvas = ref(null);
const selectionInfo = ref(null);
const shapeModal = ref(null);
const editSelectionModal = ref(null);
const editInstructionInput = ref('');
const selectedElementsInfoText = ref('');

// State for Image Editing
const isImageEditMode = ref(false);
const imageEditModal = ref(null);
const selectedImgUrl = ref('');
const editingImgElement = ref(null);
const imageSources = ref([]); // For <picture> support

// State
const isSelectionMode = ref(false);
const isTextEditMode = ref(false);
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

    // To prevent <\/script> tags in props.jsCode from breaking the HTML structure,
    // we use a safe injection method.
    const completeHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                ${props.cssCode}
            </style>
        </head>
        <body style="margin: 0; min-height: 100vh;">
            ${props.htmlCode}
        </body>
        </html>
    `;

    const blob = new Blob([completeHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    // Cleanup previous URL
    if (previewFrame.value.src.startsWith('blob:')) {
        URL.revokeObjectURL(previewFrame.value.src);
    }

    previewFrame.value.src = url;

    // After iframe loads, inject the JS safely
        previewFrame.value.onload = () => {
        try {
            const iframe = previewFrame.value;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            
            // Re-apply Image Edit Mode listeners if active
            if (isImageEditMode.value) {
                setupImageEditListeners();
            }

            if (props.jsCode && props.jsCode.trim()) {
                const script = iframeDoc.createElement('script');
                // Using textContent is safe against script-end tags in the code string
                script.textContent = `
                    (function() {
                        try {
                            ${props.jsCode}
                        } catch (error) {
                            console.error('Runtime Error in Live Preview Script:', error);
                        }
                    })();
                `;
                iframeDoc.body.appendChild(script);
            }
        } catch (e) {
            console.error('Failed to inject JS into preview:', e);
        }
    };
}

// Ensure undo/redo buttons are handled by parent (App.vue) passing down props if needed, 
// or just emitting events which we are doing.

const openInNewTab = () => {
    const completeHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                ${props.cssCode}
            </style>
        </head>
        <body style="margin: 0; min-height: 100vh;">
            ${props.htmlCode}
            <script>
                (function() {
                    try {
                        ${props.jsCode}
                    } catch (error) {
                        console.error('Runtime Error in Standalone Preview:', error);
                    }
                })();
            <\/script>
        </body>
        </html>
    `;

    const blob = new Blob([completeHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
};

// ========== SHAPE SELECTION LOGIC ==========

const openShapeModal = () => {
    if (isSelectionMode.value) {
        // If they click the tool button again while active, we finish selection
        // Removing confirm() to make it smoother and avoid blocking the UI
        finishSelection();
    } else {
        if (shapeModal.value && !shapeModal.value.open) {
            shapeModal.value.showModal();
        }
    }
};

const closeShapeModal = () => {
    shapeModal.value.close();
};

const selectShape = (shape) => {
    console.log('Shape Selected:', shape);
    selectedShape.value = shape;
    if (shapeModal.value) shapeModal.value.close();
    activateSelectionMode();
};

function activateSelectionMode() {
    isSelectionMode.value = true;
    
    if (allSelections.value.length === 0) {
        selectionCounter.value = 1;
    }
    
    nextTick(() => {
        if (!previewWrapper.value || !selectionCanvas.value || !previewFrame.value) return;

        const rect = previewFrame.value.getBoundingClientRect();
        
        selectionCanvas.value.width = rect.width;
        selectionCanvas.value.height = rect.height;
        
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
    if (!isSelectionMode.value || !selectedShape.value) return;
    isDrawing.value = true;
    const rect = selectionCanvas.value.getBoundingClientRect();
    startX.value = e.clientX - rect.left;
    startY.value = e.clientY - rect.top;
    console.log('Selection Start:', { startX: startX.value, startY: startY.value, rect });
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
    console.log('Selection End:', { endX, endY, bounds: selectionBounds });
    
    if (!selectionBounds) return;

    const elements = findElementsInSelection(selectionBounds);
    console.log('Final elements found for selection:', elements.length);
    
    if (elements.length > 0) {
        allSelections.value.push({
            bounds: selectionBounds,
            elements: elements,
            number: selectionCounter.value++,
            shape: selectedShape.value
        });
        
        redrawAllSelections();
    } else {
        console.warn('No elements found in selection.');
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
    if (!selectedShape.value) {
        console.warn('calculateSelectionBounds called without selectedShape');
        return null;
    }
    
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
    return null;
}

function findElementsInSelection(bounds) {
    const selectedElements = [];
    if (!bounds) return selectedElements;

    try {
        const iframe = previewFrame.value;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const iframeWin = iframe.contentWindow;
        
        if (!iframeDoc || !iframeDoc.body) {
            return selectedElements;
        }
        
        // 1. Get all candidates
        const allElements = iframeDoc.body.querySelectorAll('*');
        console.log('Total elements in iframe:', allElements.length);
        
        const validCandidates = [];

        allElements.forEach(element => {
            const style = iframeWin.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return;
            }

            const elementRect = element.getBoundingClientRect();
            if (elementRect.width === 0 || elementRect.height === 0) return;

            const elLeft = elementRect.left;
            const elTop = elementRect.top;
            const elRight = elementRect.right;
            const elBottom = elementRect.bottom;
            const elArea = elementRect.width * elementRect.height;

            const selectionLeft = bounds.left !== undefined ? bounds.left : (bounds.centerX - bounds.radius);
            const selectionRight = bounds.right !== undefined ? bounds.right : (bounds.centerX + bounds.radius);
            const selectionTop = bounds.top !== undefined ? bounds.top : (bounds.centerY - bounds.radius);
            const selectionBottom = bounds.bottom !== undefined ? bounds.bottom : (bounds.centerY + bounds.radius);

            const interLeft = Math.max(elLeft, selectionLeft);
            const interTop = Math.max(elTop, selectionTop);
            const interRight = Math.min(elRight, selectionRight);
            const interBottom = Math.min(elBottom, selectionBottom);

            const interWidth = Math.max(0, interRight - interLeft);
            const interHeight = Math.max(0, interBottom - interTop);
            const intersectionArea = interWidth * interHeight;

            // Be more permissive: if there is ANY intersection with a leaf-like element
            if (intersectionArea > 0) {
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
                        width: elementRect.width,
                        height: elementRect.height
                    },
                    zIndex: style.zIndex === 'auto' ? 0 : parseInt(style.zIndex, 10) || 0
                });
            }
        });

        const leafElements = validCandidates.filter(candidateA => {
            const hasSelectedChild = validCandidates.some(candidateB => {
                if (candidateA.element === candidateB.element) return false;
                return candidateA.element.contains(candidateB.element);
            });
            return !hasSelectedChild;
        });

        leafElements.sort((a, b) => {
            if (b.zIndex !== a.zIndex) return b.zIndex - a.zIndex;
            if (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return 1;
            } else {
                return -1;
            }
        });

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

function finishSelection() {
    if (allSelections.value.length === 0) {
        alert('No areas selected. Drag on the preview to select an area.');
        return;
    }
    
    let summary = `You have selected ${allSelections.value.length} area(s):\n\n`;
    allSelections.value.forEach(selection => {
        summary += `━━━ AREA #${selection.number} (${selection.shape}) ━━━\n`;
        summary += `Elements: ${selection.elements.length}\n`;
        summary += selection.elements.slice(0, 3).map(el => `  • <${el.tagName.toLowerCase()}${el.id ? ' #' + el.id : ''}>`).join('\n');
        if (selection.elements.length > 3) summary += `\n  ...`;
        summary += '\n\n';
    });
    
    selectedElementsInfoText.value = summary;
    editInstructionInput.value = '';
    
    if (editSelectionModal.value) {
        if (editSelectionModal.value.open) editSelectionModal.value.close();
        editSelectionModal.value.showModal();
    }
}

const sendEdit = () => {
    const instruction = editInstructionInput.value.trim();
    if (!instruction) return;
    
    let contextMessage = `${instruction}\n\n=== SELECTED AREAS ===\n`;
    allSelections.value.forEach(selection => {
        contextMessage += `\nAREA #${selection.number}:\n`;
        contextMessage += JSON.stringify(selection.elements.map(el => ({
            tag: el.tagName,
            id: el.id,
            class: el.className,
            text: el.textContent
        }))) + '\n';
    });
    
    emit('update-code', contextMessage);
    closeEditModal();
    deactivateSelectionMode();
};

const closeEditModal = () => {
    if (editSelectionModal.value) editSelectionModal.value.close();
};

// ========== TEXT EDIT MODE LOGIC ==========

const toggleTextEditMode = () => {
    if (isSelectionMode.value) deactivateSelectionMode();
    
    isTextEditMode.value = !isTextEditMode.value;
    
    if (previewFrame.value) {
        const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;
        if (isTextEditMode.value) {
            iframeDoc.designMode = 'on';
            console.log('Text Edit Mode: ON');
        } else {
            iframeDoc.designMode = 'off';
            console.log('Text Edit Mode: OFF');
            // Re-render to discard unsaved changes if they just toggled it off without saving
            updatePreview();
        }
    }
};

const saveTextChanges = () => {
    if (!previewFrame.value) return;
    
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;
    
    // Disable design mode first
    iframeDoc.designMode = 'off';
    isTextEditMode.value = false;
    
    // Extract the HTML content of the body
    // We want the innerHTML of the body, but cleaned up
    let newHtml = iframeDoc.body.innerHTML;
    
    // Remove any scripts we injected or that might have been added
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    
    const scripts = tempDiv.querySelectorAll('script');
    scripts.forEach(s => s.remove());
    
    // Clean up any attributes added by designMode or other things if necessary
    // (Usually designMode doesn't add much, but sometimes contenteditable elements appear)
    
    const cleanedHtml = tempDiv.innerHTML.trim();
    
    console.log('Saving text changes:', cleanedHtml);
    emit('direct-update-code', cleanedHtml);
    
    // updatePreview will be called by the watcher when props update
};

// ========== IMAGE EDIT MODE LOGIC ==========

const toggleImageEditMode = () => {
    if (isSelectionMode.value) deactivateSelectionMode();
    if (isTextEditMode.value) toggleTextEditMode();
    
    isImageEditMode.value = !isImageEditMode.value;
    
    if (isImageEditMode.value) {
        setupImageEditListeners();
    } else {
        removeImageEditListeners();
    }
};

const setupImageEditListeners = () => {
    if (!previewFrame.value) return;
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;
    
    // Add visual feedback class to all images
    const style = iframeDoc.createElement('style');
    style.id = 'img-edit-styles';
    style.textContent = `
        img { cursor: pointer !important; outline: 2px dashed #667eea !important; }
        img:hover { outline: 2px solid #667eea !important; background: rgba(102, 126, 234, 0.1) !important; }
    `;
    iframeDoc.head.appendChild(style);
    
    iframeDoc.querySelectorAll('img').forEach(img => {
        img.addEventListener('click', handleImageClick);
    });
};

const removeImageEditListeners = () => {
    if (!previewFrame.value) return;
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;
    
    const style = iframeDoc.getElementById('img-edit-styles');
    if (style) style.remove();
    
    iframeDoc.querySelectorAll('img').forEach(img => {
        img.removeEventListener('click', handleImageClick);
    });
};

const handleImageClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    editingImgElement.value = e.target;
    selectedImgUrl.value = e.target.src;
    imageSources.value = [];

    // Check if within a <picture> tag
    const pictureEl = e.target.closest('picture');
    if (pictureEl) {
        const sources = Array.from(pictureEl.querySelectorAll('source'));
        imageSources.value = sources.map((s, index) => ({
            id: index,
            element: s,
            srcset: s.srcset,
            type: s.type || ''
        }));
    }
    
    if (imageEditModal.value) {
        imageEditModal.value.showModal();
    }
};

const saveImageURL = () => {
    if (editingImgElement.value) {
        editingImgElement.value.src = selectedImgUrl.value;
        
        // Update <source> elements if they exist
        imageSources.value.forEach(s => {
            if (s.element) {
                s.element.srcset = s.srcset;
            }
        });

        // Extract updated HTML
        const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;
        
        // Remove our temporary styles before saving
        const style = iframeDoc.getElementById('img-edit-styles');
        if (style) style.remove();
        
        // If part of a picture, we want to make sure the picture structure is preserved
        // We emit the body.innerHTML which will contain the updated picture/sources
        let newHtml = iframeDoc.body.innerHTML;
        
        // Clean up scripts
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHtml;
        tempDiv.querySelectorAll('script').forEach(s => s.remove());
        
        const cleanedHtml = tempDiv.innerHTML.trim();
        emit('direct-update-code', cleanedHtml);
        
        imageEditModal.value.close();
        isImageEditMode.value = false;
        removeImageEditListeners();
    }
};

const closeImageModal = () => {
    if (imageEditModal.value) imageEditModal.value.close();
    editingImgElement.value = null;
};

</script>

<template>
    <main class="preview-panel">
        <div class="panel-header">
            <h2>LIVE PREVIEW</h2>
            <div v-if="isTextEditMode" class="selection-info text-edit-info">
                <strong>Text Edit Mode Active</strong><br>
                <small>Click any text to edit. Click checkmark to save, or pen to discard.</small>
            </div>
            <div v-if="isSelectionMode" class="selection-info">
                <strong>Selection Mode Active</strong><br>
                Tool: {{ selectedShape || 'None' }} | Areas: {{ allSelections.length }}<br>
                <small>Drag to select. Click the tool button when done.</small>
            </div>
            <div class="header-actions">
                <!-- Undo/Redo -->
                <div class="version-toggle">
                    <button class="version-btn" @click="$emit('undo')" title="Undo">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                        </svg>
                    </button>
                    <button class="version-btn" @click="$emit('redo')" title="Redo">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"/>
                        </svg>
                    </button>
                </div>

                <!-- Standalone Preview -->
                <button class="external-link-btn" @click="openInNewTab" title="Open in new tab">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                </button>

                <!-- Selection Tool -->
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

                <!-- Text Edit Tool -->
                <div class="text-edit-group">
                    <button 
                        class="text-edit-btn" 
                        :class="{ active: isTextEditMode }"
                        @click="toggleTextEditMode" 
                        :title="isTextEditMode ? 'Discard changes' : 'Edit text directly'"
                    >
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    
                    <button 
                        v-if="isTextEditMode"
                        class="text-edit-btn save-btn" 
                        @click="saveTextChanges" 
                        title="Save text changes"
                    >
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </button>
                </div>

                <!-- Image Edit Tool -->
                <button 
                    class="image-edit-btn" 
                    :class="{ active: isImageEditMode }"
                    @click="toggleImageEditMode" 
                    :title="isImageEditMode ? 'Turn off image edit' : 'Edit image URLs'"
                >
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                </button>

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
            </div>

            <div class="traffic-lights">
                <span class="light red"></span>
                <span class="light yellow"></span>
                <span class="light green"></span>
            </div>
        </div>

        <div class="preview-wrapper" ref="previewWrapper">
            <iframe ref="previewFrame" class="preview-frame"></iframe>
            
            <canvas 
                ref="selectionCanvas" 
                class="selection-canvas" 
                :class="{ active: isSelectionMode }"
                :style="{ display: isSelectionMode ? 'block' : 'none' }"
                @mousedown="handleSelectionStart"
                @mousemove="handleSelectionMove"
                @mouseup="handleSelectionEnd"
            ></canvas>


        </div>

        <!-- Tool Picker -->
        <dialog ref="shapeModal" class="modal">
            <div class="modal-content">
                <h3>Select Shape Tool</h3>
                <p>Choose a shape to select an area in the preview</p>
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

        <!-- Edit Modal -->
        <dialog ref="editSelectionModal" class="modal" @close="redrawAllSelections">
            <div class="modal-content">
                <h3>Edit Selected Area</h3>
                <p class="selected-elements-info">{{ selectedElementsInfoText }}</p>
                <textarea v-model="editInstructionInput" placeholder="How should AI change this area?"></textarea>
                <div class="modal-actions">
                    <button @click="closeEditModal" class="modal-btn secondary">Cancel</button>
                    <button @click="sendEdit" class="modal-btn primary">Send to AI</button>
                </div>
            </div>
        </dialog>

        <!-- Image URL Edit Modal -->
        <dialog ref="imageEditModal" class="modal">
            <div class="modal-content">
                <h3>Edit Image / Picture Sources</h3>
                <div class="image-preview-container" v-if="selectedImgUrl">
                    <img :src="selectedImgUrl" class="img-edit-preview" alt="Preview">
                </div>

                <!-- Sources for <picture> -->
                <div v-if="imageSources.length > 0" class="sources-list">
                    <div v-for="source in imageSources" :key="source.id" class="input-group">
                        <label>Source ({{ source.type || 'responsive' }})</label>
                        <input v-model="source.srcset" type="text" placeholder="https://example.com/image.webp">
                    </div>
                </div>

                <div class="input-group">
                    <label>Fallback Image Source (img src)</label>
                    <input v-model="selectedImgUrl" type="text" placeholder="https://example.com/image.jpg">
                </div>
                <div class="modal-actions">
                    <button @click="closeImageModal" class="modal-btn secondary">Cancel</button>
                    <button @click="saveImageURL" class="modal-btn primary">Update All Sources</button>
                </div>
            </div>
        </dialog>
    </main>
</template>

<style scoped>
.preview-panel {
    grid-column: 1 / -1;
    grid-row: 1;
    background: #f5f5f7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
}

.panel-header {
    padding: 12px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    position: relative;
    z-index: 1000; /* Ensure header is always on top */
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.icon {
    width: 16px;
    height: 16px;
}

/* Common Header Button Styles */
.version-btn, .external-link-btn, .shape-select-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: white;
}

.version-btn:hover, .external-link-btn:hover, .shape-select-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.shape-select-btn.active {
    background: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.text-edit-group {
    display: flex;
    gap: 4px;
    background: rgba(255, 255, 255, 0.1);
    padding: 2px;
    border-radius: 6px;
}

.text-edit-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: white;
}

.text-edit-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.text-edit-btn.active {
    background: #ff4757;
    color: white;
}

.text-edit-btn.save-btn {
    background: #2ed573;
    color: white;
}

.text-edit-btn.save-btn:hover {
    background: #26af5f;
}

.text-edit-info {
    border-left: 4px solid #ff4757 !important;
}

.image-edit-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: white;
}

.image-edit-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.image-edit-btn.active {
    background: #ffa502;
    color: white;
}

.image-preview-container {
    margin: 15px 0;
    max-height: 150px;
    display: flex;
    justify-content: center;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
}

.img-edit-preview {
    max-width: 100%;
    max-height: 150px;
    object-fit: contain;
}

.sources-list {
    margin: 10px 0;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 5px;
}

.sources-list::-webkit-scrollbar {
    width: 4px;
}

.sources-list::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 2px;
}

.input-group {
    margin-top: 15px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.input-group label {
    font-size: 11px;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.input-group input {
    background: #111;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 10px;
    color: white;
    font-size: 13px;
}


.version-toggle {
    display: flex;
    gap: 4px;
}

.preview-wrapper {
    flex: 1;
    background: white;
    padding: 12px;
    position: relative;
    overflow: hidden;
}

.preview-frame {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 4px;
}

.selection-canvas {
    position: absolute;
    top: 12px;
    left: 12px;
    cursor: crosshair;
    z-index: 100;
    pointer-events: none;
}

.selection-canvas.active {
    pointer-events: all;
    outline: 2px dashed rgba(102, 126, 234, 0.5);
    outline-offset: -2px;
}

.selection-info {
    position: absolute;
    top: 5px;
    left: 200px;
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 101;
    pointer-events: none;
}

/* Modals */
.modal {
    background: transparent;
    border: none;
    padding: 0;
}

.modal::backdrop {
    background: rgba(0,0,0,0.5);
}

.modal-content {
    background: #2a2a2a;
    padding: 24px;
    border-radius: 12px;
    width: 400px;
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
    color: white;
}

.shape-option-btn:hover {
    border-color: #667eea;
    background: #333;
}

.shape-icon {
    width: 60px;
    height: 60px;
    stroke: #667eea;
}

.modal-content textarea {
    width: 100%;
    height: 100px;
    background: #111;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ddd;
    padding: 12px;
    font-size: 13px;
    margin-top: 12px;
    resize: vertical;
}

.selected-elements-info {
    background: #1a1a1a;
    padding: 10px;
    border-radius: 4px;
    font-size: 11px;
    color: #aaa;
    margin: 8px 0;
    max-height: 120px;
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
}

.modal-btn.secondary { background: #444; color: white; }
.modal-btn.primary { background: #667eea; color: white; }

.traffic-lights {
    display: flex;
    gap: 6px;
}

.light { width: 10px; height: 10px; border-radius: 50%; }
.light.red { background: #ff5f56; }
.light.yellow { background: #ffbd2e; }
.light.green { background: #27c93f; }
</style>
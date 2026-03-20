<script setup>
import { ref, watch, onMounted, nextTick } from 'vue';

const props = defineProps({
    htmlCode: String,
    cssCode: String,
    jsCode: String
});

const emit = defineEmits(['undo', 'redo', 'update-code', 'direct-update-code', 'add-responsive', 'inspect-element']);

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
const editingTextElement = ref(null);
const textStyleBar = ref({
    show: false,
    top: 0,
    left: 0,
    fontSize: '16px',
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    color: '#000000'
});
const isInspectMode = ref(false);
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
    selectedShape.value = null;
    isDrawing.value = false;
    const ctx = selectionCanvas.value.getContext('2d');
    ctx.clearRect(0, 0, selectionCanvas.value.width, selectionCanvas.value.height);
    
    allSelections.value = [];
    selectionCounter.value = 1;
}

const resetTools = () => {
    isInspectMode.value = false;
    isTextEditMode.value = false;
    isImageEditMode.value = false;
    isSelectionMode.value = false;
    editingTextElement.value = null;
    editingImgElement.value = null;
    textStyleBar.value.show = false;
    
    if (selectionCanvas.value) {
        const ctx = selectionCanvas.value.getContext('2d');
        ctx.clearRect(0, 0, selectionCanvas.value.width, selectionCanvas.value.height);
    }
};

defineExpose({
    resetTools
});

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
            textStyleBar.value.show = false;
            // Re-render to discard unsaved changes if they just toggled it off without saving
            updatePreview();
        }

        // Add/Remove click listeners for styling
        if (isTextEditMode.value) {
            iframeDoc.addEventListener('click', handleTextEditClick);
        } else {
            iframeDoc.removeEventListener('click', handleTextEditClick);
        }
    }
};

const handleTextEditClick = (e) => {
    if (!isTextEditMode.value) return;
    
    // Check if clicked inside our style bar if we had one in iframe (but it's in parent)
    const target = e.target;
    if (target.tagName === 'BODY' || target.tagName === 'HTML') {
        textStyleBar.value.show = false;
        return;
    }

    editingTextElement.value = target;
    
    const rect = target.getBoundingClientRect();
    const iframeRect = previewFrame.value.getBoundingClientRect();
    
    // Position style bar above the element
    textStyleBar.value.top = iframeRect.top + rect.top - 50;
    textStyleBar.value.left = iframeRect.left + rect.left;
    textStyleBar.value.show = true;

    // Load current styles
    const style = window.getComputedStyle(target);
    textStyleBar.value.fontSize = style.fontSize;
    textStyleBar.value.fontFamily = style.fontFamily;
    textStyleBar.value.fontWeight = style.fontWeight;
    
    // Hex color conversion
    const color = style.color;
    textStyleBar.value.color = rgbToHex(color);
};

const applyTextStyle = (prop, value) => {
    if (!editingTextElement.value) return;
    editingTextElement.value.style[prop] = value;
    textStyleBar.value[prop] = value;
};

const rgbToHex = (rgb) => {
    if (!rgb || !rgb.startsWith('rgb')) return '#000000';
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return '#000000';
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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

// ========== INSPECT MODE LOGIC ==========
const toggleInspectMode = () => {
    if (isSelectionMode.value) deactivateSelectionMode();
    if (isTextEditMode.value) toggleTextEditMode();
    if (isImageEditMode.value) toggleImageEditMode();

    isInspectMode.value = !isInspectMode.value;

    if (isInspectMode.value) {
        setupInspectListeners();
    } else {
        removeInspectListeners();
    }
};

const setupInspectListeners = () => {
    if (!previewFrame.value) return;
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;

    // Inject highlight styles
    const style = iframeDoc.createElement('style');
    style.id = 'inspect-mode-styles';
    style.textContent = `
        .inspect-highlight {
            outline: 2px solid #3b82f6 !important;
            outline-offset: -2px !important;
            background-color: rgba(59, 130, 246, 0.1) !important;
            cursor: pointer !important;
        }
    `;
    iframeDoc.head.appendChild(style);

    iframeDoc.addEventListener('mouseover', handleInspectMouseOver);
    iframeDoc.addEventListener('mouseout', handleInspectMouseOut);
    iframeDoc.addEventListener('click', handleInspectClick, true);
};

const removeInspectListeners = () => {
    if (!previewFrame.value) return;
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;

    const style = iframeDoc.getElementById('inspect-mode-styles');
    if (style) style.remove();

    iframeDoc.querySelectorAll('.inspect-highlight').forEach(el => el.classList.remove('inspect-highlight'));
    
    iframeDoc.removeEventListener('mouseover', handleInspectMouseOver);
    iframeDoc.removeEventListener('mouseout', handleInspectMouseOut);
    iframeDoc.removeEventListener('click', handleInspectClick, true);
};

const handleInspectMouseOver = (e) => {
    e.target.classList.add('inspect-highlight');
};

const handleInspectMouseOut = (e) => {
    e.target.classList.remove('inspect-highlight');
};

const handleInspectClick = (e) => {
    if (!isInspectMode.value) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    
    // Find approximate position or selector
    const tagName = target.tagName.toLowerCase();
    const id = target.id ? `#${target.id}` : '';
    const classes = Array.from(target.classList).filter(c => c !== 'inspect-highlight').map(c => `.${c}`).join('');
    
    // Create a unique-ish snippet to search for
    let snippet = target.outerHTML;
    // Clean up our temporary classes if any
    snippet = snippet.replace(' inspect-highlight', '');
    
    emit('inspect-element', {
        tagName,
        id,
        classes,
        outerHTML: snippet,
        innerHTML: target.innerHTML,
        textContent: target.textContent.trim()
    });

    // Optionally turn off inspect mode after one click, or keep it on
    // isInspectMode.value = false;
    // removeInspectListeners();
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
    const iframeWin = previewFrame.value.contentWindow;
    
    // Inject highlight styles for both <img> and background-image elements
    const style = iframeDoc.createElement('style');
    style.id = 'img-edit-styles';
    style.textContent = `
        img { cursor: pointer !important; outline: 2px dashed #667eea !important; }
        img:hover { outline: 2px solid #667eea !important; background: rgba(102, 126, 234, 0.1) !important; }
        .bg-img-editable { cursor: pointer !important; outline: 2px dashed #f97316 !important; }
        .bg-img-editable:hover { outline: 2px solid #f97316 !important; }
    `;
    iframeDoc.head.appendChild(style);
    
    // Attach click listener to all <img> elements
    iframeDoc.querySelectorAll('img').forEach(img => {
        img.addEventListener('click', handleImageClick);
    });

    // Find and attach click listener to all elements with a background-image (from inline or computed style)
    iframeDoc.querySelectorAll('*').forEach(el => {
        const computed = iframeWin.getComputedStyle(el);
        const bg = el.style.backgroundImage || computed.backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
            el.classList.add('bg-img-editable');
            el.addEventListener('click', handleImageClick);
        }
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

    iframeDoc.querySelectorAll('.bg-img-editable').forEach(el => {
        el.classList.remove('bg-img-editable');
        el.removeEventListener('click', handleImageClick);
    });
};

const editingBgElement = ref(null); // tracks element being edited if it's a bg-image

const handleImageClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;

    // Determine if this is a background-image element or a regular <img>
    if (target.tagName === 'IMG') {
        // Regular <img> tag
        editingImgElement.value = target;
        editingBgElement.value = null;
        selectedImgUrl.value = target.src;
        imageSources.value = [];

        // Check if within a <picture> tag
        const pictureEl = target.closest('picture');
        if (pictureEl) {
            const sources = Array.from(pictureEl.querySelectorAll('source'));
            imageSources.value = sources.map((s, index) => ({
                id: index,
                element: s,
                srcset: s.srcset,
                type: s.type || ''
            }));
        }
    } else {
        // Background-image element — extract the URL from the computed/inline style
        const iframeWin = previewFrame.value.contentWindow;
        const computed = iframeWin.getComputedStyle(target);
        const bgValue = target.style.backgroundImage || computed.backgroundImage || '';
        // Extract bare URL from url('...') or url("...")
        const match = bgValue.match(/url\(["']?([^"')]+)["']?\)/);
        selectedImgUrl.value = match ? match[1] : '';
        editingBgElement.value = target;
        editingImgElement.value = null;
        imageSources.value = [];
    }
    
    if (imageEditModal.value) {
        imageEditModal.value.showModal();
    }
};

const saveImageURL = () => {
    const iframeDoc = previewFrame.value.contentDocument || previewFrame.value.contentWindow.document;

    if (editingImgElement.value) {
        // --- Save for a regular <img> element ---
        editingImgElement.value.src = selectedImgUrl.value;
        
        imageSources.value.forEach(s => {
            if (s.element) s.element.srcset = s.srcset;
        });
    } else if (editingBgElement.value) {
        // --- Save for a CSS background-image element ---
        // Update the inline style directly in the live DOM
        editingBgElement.value.style.backgroundImage = `url('${selectedImgUrl.value}')`;

        // Also patch the <style> tags in the iframe to persist through re-renders
        const tagName = editingBgElement.value.tagName.toLowerCase();
        const classList = Array.from(editingBgElement.value.classList).map(c => `.${c}`).join('');
        const idStr = editingBgElement.value.id ? `#${editingBgElement.value.id}` : '';
        const selector = idStr || classList || tagName;

        iframeDoc.querySelectorAll('style').forEach(styleEl => {
            if (styleEl.id === 'img-edit-styles') return; // Skip our injected style
            // Simple text replacement of the bg url in stylesheet
            styleEl.textContent = styleEl.textContent.replace(
                /background-image\s*:\s*url\(["']?[^"')]+["']?\)/g,
                `background-image: url('${selectedImgUrl.value}')`
            );
        });
    }

    // Extract updated HTML
    // Remove our temporary styles before saving
    const style = iframeDoc.getElementById('img-edit-styles');
    if (style) style.remove();
    
    let newHtml = iframeDoc.body.innerHTML;
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    tempDiv.querySelectorAll('script').forEach(s => s.remove());
    
    const cleanedHtml = tempDiv.innerHTML.trim();
    emit('direct-update-code', cleanedHtml);
    
    imageEditModal.value.close();
    isImageEditMode.value = false;
    editingBgElement.value = null;
    removeImageEditListeners();
};

const closeImageModal = () => {
    if (imageEditModal.value) imageEditModal.value.close();
    editingImgElement.value = null;
};

// ========== RESPONSIVENESS LOGIC ==========
const responsivenessModal = ref(null);

const openResponsivenessModal = () => {
    if (responsivenessModal.value) {
        responsivenessModal.value.showModal();
    }
};

const closeResponsivenessModal = () => {
    if (responsivenessModal.value) {
        responsivenessModal.value.close();
    }
};

const applyResponsiveness = (type) => {
    const message = `Make this page responsive using ${type} layout. Ensure it looks good on mobile devices.`;
    emit('add-responsive', message, type);
    closeResponsivenessModal();
};

const fontOptions = [
    { label: 'Sans-Serif', value: 'sans-serif' },
    { label: 'Serif', value: 'serif' },
    { label: 'Monospace', value: 'monospace' },
    { label: 'System', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
];

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
                        title="Save changes"
                    >
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </button>
                </div>

                <!-- Inspect Tool -->
                <button 
                    class="inspect-btn" 
                    :class="{ active: isInspectMode }"
                    @click="toggleInspectMode" 
                    title="Inspect & Sync Code"
                >
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path>
                    </svg>
                </button>

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

                <!-- Responsiveness Tool -->
                <button 
                    class="response-tool-btn" 
                    @click="openResponsivenessModal" 
                    title="Make Responsive"
                >
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
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
                <h3>Edit Image Source</h3>
                <p style="font-size:12px; color:#aaa; margin:0 0 12px;"
                   v-if="editingBgElement">
                    🖼️ Editing <strong>CSS background-image</strong>
                </p>
                <p style="font-size:12px; color:#aaa; margin:0 0 12px;"
                   v-else>
                    🖼️ Editing <strong>&lt;img&gt; src</strong>
                </p>
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
                    <label>{{ editingBgElement ? 'background-image URL' : 'Fallback Image Source (img src)' }}</label>
                    <input v-model="selectedImgUrl" type="text" placeholder="https://example.com/image.jpg">
                </div>
                <div class="modal-actions">
                    <button @click="closeImageModal" class="modal-btn secondary">Cancel</button>
                    <button @click="saveImageURL" class="modal-btn primary">Update</button>
                </div>
            </div>
        </dialog>

        <!-- Responsiveness Modal -->
        <dialog ref="responsivenessModal" class="modal">
            <div class="modal-content">
                <h3>Make Page Responsive</h3>
                <p>Choose how you want the AI to adjust the layout for mobile devices:</p>
                <div class="responsive-options">
                    <button class="responsive-option-btn" @click="applyResponsiveness('compact')">
                        <div class="option-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="4" width="20" height="16" rx="2" />
                                <path d="M12 8v8" />
                                <path d="M17 12l2 0" />
                                <path d="M5 12l2 0" />
                            </svg>
                        </div>
                        <div class="option-text">
                            <strong>Compact Mobile Mode</strong>
                            <span>More content visible on small screens without changing desktop layout.</span>
                        </div>
                    </button>
                    <button class="responsive-option-btn" @click="applyResponsiveness('comfortable')">
                        <div class="option-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7" />
                                <rect x="14" y="3" width="7" height="7" />
                                <rect x="14" y="14" width="7" height="7" />
                                <rect x="3" y="14" width="7" height="7" />
                            </svg>
                        </div>
                        <div class="option-text">
                            <strong>Comfortable (Default) Mobile Mode</strong>
                            <span>Safe, well-balanced responsive design for mobile & tablet.</span>
                        </div>
                    </button>
                    <button class="responsive-option-btn" @click="applyResponsiveness('spacious')">
                        <div class="option-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="4" y="2" width="16" height="20" rx="2" />
                                <line x1="8" y1="6" x2="16" y2="6" />
                                <line x1="8" y1="10" x2="16" y2="10" />
                                <line x1="8" y1="14" x2="16" y2="14" />
                            </svg>
                        </div>
                        <div class="option-text">
                            <strong>Spacious / Accessible Mobile Mode</strong>
                            <span>Improves readability and tap accuracy on mobile devices.</span>
                        </div>
                    </button>
                </div>
                <div class="modal-actions">
                    <button @click="closeResponsivenessModal" class="modal-btn secondary">Cancel</button>
                </div>
            </div>
        </dialog>

        <!-- Style Toolbar for Text Edit -->
        <div v-if="textStyleBar.show" 
             class="style-toolbar" 
             :style="{ top: textStyleBar.top + 'px', left: textStyleBar.left + 'px' }">
            <div class="style-group">
                <label>Size</label>
                <input type="number" 
                       :value="parseInt(textStyleBar.fontSize)" 
                       @input="applyTextStyle('fontSize', $event.target.value + 'px')" 
                       min="8" max="100">
            </div>
            <div class="style-group">
                <label>Font</label>
                <select :value="textStyleBar.fontFamily" @change="applyTextStyle('fontFamily', $event.target.value)">
                    <option v-for="font in fontOptions" :key="font.value" :value="font.value">{{ font.label }}</option>
                </select>
            </div>
            <div class="style-group">
                <label>Weight</label>
                <select :value="textStyleBar.fontWeight" @change="applyTextStyle('fontWeight', $event.target.value)">
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="300">Light</option>
                    <option value="900">Black</option>
                </select>
            </div>
            <div class="style-group">
                <label>Color</label>
                <input type="color" :value="textStyleBar.color" @input="applyTextStyle('color', $event.target.value)">
            </div>
            <button class="close-toolbar" @click="textStyleBar.show = false">×</button>
        </div>
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

.inspect-btn {
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

.inspect-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.inspect-btn.active {
    background: #3b82f6;
    color: white;
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
.modal[open] {
    background: transparent;
    border: none;
    padding: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
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

/* Responsiveness Tool */
.response-tool-btn {
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

.response-tool-btn:hover {
    background: rgba(255, 255, 255, 0.3);
}

.responsive-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 20px 0;
}

.responsive-option-btn {
    background: #1a1a1a;
    border: 2px solid #3a3a3a;
    border-radius: 8px;
    padding: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 16px;
    transition: all 0.2s ease;
    color: white;
    text-align: left;
}

.responsive-option-btn:hover {
    border-color: #667eea;
    background: #333;
}

.option-icon {
    width: 40px;
    height: 40px;
    background: rgba(102, 126, 234, 0.1);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #667eea;
    flex-shrink: 0;
}

.option-icon svg {
    width: 24px;
    height: 24px;
}

.option-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.option-text strong {
    font-size: 14px;
    color: #fff;
}

.option-text span {
    font-size: 12px;
    color: #aaa;
}

/* Style Toolbar */
.style-toolbar {
    position: fixed;
    background: #2a2a2a;
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    gap: 12px;
    align-items: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    border: 1px solid #444;
    z-index: 2000;
    animation: toolSlideIn 0.2s ease;
}

@keyframes toolSlideIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.style-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.style-group label {
    font-size: 9px;
    text-transform: uppercase;
    color: #888;
    font-weight: bold;
}

.style-group input, .style-group select {
    background: #111;
    border: 1px solid #444;
    color: white;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    outline: none;
}

.style-group input[type="number"] {
    width: 45px;
}

.style-group input[type="color"] {
    width: 30px;
    height: 20px;
    padding: 0;
    border: none;
    cursor: pointer;
}

.close-toolbar {
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    margin-left: 4px;
}

.close-toolbar:hover {
    color: white;
}
</style>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
    savedComponents: {
        type: Array,
        default: () => []
    },
    currentPage: {
        type: Object,
        required: true
    }
});

const emit = defineEmits(['update-page', 'close-page', 'open-in-tab', 'delete-component']);

const showComponentModal = ref(false);
const searchQuery = ref('');
const pageTitle = ref(props.currentPage.title);

// Filter components by search
const filteredComponents = computed(() => {
    if (!searchQuery.value) return props.savedComponents;
    const query = searchQuery.value.toLowerCase();
    return props.savedComponents.filter(c => 
        c.name.toLowerCase().includes(query) ||
        c.html.toLowerCase().includes(query)
    );
});

// Get components added to  this page
const pageComponents = computed(() => {
    return props.currentPage.components.map(componentId => {
        return props.savedComponents.find(c => c.id === componentId);
    }).filter(Boolean);
});

const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
};

const addComponentToPage = (componentId) => {
    const updatedPage = {
        ...props.currentPage,
        components: [...props.currentPage.components, componentId]
    };
    emit('update-page', updatedPage);
    showComponentModal.value = false;
};

const removeComponentFromPage = (index) => {
    const updatedComponents = [...props.currentPage.components];
    updatedComponents.splice(index, 1);
    const updatedPage = {
        ...props.currentPage,
        components: updatedComponents
    };
    emit('update-page', updatedPage);
};

const moveComponentUp = (index) => {
    if (index === 0) return;
    const updatedComponents = [...props.currentPage.components];
    [updatedComponents[index - 1], updatedComponents[index]] = [updatedComponents[index], updatedComponents[index - 1]];
    const updatedPage = {
        ...props.currentPage,
        components: updatedComponents
    };
    emit('update-page', updatedPage);
};

const moveComponentDown = (index) => {
    if (index === props.currentPage.components.length - 1) return;
    const updatedComponents = [...props.currentPage.components];
    [updatedComponents[index], updatedComponents[index + 1]] = [updatedComponents[index + 1], updatedComponents[index]];
    const updatedPage = {
        ...props.currentPage,
        components: updatedComponents
    };
    emit('update-page', updatedPage);
};

const updateTitle = () => {
    const updatedPage = {
        ...props.currentPage,
        title: pageTitle.value
    };
    emit('update-page', updatedPage);
};

const deleteComponentFromLibrary = (componentId) => {
    if (confirm('Delete this component from library? It will be removed from all pages.')) {
        emit('delete-component', componentId);
    }
};
</script>

<template>
    <div class="page-layout">
        <!-- Header -->
        <div class="page-header">
            <button class="back-btn" @click="$emit('close-page')" title="Back to Editor">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                </svg>
            </button>
            <input 
                v-model="pageTitle" 
                @blur="updateTitle"
                @keypress.enter="$event.target.blur()"
                class="page-title-input" 
                placeholder="Page Title"
            >
            <div class="header-actions">
                <button class="action-btn add-component-btn" @click="showComponentModal = true">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                    Add Component
                </button>
                <button class="action-btn open-tab-btn" @click="$emit('open-in-tab', currentPage)" :disabled="pageComponents.length === 0">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                    Open in New Tab
                </button>
            </div>
        </div>

        <!-- Page Canvas -->
        <div class="page-canvas">
            <div v-if="pageComponents.length === 0" class="empty-state">
                <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <h3>No components yet</h3>
                <p>Click "Add Component" to start building your page</p>
            </div>

            <div v-for="(component, index) in pageComponents" :key="index" class="component-card">
                <div class="component-header">
                    <h4>{{ component.name }}</h4>
                    <div class="component-actions">
                        <button 
                            class="icon-btn" 
                            @click="moveComponentUp(index)" 
                            :disabled="index === 0"
                            title="Move up"
                        >
                            ↑
                        </button>
                        <button 
                            class="icon-btn" 
                            @click="moveComponentDown(index)" 
                            :disabled="index === pageComponents.length - 1"
                            title="Move down"
                        >
                            ↓
                        </button>
                        <button 
                            class="icon-btn delete" 
                            @click="removeComponentFromPage(index)"
                            title="Remove"
                        >
                            ×
                        </button>
                    </div>
                </div>
                <div class="component-preview">
                    <iframe 
                        :srcdoc="`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <style>
                                    body { margin: 0; padding: 20px; font-family: sans-serif; }
                                    ${component.css || ''}
                                </style>
                            </head>
                            <body>
                                ${component.html || ''}
                                <script>
                                    // Handle internal script errors or prevent them from bubbing up
                                    window.onerror = function(msg) { console.error('Preview error:', msg); return true; };
                                    ${component.js || ''}
                                </script>
                            </body>
                            </html>
                        `"
                        class="preview-frame"
                        sandbox="allow-scripts"
                    ></iframe>
                </div>
            </div>
        </div>

        <!-- Component Library Modal -->
        <div v-if="showComponentModal" class="modal-overlay" @click="showComponentModal = false">
            <div class="modal-content" @click.stop>
                <div class="modal-header">
                    <h2>Component Library</h2>
                    <button class="close-btn" @click="showComponentModal = false">×</button>
                </div>
                
                <input 
                    v-model="searchQuery" 
                    class="search-input" 
                    placeholder="Search components..."
                >

                <div class="component-grid">
                    <div v-if="filteredComponents.length === 0" class="empty-state-small">
                        <p>{{ searchQuery ? 'No components found' : 'No components saved yet' }}</p>
                        <p class="hint">Create components from conversations using "Add to Component"</p>
                    </div>
                    
                    <div 
                        v-for="component in filteredComponents" 
                        :key="component.id"
                        class="library-component-card"
                    >
                        <div class="library-card-header">
                            <h3>{{ component.name }}</h3>
                            <div class="library-card-actions">
                                <button 
                                    class="icon-btn action-btn-orange" 
                                    @click="addComponentToPage(component.id)"
                                    title="Add to page"
                                >
                                    +
                                </button>
                                <button 
                                    class="icon-btn action-btn-gray" 
                                    @click="deleteComponentFromLibrary(component.id)"
                                    title="Delete"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                        <div class="library-card-date">{{ formatDate(component.dateCreated) }}</div>
                        <div class="library-card-preview">
                            <div class="code-preview">{{ component.thumbnail || component.html.substring(0, 100) }}...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.page-layout {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #0f0f0f;
    color: #e0e0e0;
}

.page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 24px;
    background: linear-gradient(135deg, #1a1a1a 0%, #151515 100%);
    border-bottom: 1px solid #2a2a2a;
}

.back-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: all 0.2s;
}

.back-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.back-btn .icon {
    width: 20px;
    height: 20px;
    stroke: #e0e0e0;
}

.page-title-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #fff;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 18px;
    font-weight: 600;
    transition: all 0.2s;
}

.page-title-input:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.08);
}

.header-actions {
    display: flex;
    gap: 12px;
}

.action-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
}

.add-component-btn {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
}

.add-component-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.open-tab-btn {
    background: linear-gradient(135deg, #20bf6b, #0eb875);
    color: white;
}

.open-tab-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(32, 191, 107, 0.4);
}

.open-tab-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.icon {
    width: 16px;
    height: 16px;
}

.page-canvas {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
}

.empty-icon {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    stroke: #444;
}

.empty-state h3 {
    font-size: 20px;
    margin: 0 0 8px 0;
    color: #999;
}

.empty-state p {
    margin: 0;
    font-size: 14px;
}

.component-card {
    background: linear-gradient(135deg, #1f1f1f 0%, #1a1a1a 100%);
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
    transition: all 0.3s;
}

.component-card:hover {
    border-color: #667eea;
    box-shadow: 0 4px 16px rgba(102, 126, 234, 0.2);
}

.component-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid #2a2a2a;
}

.component-header h4 {
    margin: 0;
    font-size: 16px;
    color: #e0e0e0;
}

.component-actions {
    display: flex;
    gap: 8px;
}

.icon-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    color: #e0e0e0;
}

.icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
}

.icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.icon-btn.delete:hover {
    background: #e74c3c;
    color: white;
}

.component-preview {
    padding: 0;
    min-height: 200px;
    background: white;
    border: none;
}

.preview-frame {
    width: 100%;
    height: 300px;
    border: none;
    display: block;
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
}

.modal-content {
    background: linear-gradient(135deg, #1f1f1f 0%, #1a1a1a 100%);
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    width: 100%;
    max-width: 1000px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid #2a2a2a;
}

.modal-header h2 {
    margin: 0;
    font-size: 20px;
    color: #e0e0e0;
}

.close-btn {
    background: transparent;
    border: none;
    font-size: 32px;
    cursor: pointer;
    color: #999;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
}

.close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e0e0e0;
}

.search-input {
    margin: 16px 24px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 14px;
    transition: all 0.2s;
}

.search-input:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.08);
}

.component-grid {
    flex: 1;
    overflow-y: auto;
    padding: 0 24px 24px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    align-content: start;
}

.empty-state-small {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px;
    color: #666;
}

.empty-state-small .hint {
    margin-top: 8px;
    font-size: 12px;
    color: #555;
}

.library-component-card {
    background: linear-gradient(135deg, #252525 0%, #1f1f1f 100%);
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 16px;
    transition: all 0.2s;
    cursor: pointer;
}

.library-component-card:hover {
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
}

.library-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
}

.library-card-header h3 {
    margin: 0;
    font-size: 16px;
    color: #e0e0e0;
    font-weight: 600;
}

.library-card-actions {
    display: flex;
    gap: 6px;
}

.action-btn-orange {
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    color: white;
}

.action-btn-orange:hover {
    background: linear-gradient(135deg, #ff5555, #dd4444);
}

.action-btn-gray {
    background: rgba(255, 255, 255, 0.1);
}

.library-card-date {
    font-size: 11px;
    color: #666;
    margin-bottom: 12px;
}

.library-card-preview {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 12px;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #999;
    max-height: 80px;
    overflow: hidden;
}

.code-preview {
    white-space: pre-wrap;
    word-break: break-all;
}

.page-canvas::-webkit-scrollbar,
.component-grid::-webkit-scrollbar {
    width: 8px;
}

.page-canvas::-webkit-scrollbar-track,
.component-grid::-webkit-scrollbar-track {
    background: transparent;
}

.page-canvas::-webkit-scrollbar-thumb,
.component-grid::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 4px;
}

.page-canvas::-webkit-scrollbar-thumb:hover,
.component-grid::-webkit-scrollbar-thumb:hover {
    background: #444;
}
</style>

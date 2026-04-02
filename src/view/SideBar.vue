<script setup>
const props = defineProps({
    isCollapsed: Boolean,
    currentModel: String,
    htmlCode: { type: String, default: '' },
    cssCode:  { type: String, default: '' },
    jsCode:   { type: String, default: '' },
    conversations: {
        type: Array,
        default: () => []
    },
    currentConversationId: String,
    pages: {
        type: Array,
        default: () => []
    },
    currentPageId: String,
    totalTokens: {
        type: Number,
        default: 0
    },
    totalUsageStats: {
        type: Object,
        default: () => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, billed_tokens: 0 })
    },
    lastUsage: {
        type: Object,
        default: () => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, billed_tokens: 0 })
    }
});

const emit = defineEmits([
    'toggle-sidebar',
    'update:currentModel',
    'new-conversation',
    'load-conversation',
    'delete-conversation',
    'rename-conversation',
    'new-page',
    'load-page',
    'delete-page',
    'close-page',
    'dissect-sections',
    'modernize-web',
    'modernize-website-complete',
    'reset-stats'
]);

import { ref, computed, onMounted, onUnmounted } from 'vue';
import ModernizeWebsite from './ModernizeWebsite.vue';
import DissectHTML from './DissectHTML.vue';
import { parseFullCode } from '../utils/codeParser';

const handleModernizeResult = (data) => {
  const { html, css, js } = parseFullCode(data.html);
  
  emit('modernize-website-complete', {
    html: html,
    css: css,
    js: js,
    url: data.url,
    analysis: data.analysis,
    usage: data.usage
  });
};

// Similarity Helper (Levenshtein Distance)
const getSimilarity = (s1, s2) => {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;
    
    // Simple edit distance
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) costs[j] = j;
            else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return (longer.length - costs[s2.length]) / parseFloat(longer.length);
};

const groupItems = (items) => {
    if (!items || items.length === 0) return [];
    
    // First, create the raw groups by similarity
    const rawGroups = [];
    items.forEach(item => {
        const text = (item.text || item.content || '').toLowerCase();
        const matchingGroup = rawGroups.find(g => {
            const groupText = (g.items[0].text || g.items[0].content || '').toLowerCase();
            return getSimilarity(text, groupText) > 0.7;
        });

        if (matchingGroup) {
            matchingGroup.items.push(item);
        } else {
            rawGroups.push({
                visible: true,
                items: [item]
            });
        }
    });

    // Now, separate groups from single items
    // If a group has only 1 item, we'll mark it for individual display
    return rawGroups.map(g => ({
        ...g,
        isSingle: g.items.length === 1
    }));
};

// State
const showTokenDetails = ref(false);
const activeTab = ref('chats'); // 'chats' or 'pages'

const toggleSidebar = () => {
    emit('toggle-sidebar');
};

const selectModel = (model) => {
    emit('update:currentModel', model);
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
};

const handleRename = (id, currentTitle) => {
    const newTitle = prompt('Enter new title:', currentTitle);
    if (newTitle) {
        emit('rename-conversation', { id, title: newTitle });
    }
};

const handleDelete = (id) => {
    if (confirm('Are you sure you want to delete this conversation?')) {
        emit('delete-conversation', id);
    }
};


// Modernize Web Logic
const modernizeModal = ref(null);
const confirmModernizeModal = ref(null);
const modernizeOptionsModal = ref(null);
const modernizeUrl = ref('');
const capturedScreenshot = ref('');
const isTakingScreenshot = ref(false);

const selectedTheme = ref('Professional');
const selectedColor = ref('Blue');

const themes = [
    'Professional', 'Flowery', 'Machinery', 'Medical', 'Retail', 
    'Minimalist', 'Cyberpunk', 'Playful', 'Brutalist', 'Luxury',
    'Vintage', 'Futuristic', 'Corporate', 'Industrial', 'Artistic',
    'Boho', 'Gothic', 'Steampunk', 'Retro', 'Modern','Neon'
];

const colors = [
    'White', 'Gray', 'Slate', 'Black',  // Monochrome
    'Brown',                            // Earth tones
    'Rose', 'Red', 'Pink',              // Reds/Pinks
    'Light Orange', 'Orange',           // Oranges
    'Gold', 'Yellow',                   // Yellows
    'Light Green', 'Lime', 'Green',     // Greens
    'Teal', 'Cyan',                     // Cyans/Teals
    'Light Blue', 'Blue',               // Blues
    'Indigo', 'Light Purple', 'Purple', 'Magenta' // Purples
];


const openModernizeModal = () => {
    modernizeModal.value?.showModal();
};

const closeModernizeModal = () => {
    modernizeModal.value?.close();
    modernizeUrl.value = '';
};

const handleModernizeWeb = async () => {
    if (!modernizeUrl.value.trim()) return;

    isTakingScreenshot.value = true;
    try {
        const response = await fetch('/api/screenshot-website-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: modernizeUrl.value })
        });
        
        if (!response.ok) throw new Error('Failed to capture website');
        
        const result = await response.json();
        
        capturedScreenshot.value = result.screenshotUrl;
        modernizeModal.value?.close();
        confirmModernizeModal.value?.showModal();
    } catch (error) {
        console.error('Error capturing website:', error);
        alert('Failed to capture website: ' + error.message);
    } finally {
        isTakingScreenshot.value = false;
    }
};

const startModernization = () => {
    confirmModernizeModal.value?.close();
    modernizeOptionsModal.value?.showModal();
};

const finalizeModernize = () => {
    emit('modernize-web', {
        screenshotUrl: capturedScreenshot.value,
        theme: selectedTheme.value,
        color: selectedColor.value
    });
    modernizeOptionsModal.value?.close();
    capturedScreenshot.value = '';
    modernizeUrl.value = '';
};

const cancelModernization = () => {
    confirmModernizeModal.value?.close();
    modernizeOptionsModal.value?.close();
    capturedScreenshot.value = '';
    modernizeUrl.value = '';
};


</script>

<template>
    <!-- Left Sidebar: Conversation History -->
    <aside class="sidebar" id="sidebar" :class="{ collapsed: isCollapsed }">
        <div class="sidebar-header">
            <div class="logo">
                <svg class="icon dom-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
                </svg>
                <h1 class="sidebar-title" v-if="!isCollapsed">Web Dev Playground</h1>
            </div>
            <button class="toggle-sidebar-btn" title="Toggle sidebar" @click="toggleSidebar">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
                </svg>
            </button>
        </div>

        <!-- Unified Action Header -->
        <div class="sidebar-actions-header" v-if="!isCollapsed">
            <div class="primary-actions">
                <button class="action-btn-main new-chat" @click="$emit('new-conversation')">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                    <span>New Chat</span>
                </button>
                <button class="action-btn-main new-page" @click="$emit('new-page')">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <span>New Page</span>
                </button>
            </div>
            <!-- <div class="secondary-tools">
                <button class="tool-btn" @click="openModernizeModal" title="Modernize Website">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    <span>Modernize</span>
                </button>
            </div> -->
            <div class="secondary-tools">
                <ModernizeWebsite @modernize-website="handleModernizeResult" />
            </div> 
            <div class="secondary-tools">
                <DissectHTML
                    :html-code="htmlCode"
                    :css-code="cssCode"
                    :js-code="jsCode"
                    @dissect-sections="$emit('dissect-sections', $event)"
                />
            </div>
        </div>

        <!-- Model Selection (Compact) -->
        <div class="model-selection-compact" v-if="!isCollapsed">
            <div 
                v-for="model in ['sonnet', 'haiku', 'opus', 'gemini']" 
                :key="model"
                class="model-chip"
                :class="{ active: currentModel === model, [model]: true }"
                @click="selectModel(model)"
            >
                {{ model.charAt(0).toUpperCase() + model.slice(1) }}
            </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="sidebar-tabs" v-if="!isCollapsed">
            <button 
                class="tab-btn" 
                :class="{ active: activeTab === 'chats' }"
                @click="activeTab = 'chats'"
            >
                Chats
                <span class="count">{{ conversations.length }}</span>
            </button>
            <button 
                class="tab-btn" 
                :class="{ active: activeTab === 'pages' }"
                @click="activeTab = 'pages'"
            >
                Pages
                <span class="count">{{ pages.length }}</span>
            </button>
        </div>

        <!-- Tab Content -->
        <div class="sidebar-scroll-content">
            <!-- Chats Panel -->
            <div class="tab-panel" v-if="activeTab === 'chats' || isCollapsed">
                <div 
                    v-for="conv in conversations" 
                    :key="conv.id"
                    class="item-row conversation-item"
                    :class="{ active: conv.id === currentConversationId }"
                    @click="
                        $emit('close-page');
                        $emit('load-conversation', conv.id);
                    "
                >
                    <div class="item-info">
                        <div class="item-title">{{ conv.title }}</div>
                        <div class="item-meta">{{ formatDate(conv.date) }}</div>
                    </div>
                    <div class="item-actions" v-if="!isCollapsed">
                        <button class="icon-btn" @click.stop="handleRename(conv.id, conv.title)" title="Rename">✏️</button>
                        <button class="icon-btn delete" @click.stop="handleDelete(conv.id)" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>

            <!-- Pages Panel -->
            <div class="tab-panel" v-if="activeTab === 'pages' && !isCollapsed">
                <div 
                    v-for="page in pages" 
                    :key="page.id"
                    class="item-row page-item"
                    :class="{ active: page.id === currentPageId }"
                    @click="$emit('load-page', page.id)"
                >
                    <div class="item-info">
                        <div class="item-title">{{ page.title }}</div>
                        <div class="item-meta">{{ formatDate(page.dateModified || page.dateCreated) }}</div>
                    </div>
                    <div class="item-actions">
                        <button class="icon-btn delete" @click.stop="$emit('delete-page', page.id)" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>
        </div>


        <!-- Modernize Modal -->
        <!-- <dialog ref="modernizeModal" class="sidebar-modal">
            <div class="sidebar-modal-content">
                <h3>Modernize Website</h3>
                <p>Enter a URL to capture its design. AI will then regenerate it with a modern look.</p>
                <div class="sidebar-input-group">
                    <label>URL</label>
                    <input 
                        v-model="modernizeUrl" 
                        type="url" 
                        placeholder="https://example.com"
                        @keyup.enter="handleModernizeWeb"
                    >
                </div>
                <div class="sidebar-modal-actions">
                    <button @click="closeModernizeModal" class="sidebar-modal-btn secondary" :disabled="isTakingScreenshot">Cancel</button>
                    <button @click="handleModernizeWeb" class="sidebar-modal-btn primary" :disabled="isTakingScreenshot">
                        {{ isTakingScreenshot ? 'Capturing...' : 'Capture Site' }}
                    </button>
                </div>
            </div>
        </dialog> -->

        <!-- Confirmation Modal -->
        <dialog ref="confirmModernizeModal" class="sidebar-modal preview-modal">
            <div class="sidebar-modal-content wide">
                <h3>Is this the correct website?</h3>
                <p>We captured a screenshot of the site. Click confirm to start modernizing it.</p>
                
                <div class="screenshot-preview" v-if="capturedScreenshot">
                    <img :src="capturedScreenshot" alt="Website Screenshot">
                </div>

                <div class="sidebar-modal-actions">
                    <button @click="cancelModernization" class="sidebar-modal-btn secondary">No, Cancel</button>
                    <button @click="startModernization" class="sidebar-modal-btn primary">Yes, Let's Style It!</button>
                </div>
            </div>
        </dialog>

        <!-- Modernize Options Modal -->
        <dialog ref="modernizeOptionsModal" class="sidebar-modal">
            <div class="sidebar-modal-content">
                <h3>Style Your Modernized Web</h3>
                <p>Choose a theme and color palette for the AI to follow.</p>
                
                <div class="options-grid">
                    <div class="sidebar-input-group">
                        <label>Theme Style</label>
                        <select v-model="selectedTheme" class="modernize-select">
                            <option v-for="theme in themes" :key="theme" :value="theme">
                                {{ theme }}
                            </option>
                        </select>
                    </div>
                    <div class="sidebar-input-group">
                        <label>Primary Color</label>
                        <div class="color-bubbles">
                            <button 
                                v-for="color in colors" 
                                :key="color"
                                class="color-bubble"
                                :class="{ active: selectedColor === color, [color.toLowerCase()]: true }"
                                :title="color"
                                @click="selectedColor = color"
                            ></button>
                        </div>
                    </div>
                </div>

                <div class="sidebar-modal-actions">
                    <button @click="cancelModernization" class="sidebar-modal-btn secondary">Cancel</button>
                    <button @click="finalizeModernize" class="sidebar-modal-btn primary">Finalize & Modernize</button>
                </div>
            </div>
        </dialog>

        <!-- Token Tracker -->
        <div class="token-tracker" v-if="!isCollapsed">
            <div class="token-header-row">
                <div class="token-header">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Usage Stats</span>
                </div>
                <button class="details-btn" @click="showTokenDetails = true" title="View Details">
                    <svg class="icon small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </button>
            </div>
            <div class="token-count">
                <span class="token-value">{{ totalTokens.toLocaleString() }}</span>
                <span class="token-label">Billed Tokens</span>
            </div>
        </div>

        <!-- Token Details Modal -->
        <div v-if="showTokenDetails" class="modal-overlay" @click.self="showTokenDetails = false">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Token Usage Details</h3>
                    <button class="close-btn" @click="showTokenDetails = false">&times;</button>
                </div>
                <div class="modal-body">
                    <table class="usage-table">
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th>Last Request</th>
                                <th>Total Lifetime</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Input Tokens</td>
                                <td>{{ lastUsage.input_tokens.toLocaleString() }}</td>
                                <td>{{ totalUsageStats.input_tokens.toLocaleString() }}</td>
                            </tr>
                            <tr>
                                <td>Output Tokens</td>
                                <td>{{ lastUsage.output_tokens.toLocaleString() }}</td>
                                <td>{{ totalUsageStats.output_tokens.toLocaleString() }}</td>
                            </tr>
                            <tr>
                                <td>Cache Write (Creation)</td>
                                <td>{{ lastUsage.cache_creation_input_tokens?.toLocaleString() || 0 }}</td>
                                <td>{{ totalUsageStats.cache_creation_input_tokens.toLocaleString() }}</td>
                            </tr>
                            <tr>
                                <td>Cache Read (Hit)</td>
                                <td>{{ lastUsage.cache_read_input_tokens?.toLocaleString() || 0 }}</td>
                                <td>{{ totalUsageStats.cache_read_input_tokens.toLocaleString() }}</td>
                            </tr>
                            </tbody>
                    </table>
                    <div class="modal-footer-actions">
                        <button class="reset-stats-btn" @click="$emit('reset-stats')">
                            <svg class="icon small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Reset All Stats
                        </button>
                    </div>
                    <p class="footnote">
                        * Billed = Input + Output + (Cache Write × 1.25) + (Cache Read × 0.1)<br>
                        Values are estimates based on Anthropic pricing logic.
                    </p>
                </div>
            </div>
        </div>
    </aside>
</template>

<style scoped>

/* ========== SIDEBAR BASE ========== */
.sidebar {
    background: linear-gradient(180deg, #18181b 0%, #09090b 100%);
    border-right: 1px solid #27272a;
    display: flex;
    flex-direction: column;
    height: 100%;
    width: var(--sidebar-width, 240px);
    min-width: 0;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    transition: opacity 0.2s ease;
}

.sidebar.collapsed {
    width: 48px;
}

.sidebar-header {
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #27272a;
}

.logo {
    display: flex;
    align-items: center;
    gap: 12px;
}

.logo .icon {
    color: #ef4444;
}

.sidebar-title {
    font-size: 14px;
    font-weight: 700;
    color: #fafafa;
    white-space: nowrap;
    letter-spacing: -0.01em;
}

.toggle-sidebar-btn {
    background: #27272a;
    border: none;
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    color: #a1a1aa;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.toggle-sidebar-btn:hover {
    background: #3f3f46;
    color: #fafafa;
}

/* ========== UNIFIED ACTION HEADER ========== */
.sidebar-actions-header {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-bottom: 1px solid #27272a;
}

.primary-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.action-btn-main {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    border: none;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
}

.action-btn-main.new-chat {
    background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
}

.action-btn-main.new-page {
    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.action-btn-main:hover {
    transform: translateY(-1px);
    filter: brightness(1.1);
}

.secondary-tools {
    display: flex;
    
}

.tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    color: #d4d4d8;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
}

.tool-btn:hover {
    background: #27272a;
    border-color: #3f3f46;
    color: #fafafa;
}

/* ========== MODEL SELECTION CHIPS ========== */
.model-selection-compact {
    padding: 12px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-bottom: 1px solid #27272a;
}

.model-chip {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    background: #18181b;
    border: 1px solid #27272a;
    color: #71717a;
    transition: all 0.2s;
}

.model-chip.active {
    border-color: currentColor;
    background: rgba(255,255,255,0.05);
}

.model-chip.sonnet.active { color: #a855f7; }
.model-chip.haiku.active { color: #22c55e; }
.model-chip.opus.active { color: #f97316; }
.model-chip.gemini.active { color: #3b82f6; }

/* ========== TABS ========== */
.sidebar-tabs {
    display: flex;
    padding: 4px;
    background: #09090b;
    margin: 12px 16px;
    border-radius: 8px;
    border: 1px solid #27272a;
}

.tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #71717a;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.tab-btn.active {
    background: #27272a;
    color: #fafafa;
}

.tab-btn .count {
    background: #3f3f46;
    color: #a1a1aa;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 9px;
}

/* ========== SCROLLABLE CONTENT ========== */
.sidebar-scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 16px;
}

.tab-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.item-row {
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: all 0.2s;
    border: 1px solid transparent;
}

.item-row:hover {
    background: #18181b;
    border-color: #27272a;
}

.item-row.active {
    background: #27272a;
    border-color: #3f3f46;
}

.item-info {
    flex: 1;
    min-width: 0;
}

.item-title {
    font-size: 13px;
    font-weight: 500;
    color: #e4e4e7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.item-meta {
    font-size: 10px;
    color: #71717a;
    margin-top: 2px;
}

.item-actions {
    display: none;
    gap: 4px;
}

.item-row:hover .item-actions {
    display: flex;
}

.icon-btn {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    font-size: 14px;
    opacity: 0.6;
    transition: all 0.2s;
}

.icon-btn:hover {
    opacity: 1;
    background: rgba(255,255,255,0.05);
    border-radius: 4px;
}

.icon-btn.delete:hover {
    filter: sepia(100%) hue-rotate(-50deg) saturate(200%);
}

/* ========== TOKEN TRACKER ========== */
.token-tracker {
    
    padding: 16px;
    background: #18181b;
    border-top: 1px solid #27272a;
}

.token-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.token-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: goldenrod;
}

.details-btn {
    background: transparent;
    border: none;
    color: #71717a;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: color 0.2s;
}

.details-btn:hover {
    color: #fafafa;
}

.token-count {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: goldenrod;
}

.token-value {
    font-size: 20px;
    font-weight: 700;
    color: goldenrod;
}

.token-label {
    font-size: 10px;
    color: goldenrod;
}

/* ========== MODALS ========== */
.sidebar-modal {
    background: transparent;
    border: none;
    padding: 0;
    color: #fafafa;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

.sidebar-modal::backdrop {
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
}

.sidebar-modal-content {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    margin: auto;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.sidebar-modal-content.wide {
    max-width: 800px;
}

.sidebar-modal h3 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 8px;
}

.sidebar-modal p {
    font-size: 14px;
    color: #a1a1aa;
    margin-bottom: 24px;
}

.sidebar-input-group {
    margin-bottom: 24px;
}

.sidebar-input-group label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #71717a;
    margin-bottom: 8px;
}

/* Review Modal Premium Styles */
.modal-premium-header {
    margin-bottom: 24px;
    border-bottom: 1px solid #27272a;
    padding-bottom: 20px;
}

.premium-badge {
    display: inline-block;
    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    color: white;
    font-size: 10px;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 12px;
}

.fetched-content-preview {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 24px;
    max-height: 50vh;
    overflow-y: auto;
    padding-right: 8px;
}

.fetched-content-preview::-webkit-scrollbar {
    width: 6px;
}

.fetched-content-preview::-webkit-scrollbar-track {
    background: transparent;
}

.fetched-content-preview::-webkit-scrollbar-thumb {
    background: #27272a;
    border-radius: 10px;
}

.content-section label {
    font-size: 11px;
    color: #3b82f6;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: block;
}

.content-value-box {
    background: #09090b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 16px;
    color: #e4e4e7;
    font-size: 14px;
    line-height: 1.6;
}

.title-box {
    font-weight: 700;
    font-size: 18px;
    background: linear-gradient(90deg, #18181b 0%, #09090b 100%);
}

.text-box pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
}

.headings-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.tag {
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
}

.h1-tag {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    color: #60a5fa;
}

.h2-tag {
    background: rgba(168, 85, 247, 0.1);
    border: 1px solid rgba(168, 85, 247, 0.2);
    color: #c084fc;
}

/* ========== SELECTION UI ========== */
.fetched-content-preview {
    position: relative;
    user-select: none;
}

.selection-box-overlay {
    position: absolute;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid #3b82f6;
    border-radius: 4px;
    pointer-events: none;
    z-index: 1000;
}

.selection-group {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 20px;
}

.group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #27272a;
}

.group-title {
    font-size: 12px;
    font-weight: 700;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.group-actions {
    display: flex;
    gap: 8px;
}

.group-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
}

.group-btn:hover {
    background: #2563eb;
    transform: translateY(-1px);
}

.group-btn.secondary {
    background: #27272a;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
}

.group-btn.secondary:hover {
    background: #3f3f46;
}

.section-hint {
    font-size: 11px;
    color: #71717a;
    margin: -4px 0 12px 0;
    line-height: 1.4;
}

/* Color Pickers */
.colors-section {
    border-top: 1px solid #27272a;
    padding-top: 24px;
    margin-top: 24px;
}

.color-pickers-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    background: #09090b;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid #27272a;
}

.color-picker-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.color-picker-label {
    font-size: 11px;
    color: #a1a1aa;
    font-weight: 500;
}

.color-input-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
}

.color-input-wrapper input[type="color"] {
    -webkit-appearance: none;
    border: none;
    width: 32px;
    height: 32px;
    cursor: pointer;
    background: none;
    padding: 0;
}

.color-input-wrapper input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
}

.color-input-wrapper input[type="color"]::-webkit-color-swatch {
    border: 2px solid #27272a;
    border-radius: 8px;
}

.color-hex {
    font-size: 12px;
    color: #e4e4e7;
    font-family: monospace;
}

.selection-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #27272a;
    border: 1px solid #27272a;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
}

.selection-item {
    background: #09090b;
    padding: 10px 14px;
    transition: background 0.2s;
}

.selection-item:hover {
    background: #18181b;
}

.checkbox-container {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    position: relative;
    user-select: none;
    width: 100%;
}

.item-text {
    font-size: 13px;
    color: #e4e4e7;
    flex-grow: 1;
    font-weight: 500;
}

.item-hint {
    font-size: 10px;
    color: #71717a;
    background: #18181b;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #27272a;
}

/* Custom Checkbox */
.checkbox-container input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
}

.checkmark {
    height: 18px;
    width: 18px;
    background-color: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 4px;
    position: relative;
    flex-shrink: 0;
}

.checkbox-container:hover input ~ .checkmark {
    border-color: #3b82f6;
}

.checkbox-container input:checked ~ .checkmark {
    background-color: #3b82f6;
    border-color: #3b82f6;
}

.checkmark:after {
    content: "";
    position: absolute;
    display: none;
    left: 6px;
    top: 2px;
    width: 4px;
    height: 9px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}

.checkbox-container input:checked ~ .checkmark:after {
    display: block;
}

/* Selection Grid for Main Content */
.selection-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.selection-card {
    background: #09090b;
    border: 1px solid #27272a;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    transition: all 0.2s;
    cursor: pointer;
    display: flex;
    flex-direction: column;
}

.selection-card:hover {
    border-color: #3f3f46;
    transform: translateY(-2px);
}

.selection-card.selected {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
}

.card-checkbox {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    background: rgba(9, 9, 11, 0.8);
    border-radius: 4px;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.card-checkbox input {
    width: 16px;
    height: 16px;
    cursor: pointer;
    margin: 0;
}

.card-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-grow: 1;
}

.preview-img {
    width: 100%;
    height: 140px;
    object-fit: contain;
    border-radius: 8px;
    background: #18181b;
}

.preview-text {
    font-size: 12px;
    color: #e4e4e7;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.6;
    min-height: 80px;
}

.item-type-badge {
    align-self: flex-start;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    color: #3b82f6;
    background: rgba(59, 130, 246, 0.1);
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.05em;
}

.empty-state {
    text-align: center;
    padding: 40px 20px;
    background: #09090b;
    border: 1px dashed #27272a;
    border-radius: 12px;
    color: #71717a;
    font-size: 14px;
}

.btn-content {
    display: flex;
    align-items: center;
    gap: 8px;
}

.sidebar-input-group input {
    width: 100%;
    background: #09090b;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 12px;
    color: #fafafa;
    font-size: 14px;
    outline: none;
}

.sidebar-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

.sidebar-modal-btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
}

.sidebar-modal-btn.primary {
    background: #ef4444;
    color: white;
}

.sidebar-modal-btn.secondary {
    background: #27272a;
    color: #fafafa;
}

.screenshot-preview {
    margin-bottom: 24px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #27272a;
    max-height: 50vh;
    overflow-y: auto;
}

.screenshot-preview img {
    width: 100%;
    display: block;
}

/* ========== MODERNIZE OPTIONS ========== */
.modernize-select {
    width: 100%;
    background: #09090b;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 12px;
    color: #fafafa;
    font-size: 14px;
    outline: none;
    cursor: pointer;
}

.color-bubbles {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
}

.color-bubble {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
}

.color-bubble:hover {
    transform: scale(1.1);
}

.color-bubble.active {
    border-color: #fafafa;
    transform: scale(1.1);
}

.color-bubble.blue { background-color: #3b82f6; }
.color-bubble.red { background-color: #ef4444; }
.color-bubble.green { background-color: #22c55e; }
.color-bubble.purple { background-color: #a855f7; }
.color-bubble.orange { background-color: #f97316; }
.color-bubble.pink { background-color: #ec4899; }
.color-bubble.teal { background-color: #14b8a6; }
.color-bubble.gold { background-color: #eab308; }
.color-bubble.slate { background-color: #64748b; }
.color-bubble.rose { background-color: #f43f5e; }
.color-bubble.white { background-color: #ffffff; }
.color-bubble.black { background-color: #000000; }
.color-bubble.yellow { background-color: #ffff00; }
.color-bubble.gray { background-color: #808080; }
.color-bubble.brown { background-color: #a52a2a; }
.color-bubble.cyan { background-color: #00ffff; }
.color-bubble.magenta { background-color: #ff00ff; }
.color-bubble.lime { background-color: #00ff00; }
.color-bubble.indigo { background-color: #4b0082; }
.color-bubble.light-blue { background-color: #add8e6; }
.color-bubble.light-green { background-color: #90ee90; }
.color-bubble.light-purple { background-color: #d8bfd8; }
.color-bubble.light-orange { background-color: #ffb347; }

/* ========== TOKEN DETAILS MODAL ========== */
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
    backdrop-filter: blur(4px);
}

.modal-content {
    background: #18181b;
    border-radius: 16px;
    width: 90%;
    max-width: 500px;
    border: 1px solid #27272a;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #27272a;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h3 { font-size: 16px; margin: 0; }

.close-btn {
    background: transparent;
    border: none;
    color: #71717a;
    font-size: 24px;
    cursor: pointer;
}

.modal-body { padding: 20px; }

.usage-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.usage-table th {
    text-align: left;
    color: #71717a;
    padding: 8px;
    border-bottom: 1px solid #27272a;
}

.usage-table td { padding: 12px 8px; color: #e4e4e7; }

.total-row td { border-top: 1px solid #3f3f46; color: #fafafa; font-weight: 700; }

.footnote { font-size: 11px; color: #71717a; margin-top: 16px; font-style: italic; }

/* ========== HELPERS ========== */
.icon {
    width: 20px;
    height: 20px;
}

.icon.small { width: 14px; height: 14px; }

::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-thumb {
    background: #27272a;
    border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
    background: #3f3f46;
}
</style>.usage-table th, .usage-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #333;
}

.total-row {
    background: rgba(37, 99, 235, 0.1);
    color: #60a5fa;
}

.modal-footer-actions {
    margin-top: 20px;
    display: flex;
    justify-content: center;
}

.reset-stats-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px;
    color: #f87171;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.reset-stats-btn:hover {
    background: #ef4444;
    color: white;
    border-color: #ef4444;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
}

.reset-stats-btn .icon {
    width: 14px;
    height: 14px;
}

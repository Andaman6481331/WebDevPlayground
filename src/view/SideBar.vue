<script setup>
import { computed } from 'vue';

const props = defineProps({
    isCollapsed: Boolean,
    currentModel: String,
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
    'close-page'
]);

import { ref } from 'vue';
const showTokenDetails = ref(false);

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
                <h1 class="sidebar-title">Web Dev Playground</h1>
            </div>
            <button class="toggle-sidebar-btn" title="Toggle sidebar" @click="toggleSidebar">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
                </svg>
            </button>
        </div>

        <!-- Model Selection -->
        <div class="model-selection">
            <div 
                class="model-item" 
                :class="{ active: currentModel === 'sonnet' }"
                @click="selectModel('sonnet')"
                title="Claude 3.5 Sonnet"
            >
                <div class="model-color model-purple"></div>
                <span class="model-name">Sonnet</span>
            </div>
            <div 
                class="model-item" 
                :class="{ active: currentModel === 'haiku' }"
                @click="selectModel('haiku')"
                title="Claude 3 Haiku"
            >
                <div class="model-color model-green"></div>
                <span class="model-name">Haiku</span>
            </div>
            <div 
                class="model-item" 
                :class="{ active: currentModel === 'opus' }"
                @click="selectModel('opus')"
                title="Claude 3 Opus"
            >
                <div class="model-color model-orange"></div>
                <span class="model-name">Opus</span>
            </div>
            <div 
                class="model-item" 
                :class="{ active: currentModel === 'gemini' }"
                @click="selectModel('gemini')"
                title="Gemini 2.0 Flash"
            >
                <div class="model-color model-blue"></div>
                <span class="model-name">Gemini</span>
            </div>
        </div>

        <!-- Page Buttons (Placeholder for now as logic wasn't fully detailed in temp.js for Pages) -->
        <button class="new-page-btn" @click="$emit('new-page')">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            <span class="btn-text">New Page</span>
        </button>


        <!-- Page List -->
        <div class="page-list">
            <div 
                v-for="page in pages" 
                :key="page.id"
                class="page-item"
                :class="{ active: page.id === currentPageId }"
                @click="$emit('load-page', page.id)"
            >
                <div class="page-info">
                    <div class="conversation-title">{{ page.title }}</div>
                    <div class="conversation-date">{{ formatDate(page.dateModified || page.dateCreated) }}</div>
                </div>
                <div class="conversation-actions" style="width: max-content;">
                    <button class="action-btn delete-btn" @click.stop="$emit('delete-page', page.id)" title="Delete">
                        🗑️
                    </button>
                </div>
            </div>
        </div>


        <!-- New Conversation Button -->
        <button class="new-conversation-btn" @click="$emit('new-conversation')">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            <span class="btn-text">New Conversation</span>
        </button>

        <!-- Conversation List -->
        <div class="conversation-list">
            <div 
                v-for="conv in conversations" 
                :key="conv.id"
                class="conversation-item"
                :class="{ 
                    active: conv.id === currentConversationId 
                }"
                @click="
                    $emit('close-page');
                    $emit('load-conversation', conv.id);
                "
            >
                <div class="conversation-info">
                    <div class="conversation-title">{{ conv.title }}</div>
                    <div class="conversation-date">{{ formatDate(conv.date) }}</div>
                </div>
                <div class="conversation-actions" >
                    <button class="action-btn rename-btn" @click.stop="handleRename(conv.id, conv.title)" title="Rename">
                        ✏️
                    </button>
                    <button class="action-btn delete-btn" @click.stop="handleDelete(conv.id)" title="Delete">
                        🗑️
                    </button>
                </div>
            </div>
        </div>

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
                            <tr class="total-row">
                                <td><strong>Estimated Billed</strong></td>
                                <td><strong>{{ lastUsage.billed_tokens.toLocaleString() }}</strong></td>
                                <td><strong>{{ totalUsageStats.billed_tokens.toLocaleString() }}</strong></td>
                            </tr>
                        </tbody>
                    </table>
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
/* ========== LEFT SIDEBAR ========== */
.sidebar {
    grid-column: 1;
    grid-row: 1 / 5;
    background: linear-gradient(180deg, #1a1a1a 0%, #151515 100%);
    border-right: 1px solid #2a2a2a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.3s ease;
    position: relative;
    height: 100%;
    width: 280px;
}

.sidebar.collapsed {
    width: 48px;
    min-width: 48px;
}

.sidebar.collapsed .sidebar-title,
.sidebar.collapsed .model-name,
.sidebar.collapsed .btn-text,
.sidebar.collapsed .conversation-title,
.sidebar.collapsed .conversation-date {
    opacity: 0;
    display: none;
}

.sidebar-header {
    padding: 16px 12px;
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.icon {
    width: 20px;
    height: 20px;
}

.logo {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
}

.logo .icon {
    color: #ff6b6b;
    flex-shrink: 0;
}

.logo h1 {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.toggle-sidebar-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.toggle-sidebar-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.toggle-sidebar-btn .icon {
    width: 16px;
    height: 16px;
    stroke: #999;
    transition: transform 0.3s ease;
}

.sidebar.collapsed .toggle-sidebar-btn .icon {
    transform: rotate(180deg);
}

/* Model Selection */
.model-selection {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid #2a2a2a;
}

.model-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 13px;
    color: #999;
}

.model-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
}

.model-item.active {
    background: rgba(255, 107, 107, 0.15);
    color: #ff6b6b;
}

.model-color {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
}

.model-red {
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
}

.model-orange {
    background: linear-gradient(135deg, #ffa500, #ff8c00);
}

.model-blue {
    background: linear-gradient(135deg, #4a90e2, #357abd);
}

.model-name {
    white-space: nowrap;
}

/* New Conversation Button */
.new-page-btn {
    margin: 12px;
    padding: 10px 12px;
    background: linear-gradient(135deg, #3446ec, #2e3de4);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.new-page-btn:hover {
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.new-page-btn .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

/* Conversation List */
.page-list {
    /* flex: 1; */
    overflow-y: auto;
    padding: 8px;
}

.page-item {
    padding: 10px;
    margin-bottom: 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.page-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.page-item.active {
    background: rgba(255, 107, 107, 0.2);
    border-left: 3px solid #ff6b6b;
    border-right: 1px solid rgba(255, 107, 107, 0.3);
    box-shadow: inset 0 0 10px rgba(255, 107, 107, 0.05);
}



.page-info {
    flex: 1;
    min-width: 0;
    /* For ellipsis to work */
}

.page-item .conversation-actions {
    display: none;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
}

.page-item:hover .conversation-actions {
    display: flex;
}

.close-page-btn {
    background: #8a8a8aac;
    border: 1px solid #8d8d8db3;
    border-radius: 8px;
    padding: 12px;
    margin: 10px;
    transition: all 0.2s ease;
    align-items: center;
}

.close-page-btn:hover {
    cursor: pointer;
    background: #a2a2a2ac;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}
/* Custom Scrollbar */
.conversation-list::-webkit-scrollbar{
    width: 6px;
}

.conversation-list::-webkit-scrollbar-track {
    background: transparent;
}

.conversation-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
}

.conversation-list::-webkit-scrollbar-thumb:hover{
    background: #444;
}
/* New Conversation Button */
.new-conversation-btn {
    margin: 12px;
    padding: 10px 12px;
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.new-conversation-btn:hover {
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.new-conversation-btn .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

.conversation-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
}

.conversation-item {
    padding: 10px;
    margin-bottom: 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.conversation-item:hover {
    background: rgba(255, 255, 255, 0.05);
}



.conversation-info {
    flex: 1;
    min-width: 0;
}

.conversation-title {
    font-size: 12px;
    color: #e0e0e0;
    margin-bottom: 4px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 120px;
}

.conversation-date {
    font-size: 10px;
    color: #666;
}

.conversation-actions {
    display: none;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
}

/* .conversation-item:hover .conversation-actions {
    display: flex;
} */

.action-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    padding: 4px;
    border-radius: 4px;
    opacity: 0.7;
    transition: all 0.2s;
}

.action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    opacity: 1;
}

/* Token Tracker */
.token-tracker {
    margin: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.token-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.token-header .icon {
    width: 14px;
    height: 14px;
    color: #ffb86c;
}

.token-count {
    display: flex;
    align-items: baseline;
    gap: 4px;
}

.token-value {
    font-size: 18px;
    font-weight: 700;
    color: #ffb86c;
}

.token-label {
    font-size: 10px;
    color: #666;
    font-weight: 500;
}
</style>
<style scoped>
/* ========== LEFT SIDEBAR ========== */
.sidebar {
    grid-column: 1;
    grid-row: 1 / 5;
    background: linear-gradient(180deg, #1a1a1a 0%, #151515 100%);
    border-right: 1px solid #2a2a2a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.3s ease;
    position: relative;
}

.sidebar.collapsed {
    width: 48px;
    min-width: 48px;
}

.sidebar.collapsed .sidebar-title,
.sidebar.collapsed .model-name,
.sidebar.collapsed .btn-text,
.sidebar.collapsed .conversation-title,
.sidebar.collapsed .conversation-date {
    opacity: 0;
    display: none;
}

.sidebar-header {
    padding: 16px 12px;
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.icon {
    width: 20px;
    height: 20px;
}

.logo {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
}

.logo .icon {
    color: #ff6b6b;
    flex-shrink: 0;
}

.logo h1 {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.toggle-sidebar-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.toggle-sidebar-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.toggle-sidebar-btn .icon {
    width: 16px;
    height: 16px;
    stroke: #999;
    transition: transform 0.3s ease;
}

.sidebar.collapsed .toggle-sidebar-btn .icon {
    transform: rotate(180deg);
}

/* Model Selection */
.model-selection {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid #2a2a2a;
}

.model-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 13px;
    color: #999;
}

.model-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
}

.model-item.active {
    background: rgba(255, 107, 107, 0.15);
    color: #ff6b6b;
}

.model-color {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
}


.model-purple {
    background: linear-gradient(135deg, #a55eea, #8854d0);
}

.model-green {
    background: linear-gradient(135deg, #20bf6b, #0eb875);
}

.model-orange {
    background: linear-gradient(135deg, #ffa500, #ff8c00);
}

.model-name {
    white-space: nowrap;
}

/* New Conversation Button */
.new-page-btn {
    margin: 12px;
    padding: 10px 12px;
    background: linear-gradient(135deg, #3446ec, #2e3de4);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.new-page-btn:hover {
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.new-page-btn .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

/* Conversation List */
.page-list {
    /* flex: 1; */
    overflow-y: auto;
    padding: 8px;
}

.page-item {
    padding: 10px;
    margin-bottom: 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.page-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.page-item.active {
    background: rgba(255, 107, 107, 0.2);
    border-left: 3px solid #ff6b6b;
    border-right: 1px solid rgba(255, 107, 107, 0.3);
    box-shadow: inset 0 0 10px rgba(255, 107, 107, 0.05);
}



.page-info {
    flex: 1;
    min-width: 0;
    /* For ellipsis to work */
}

.page-item .conversation-actions {
    display: none;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
}

.page-item:hover .conversation-actions {
    display: flex;
}

.close-page-btn {
    background: #8a8a8aac;
    border: 1px solid #8d8d8db3;
    border-radius: 8px;
    padding: 12px;
    margin: 10px;
    transition: all 0.2s ease;
    align-items: center;
}

.close-page-btn:hover {
    cursor: pointer;
    background: #a2a2a2ac;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}
/* Custom Scrollbar */
.conversation-list::-webkit-scrollbar{
    width: 6px;
}

.conversation-list::-webkit-scrollbar-track {
    background: transparent;
}

.conversation-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
}

.conversation-list::-webkit-scrollbar-thumb:hover{
    background: #444;
}
/* New Conversation Button */
.new-conversation-btn {
    margin: 12px;
    padding: 10px 12px;
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.new-conversation-btn:hover {
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.new-conversation-btn .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

/* Conversation List */
.conversation-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
}

.conversation-item {
    padding: 10px;
    margin-bottom: 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.conversation-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.conversation-item.active {
    background: rgba(255, 107, 107, 0.2);
    border-left: 3px solid #ff6b6b;
    border-right: 1px solid rgba(255, 107, 107, 0.3);
    box-shadow: inset 0 0 10px rgba(255, 107, 107, 0.05);
}

.conversation-info {
    flex: 1;
    min-width: 0;
    /* For ellipsis to work */
}

.conversation-item .conversation-actions {
    display: none;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
}

.conversation-item:hover .conversation-actions {
    display: flex;
}

.action-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    padding: 4px;
    border-radius: 4px;
    opacity: 0.7;
    transition: all 0.2s;
}

.action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    opacity: 1;
}

.conversation-title, .page-title {
    font-size: 12px;
    color: #e0e0e0;
    margin-bottom: 4px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.conversation-date, .page-date {
    font-size: 10px;
    color: #666;
}

/* Token Tracker */
.token-tracker {
    margin: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.token-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.token-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.token-header .icon {
    width: 14px;
    height: 14px;
    color: #ffb86c;
}

.details-btn {
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
}

.details-btn:hover {
    color: #e0e0e0;
    background: rgba(255, 255, 255, 0.1);
}

.details-btn .icon.small {
    width: 14px;
    height: 14px;
}

.token-count {
    display: flex;
    align-items: baseline;
    gap: 4px;
}

.token-value {
    font-size: 18px;
    font-weight: 700;
    color: #ffb86c;
}

.token-label {
    font-size: 10px;
    color: #666;
    font-weight: 500;
}

/* Modal Styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
}

.modal-content {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 12px;
    width: 90%;
    max-width: 500px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
}

.modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #252525;
    border-radius: 12px 12px 0 0;
}

.modal-header h3 {
    margin: 0;
    font-size: 16px;
    color: #e0e0e0;
    font-weight: 600;
}

.close-btn {
    background: transparent;
    border: none;
    color: #888;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
}

.close-btn:hover {
    color: #fff;
}

.modal-body {
    padding: 20px;
}

.usage-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: #e0e0e0;
    margin-bottom: 16px;
}

.usage-table tr {
    border-bottom: 1px solid #2a2a2a;
}

.usage-table th, .usage-table td {
    padding: 12px 8px;
    text-align: right;
}

.usage-table th:first-child, .usage-table td:first-child {
    text-align: left;
    padding-left: 4px;
}

.usage-table th {
    color: #888;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
    padding-bottom: 8px;
}

.usage-table tr:last-child {
    border-bottom: none;
}

.usage-table .total-row td {
    color: #ffb86c;
    font-size: 14px;
    border-top: 2px solid #333;
    padding-top: 16px;
    font-weight: 600;
}

.footnote {
    margin: 0;
    font-size: 11px;
    color: #666;
    line-height: 1.4;
    text-align: center;
}
</style>
<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import Sidebar from './view/SideBar.vue';
import LivePreview from './view/LivePreview.vue';
import AssistantChat from './view/AssistantChat.vue';
import CodeEditor from './view/CodeEditor.vue';
import PageLayout from './view/PageLayout.vue';

// ========== STATE ==========
const htmlCode = ref('<div class="container">\n    <h1>Welcome to Web Dev Playground</h1>\n    <p>Start coding and see live results!</p>\n</div>');
const cssCode = ref(`body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
    padding: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

h1 {
    color: #667eea;
    margin-bottom: 20px;
}

p {
    color: #555;
    font-size: 18px;
    line-height: 1.6;
}`);
const jsCode = ref(`// Add interactivity to your page
console.log('Welcome to Web Dev Playground!');`);

const isSidebarCollapsed = ref(localStorage.getItem('sidebar-collapsed') === 'true');
const currentModel = ref('sonnet');
const conversations = ref([]);
const currentConversationId = ref(null);
const chatMessages = ref([
    { role: 'assistant', content: "Welcome! I'm your coding assistant. Ask me anything about web development." }
]);
const isChatLoading = ref(false);
const totalTokens = ref(parseInt(localStorage.getItem('total-tokens')) || 0);

// Component Library & Pages
const savedComponents = ref([]);
const pages = ref([]);
const currentPageId = ref(null);
const isPageMode = ref(false);

// Computed current page
const currentPage = computed(() => {
    if (!currentPageId.value) return null;
    return pages.value.find(p => p.id === currentPageId.value);
});

// Watch for model changes
watch(currentModel, (newModel) => {
    const modelName = newModel.charAt(0).toUpperCase() + newModel.slice(1);
    chatMessages.value.push({
        role: 'assistant',
        content: `Switched to Claude 3 ${modelName} model.`
    });
});

// History State
const codeHistory = ref([]);
const historyIndex = ref(-1);
const MAX_HISTORY = 50;

// ========== LIFECYCLE ==========
onMounted(() => {
    loadConversationsData();
    if (conversations.value.length === 0) {
        initializeConversation();
    }
    
    // Set initial history
    saveToHistory();
    
    // Load components and pages
    loadSavedComponents();
    loadPages();
    
    document.documentElement.style.setProperty('--sidebar-width', isSidebarCollapsed.value ? '48px' : '240px');
});

// ========== LOGIC ==========

// Sidebar
const toggleSidebar = () => {
    isSidebarCollapsed.value = !isSidebarCollapsed.value;
    const newWidth = isSidebarCollapsed.value ? '48px' : '240px';
    document.documentElement.style.setProperty('--sidebar-width', newWidth);
    localStorage.setItem('sidebar-collapsed', isSidebarCollapsed.value);
};

// Conversations
const loadConversationsData = () => {
    const saved = localStorage.getItem('webdev_conversations');
    if (saved) {
        conversations.value = JSON.parse(saved);
        if (conversations.value.length > 0) {
            // Load most recent or first
            loadConversation(conversations.value[0].id);
        }
    }
};

const saveConversations = () => {
    try {
        localStorage.setItem('webdev_conversations', JSON.stringify(conversations.value));
    } catch (error) {
        console.error('Failed to save conversations to localStorage:', error);
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded. Some history might not be saved.');
        }
    }
};

const initializeConversation = () => {
    const conversationId = Date.now().toString();
    const conversation = {
        id: conversationId,
        title: 'New Conversation',
        date: new Date().toISOString(),
        messages: [],
        code: {
            html: '<p>Hello World</p>',
            css:  '',
            js: ''
        },
        history: [{ html: '<p>Hello World</p>', css: '', js: '' }],
        historyIndex: 0
    };
    conversations.value.unshift(conversation);
    saveConversations();
    loadConversation(conversationId);
};

const loadConversation = (id) => {
    // Save current state and history to the active conversation before switching
    if (currentConversationId.value) {
        const prevConv = conversations.value.find(c => c.id === currentConversationId.value);
        if (prevConv) {
            prevConv.code = { html: htmlCode.value, css: cssCode.value, js: jsCode.value };
            prevConv.history = [...codeHistory.value];
            prevConv.historyIndex = historyIndex.value;
        }
    }

    const conversation = conversations.value.find(c => c.id === id);
    if (conversation) {
        currentConversationId.value = id;
        
        if (conversation.code) {
            htmlCode.value = conversation.code.html || '';
            cssCode.value = conversation.code.css || '';
            jsCode.value = conversation.code.js || '';
        }
        
        chatMessages.value = [
            { role: 'assistant', content: "Welcome! I'm your coding assistant. Ask me anything about web development." },
            ...(conversation.messages || [])
        ];
        
        // Load history for the selected conversation or initialize if missing
        if (conversation.history && Array.isArray(conversation.history)) {
            codeHistory.value = [...conversation.history];
            historyIndex.value = conversation.historyIndex !== undefined ? conversation.historyIndex : codeHistory.value.length - 1;
        } else {
            codeHistory.value = [{ html: htmlCode.value, css: cssCode.value, js: jsCode.value }];
            historyIndex.value = 0;
            conversation.history = [...codeHistory.value];
            conversation.historyIndex = historyIndex.value;
            saveConversations();
        }
    }
};

const deleteConversation = (id) => {
    const index = conversations.value.findIndex(c => c.id === id);
    if (index === -1) return;
    
    conversations.value.splice(index, 1);
    saveConversations();
    
    if (currentConversationId.value === id) {
        if (conversations.value.length > 0) {
            loadConversation(conversations.value[0].id);
        } else {
            initializeConversation();
        }
    }
};

const renameConversation = ({ id, title }) => {
    const conversation = conversations.value.find(c => c.id === id);
    if (conversation) {
        conversation.title = title;
        saveConversations();
    }
};

// Undo/Redo
const saveToHistory = () => {
    const currentState = {
        html: htmlCode.value,
        css: cssCode.value,
        js: jsCode.value
    };
    
    // Check if state is different from current history state to avoid duplicates
    if (historyIndex.value >= 0 && codeHistory.value.length > 0) {
        const lastState = codeHistory.value[historyIndex.value];
        if (lastState.html === currentState.html && 
            lastState.css === currentState.css && 
            lastState.js === currentState.js) {
            return;
        }
    }

    if (historyIndex.value < codeHistory.value.length - 1) {
        codeHistory.value = codeHistory.value.slice(0, historyIndex.value + 1);
    }
    
    codeHistory.value.push(currentState);
    if (codeHistory.value.length > MAX_HISTORY) {
        codeHistory.value.shift();
    } else {
        historyIndex.value++;
    }

    // Sync to conversation object
    if (currentConversationId.value) {
        const conv = conversations.value.find(c => c.id === currentConversationId.value);
        if (conv) {
            conv.history = [...codeHistory.value];
            conv.historyIndex = historyIndex.value;
            saveConversations();
        }
    }
};

const undo = () => {
    if (historyIndex.value > 0) {
        historyIndex.value--;
        const state = codeHistory.value[historyIndex.value];
        htmlCode.value = state.html;
        cssCode.value = state.css;
        jsCode.value = state.js;
        
        // Sync index
        if (currentConversationId.value) {
            const conv = conversations.value.find(c => c.id === currentConversationId.value);
            if (conv) {
                conv.historyIndex = historyIndex.value;
                conv.code = { html: htmlCode.value, css: cssCode.value, js: jsCode.value };
                saveConversations();
            }
        }
    }
};

const redo = () => {
    if (historyIndex.value < codeHistory.value.length - 1) {
        historyIndex.value++;
        const state = codeHistory.value[historyIndex.value];
        htmlCode.value = state.html;
        cssCode.value = state.css;
        jsCode.value = state.js;

        // Sync index
        if (currentConversationId.value) {
            const conv = conversations.value.find(c => c.id === currentConversationId.value);
            if (conv) {
                conv.historyIndex = historyIndex.value;
                conv.code = { html: htmlCode.value, css: cssCode.value, js: jsCode.value };
                saveConversations();
            }
        }
    }
};

// Debounced history save on code change
let debounceTimer;
const onCodeUpdate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        saveToHistory();
        
        // Also save to current conversation
        if (currentConversationId.value) {
            const conv = conversations.value.find(c => c.id === currentConversationId.value);
            if (conv) {
                conv.code = { html: htmlCode.value, css: cssCode.value, js: jsCode.value };
                saveConversations();
            }
        }
    }, 1000);
};

watch([htmlCode, cssCode, jsCode], onCodeUpdate);

// Chat & AI
const handleSendMessage = async ({ text, attachment }) => {
    // Add user message
    const userMsg = { role: 'user', content: text || '(Image attached)', attachment };
    chatMessages.value.push(userMsg);
    
    // Save to conversation
    const conv = conversations.value.find(c => c.id === currentConversationId.value);
    if (conv) {
        if (!conv.messages) conv.messages = [];
        conv.messages.push({ ...userMsg, timestamp: new Date().toISOString() });
        
        // Update title if it's the first message
        if (conv.messages.length === 1 && text) {
            conv.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
        }
        saveConversations();
    }
    
    isChatLoading.value = true;
    
    try {
        const payload = {
            message: text,
            html: htmlCode.value,
            css: cssCode.value,
            javascript: jsCode.value,
            image: attachment ? attachment.dataUrl : null,
            model: currentModel.value
        };

        const response = await fetch(`/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        
        const data = await response.json();
        
        // Update code if returned
        if (data.html) htmlCode.value = data.html;
        if (data.css) cssCode.value = data.css;
        if (data.javascript) jsCode.value = data.javascript;
        
        // Update token usage
        const used = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
        if (data.usage) {
            totalTokens.value += used;
            localStorage.setItem('total-tokens', totalTokens.value);
            console.log(`Tokens used in this request: ${used}. Total: ${totalTokens.value}`);
        }
        
        // Add assistant message
        const explanation = (data.message || `I've updated the code based on your request.`) + `(${used} tokens used)`;
        const aiMsg = { role: 'assistant', content: explanation };
        chatMessages.value.push(aiMsg);
        
        if (conv) {
            conv.messages.push({ ...aiMsg, timestamp: new Date().toISOString() });
            saveConversations();
        }
        
    } catch (error) {
        console.error('AI Error:', error);
        chatMessages.value.push({ role: 'assistant', content: "Sorry, I encountered an error communicating with the server." });
    } finally {
        isChatLoading.value = false;
    }
};

const handleAIEdit = (message) => {
    // When editing via shape selection, we send the selection context as the message
    // We DON'T assume an attachment unless explicitly added (which isn't supported in this flow yet)
    handleSendMessage({ text: message, attachment: null });
};

const resetChat = () => {
    if (confirm('Clear chat history for this conversation?')) {
        chatMessages.value = [
            { role: 'assistant', content: "Welcome! I'm your coding assistant. Ask me anything about web development." }
        ];
        
        const conv = conversations.value.find(c => c.id === currentConversationId.value);
        if (conv) {
            conv.messages = [];
            saveConversations();
        }
    }
};

// Component Library Management
const loadSavedComponents = () => {
    const saved = localStorage.getItem('webdev_saved_components');
    if (saved) {
        savedComponents.value = JSON.parse(saved);
    }
};

const saveComponentToLibrary = () => {
    const componentName = prompt('Enter a name for this component:');
    if (!componentName) return;
    
    const component = {
        id: Date.now().toString(),
        name: componentName,
        html: htmlCode.value,
        css: cssCode.value,
        js: jsCode.value,
        dateCreated: new Date().toISOString(),
        thumbnail: htmlCode.value.substring(0, 100)
    };
    
    savedComponents.value.unshift(component);
    localStorage.setItem('webdev_saved_components', JSON.stringify(savedComponents.value));
    
    alert(`Component "${componentName}" saved successfully!`);
};

const deleteComponent = (id) => {
    if (confirm('Delete this component?')) {
        savedComponents.value = savedComponents.value.filter(c => c.id !== id);
        localStorage.setItem('webdev_saved_components', JSON.stringify(savedComponents.value));
    }
};

// Page Management
const loadPages = () => {
    const saved = localStorage.getItem('webdev_pages');
    if (saved) {
        pages.value = JSON.parse(saved);
    }
};

const createNewPage = () => {
    isPageMode.value = true;
    const pageId = Date.now().toString();
    const page = {
        id: pageId,
        title: 'Untitled Page',
        components: [],
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString()
    };
    pages.value.unshift(page);
    currentPageId.value = pageId;
    savePages();
};

const loadPage = (id) => {
    currentPageId.value = id;
    isPageMode.value = true;
};

const savePages = () => {
    localStorage.setItem('webdev_pages', JSON.stringify(pages.value));
};

const updatePage = (updatedPage) => {
    const index = pages.value.findIndex(p => p.id === updatedPage.id);
    if (index !== -1) {
        pages.value[index] = { ...updatedPage, dateModified: new Date().toISOString() };
        savePages();
    }
};

const deletePage = (id) => {
    if (confirm('Delete this page?')) {
        pages.value = pages.value.filter(p => p.id !== id);
        savePages();
        if (currentPageId.value === id) {
            isPageMode.value = false;
            currentPageId.value = null;
        }
    }
};

const closePage = () => {
    isPageMode.value = false;
    currentPageId.value = null;
};

const openPageInNewTab = (page) => {
    const fullHTML = generateFullHTML(page);
    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 100);
};

const generateFullHTML = (page) => {
    const pageComponents = page.components.map(componentId => {
        return savedComponents.value.find(c => c.id === componentId);
    }).filter(Boolean);
    
    const combinedHTML = pageComponents.map(c => c.html).join('\n');
    const combinedCSS = pageComponents.map(c => c.css).join('\n');
    const combinedJS = pageComponents.map(c => c.js).join('\n');
    
    const htmlDoc = '<!DOCTYPE html>\n' +
        '<html lang="en">\n' +
        '<head>\n' +
        '    <meta charset="UTF-8">\n' +
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '    <title>' + page.title + '</title>\n' +
        '    <style>\\n' +
        combinedCSS + '\\n' +
        '    </style>\\n' +
        '</head>\\n' +
        '<body>\\n' +
        combinedHTML + '\\n' +
        '    <scr' + 'ipt>\\n' +
        combinedJS + '\\n' +
        '    </scr' + 'ipt>\\n' +
        '</body>\\n' +
        '</html>';
    
    return htmlDoc;
};

</script>

<template>
    <div class="app-container">
        <!-- Sidebar -->
        <Sidebar 
            :is-collapsed="isSidebarCollapsed"
            :conversations="conversations"
            :current-conversation-id="currentConversationId"
            :pages="pages"
            :current-page-id="currentPageId"
            v-model:currentModel="currentModel"
            :total-tokens="totalTokens"
            @toggle-sidebar="toggleSidebar"
            @new-conversation="initializeConversation"
            @load-conversation="loadConversation"
            @delete-conversation="deleteConversation"
            @rename-conversation="renameConversation"
            @new-page="createNewPage"
            @load-page="loadPage"
            @delete-page="deletePage"
            @close-page="closePage"
        />

        <!-- Page Builder Mode -->
        <PageLayout 
            v-if="isPageMode && currentPage"
            :saved-components="savedComponents"
            :current-page="currentPage"
            @update-page="updatePage"
            @close-page="closePage"
            @open-in-tab="openPageInNewTab"
            @delete-component="deleteComponent"
        />

        <!-- Main Content (Editor Mode) -->
        <div v-else class="main-container">
            <div class="display-sections">
                <!-- Live Preview -->
                <LivePreview 
                    :html-code="htmlCode"
                    :css-code="cssCode"
                    :js-code="jsCode"
                    @undo="undo"
                    @redo="redo"
                    @update-code="handleAIEdit"
                    @direct-update-code="(code) => { htmlCode = code }"
                />
                
                <!-- Code Editor -->
                <CodeEditor 
                    v-model:htmlCode="htmlCode"
                    v-model:cssCode="cssCode"
                    v-model:jsCode="jsCode"
                />
            </div>
            
            <!-- Chat -->
            <div class="chat-section">
                <AssistantChat 
                    :messages="chatMessages"
                    :is-loading="isChatLoading"
                    @send-message="handleSendMessage"
                    @reset-chat="resetChat"
                    @save-component="saveComponentToLibrary"
                />
            </div>
        </div>
    </div>
</template>

<style scoped>
.app-container {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #0f0f0f;
    color: #e0e0e0;
}

.main-container {
    flex: 1;
    display: grid;
    grid-template-rows: 1fr 300px; /* Chat height fixed at bottom */
    height: 100vh;
    overflow: hidden;
}

.display-sections {
    display: grid;
    grid-template-columns: 1fr 400px; /* Editor width fixed on right */
    height: 100%;
    overflow: hidden;
}

/* Responsive adjustments if needed */
@media (max-width: 1024px) {
    .display-sections {
        grid-template-columns: 1fr 1fr;
    }
}
</style>

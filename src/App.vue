<script setup>
import { ref, onMounted, watch } from 'vue';
import Sidebar from './view/SideBar.vue';
import LivePreview from './view/LivePreview.vue';
import AssistantChat from './view/AssistantChat.vue';
import CodeEditor from './view/CodeEditor.vue';

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
const currentModel = ref('gpt4');
const conversations = ref([]);
const currentConversationId = ref(null);
const chatMessages = ref([
    { role: 'assistant', content: "Welcome! I'm your coding assistant. Ask me anything about web development." }
]);
const isChatLoading = ref(false);

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
    localStorage.setItem('webdev_conversations', JSON.stringify(conversations.value));
};

const initializeConversation = () => {
    const conversationId = Date.now().toString();
    const conversation = {
        id: conversationId,
        title: 'New Conversation',
        date: new Date().toISOString(),
        messages: [],
        code: {
            html: htmlCode.value,
            css: cssCode.value,
            js: jsCode.value
        }
    };
    
    conversations.value.unshift(conversation);
    saveConversations();
    loadConversation(conversationId);
};

const loadConversation = (id) => {
    // Save current before switching? Maybe auto-save is handled by watcher
    // But we should update current conversation code ref before switching logic
    if (currentConversationId.value) {
        const current = conversations.value.find(c => c.id === currentConversationId.value);
        if (current) {
            current.code = { html: htmlCode.value, css: cssCode.value, js: jsCode.value };
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
        
        // Reset history for new conversation
        codeHistory.value = [{ html: htmlCode.value, css: cssCode.value, js: jsCode.value }];
        historyIndex.value = 0;
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
    
    if (historyIndex.value < codeHistory.value.length - 1) {
        codeHistory.value = codeHistory.value.slice(0, historyIndex.value + 1);
    }
    
    codeHistory.value.push(currentState);
    if (codeHistory.value.length > MAX_HISTORY) {
        codeHistory.value.shift();
    } else {
        historyIndex.value++;
    }
};

const undo = () => {
    if (historyIndex.value > 0) {
        historyIndex.value--;
        const state = codeHistory.value[historyIndex.value];
        htmlCode.value = state.html;
        cssCode.value = state.css;
        jsCode.value = state.js;
    }
};

const redo = () => {
    if (historyIndex.value < codeHistory.value.length - 1) {
        historyIndex.value++;
        const state = codeHistory.value[historyIndex.value];
        htmlCode.value = state.html;
        cssCode.value = state.css;
        jsCode.value = state.js;
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
            image: attachment ? attachment.dataUrl : null
        };

        const response = await fetch(`http://localhost:3004/api/chat`, {
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
        
        // Add assistant message
        const explanation = data.explanation || "I've updated the code based on your request.";
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

</script>

<template>
    <div class="app-container">
        <!-- Sidebar -->
        <Sidebar 
            :is-collapsed="isSidebarCollapsed"
            :conversations="conversations"
            :current-conversation-id="currentConversationId"
            v-model:currentModel="currentModel"
            @toggle-sidebar="toggleSidebar"
            @new-conversation="initializeConversation"
            @load-conversation="loadConversation"
            @delete-conversation="deleteConversation"
            @rename-conversation="renameConversation"
        />

        <!-- Main Content -->
        <div class="main-container">
            <div class="display-sections">
                <!-- Live Preview -->
                <LivePreview 
                    :html-code="htmlCode"
                    :css-code="cssCode"
                    :js-code="jsCode"
                    @undo="undo"
                    @redo="redo"
                    @update-code="handleAIEdit"
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

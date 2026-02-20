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
const totalUsageStats = ref(JSON.parse(localStorage.getItem('total-usage-stats')) || {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    billed_tokens: 0
});

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
const MAX_HISTORY = 20;

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
        // Create a deep copy to avoid modifying the reactive state
        const dataToSave = JSON.parse(JSON.stringify(conversations.value));
        
        // Optimization: Strip large base64 data from attachments before saving
        dataToSave.forEach(conv => {
            if (conv.messages) {
                conv.messages.forEach(msg => {
                    if (msg.attachment && msg.attachment.dataUrl && msg.attachment.dataUrl.startsWith('data:')) {
                        // Keep a placeholder or the URL if we have it, but remove the huge base64
                        msg.attachment.dataUrl = msg.attachment.url || '(Large image removed to save space)';
                    }
                });
            }
        });

        localStorage.setItem('webdev_conversations', JSON.stringify(dataToSave));
    } catch (error) {
        console.error('Failed to save conversations to localStorage:', error);
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded. Pruning old histories and trying again...');
            // Emergency prune: Keep only the most recent state for all but the current conversation
            conversations.value.forEach(conv => {
                if (conv.id !== currentConversationId.value) {
                    if (conv.history && conv.history.length > 2) {
                        conv.history = conv.history.slice(-2);
                        conv.historyIndex = 1;
                    }
                }
            });
            // Try saving again after pruning
            try {
                localStorage.setItem('webdev_conversations', JSON.stringify(conversations.value));
            } catch (retryError) {
                console.error('Pruning failed to free enough space.');
            }
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
            // CRITICAL: Also update the primary code fields so they're saved for refresh
            conv.code = { ...currentState }; 
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
const CORE_KEYWORDS = {
    css: [
        'color', 'blue', 'red', 'green', 'yellow', 'white', 'black', 'bigger', 'smaller', 'size', 'font', 'large', 'small', 'margin', 'padding', 'space', 'background', 'border', 'shadow', 'rounded',
        'grid', 'flex', 'center', 'middle', 'aligned', 'stack', 'row', 'column', 'overflow', 'gradient', 'blur', 'opacity', 'transparent', 'bold', 'italic', 'uppercase', 'lowercase', 'gap', 'width', 'height',
        'สี', 'น้ำเงิน', 'แดง', 'เขียว', 'เหลือง', 'ขาว', 'ดำ', 'ใหญ่ขึ้น', 'เล็กลง', 'ขนาด', 'ฟอนต์', 'ใหญ่', 'เล็ก', 'ระยะห่างขอบ', 'ระยะห่างใน', 'ที่ว่าง', 'พื้นหลัง', 'เส้นขอบ', 'เงา', 'มุมมน',
        'ตาราง', 'ยืดหยุ่น', 'กึ่งกลาง', 'จัดวาง', 'ซ้อน', 'แถว', 'คอลัมน์', 'ล้น', 'ไล่สี', 'เบลอ', 'โปร่งใส', 'ตัวหนา', 'ตัวเอียง', 'ตัวพิมพ์ใหญ่', 'ตัวพิมพ์เล็ก', 'ช่องว่าง', 'กว้าง', 'สูง'
    ],
    html: [
        'add', 'remove', 'create', 'delete', 'section', 'div', 'button', 'header', 'footer', 'image', 'text', 'link','fill', 'cover',
        'navbar', 'sidebar', 'card', 'form', 'input', 'dropdown', 'modal', 'popup', 'table', 'list', 'span', 'icon', 'video', 'audio', 'label', 'placeholder', 'container', 'wrapper', 'article', 'aside',
        'เพิ่ม', 'ลบ', 'สร้าง', 'ส่วน', 'ปุ่ม', 'ส่วนหัว', 'ส่วนท้าย', 'รูปภาพ', 'ข้อความ', 'ลิงก์',
        'แถบเมนู', 'แถบข้าง', 'การ์ด', 'แบบฟอร์ม', 'ช่องกรอก', 'รายการเลือก', 'หน้าต่างเด้ง', 'ตาราง', 'รายการ', 'ไอคอน', 'วิดีโอ', 'เสียง', 'ป้ายชื่อ', 'กล่องใส่', 'ตัวครอบ'
    ],
    js: [
        'click', 'hover', 'press', 'animate', 'move', 'fade', 'interactive', 'function', 'event',
        'scroll', 'submit', 'change', 'keydown', 'focus', 'blur', 'load', 'resize', 'show', 'hide', 'toggle', 'slide', 'delay', 'infinite', 'loop', 'validate', 'alert', 'refresh', 'fetch', 'storage',
        'คลิก', 'วางเหนือ', 'กด', 'เคลื่อนไหว', 'ย้าย', 'จาง', 'โต้ตอบ', 'ฟังก์ชัน', 'เหตุการณ์',
        'เลื่อน', 'ส่งข้อมูล', 'เปลี่ยน', 'โฟกัส', 'โหลด', 'ปรับขนาด', 'แสดง', 'ซ่อน', 'สลับ', 'สไลด์', 'หน่วงเวลา', 'วนลูป', 'ตรวจสอบ', 'แจ้งเตือน', 'รีเฟรช', 'ดึงข้อมูล', 'ที่เก็บข้อมูล'
    ]
};

const analyzeUserIntent = (message) => {
    const msg = message.toLowerCase();
    const matches = { html: 0, css: 0, js: 0 };
    CORE_KEYWORDS.css.forEach(kw => { if (msg.includes(kw)) matches.css++; });
    CORE_KEYWORDS.html.forEach(kw => { if (msg.includes(kw)) matches.html++; });
    CORE_KEYWORDS.js.forEach(kw => { if (msg.includes(kw)) matches.js++; });
    const totalMatches = matches.html + matches.css + matches.js;
    if (totalMatches === 0) return { html: true, css: true, js: true };
    if (Math.abs(matches.html - matches.css) <= 1) return { html: true, css: true, js: false };
    return { html: matches.html > 0, css: matches.css > 0, js: matches.js > 0 };
};

const calculateConfidence = (intent) => {
    const flags = Object.values(intent).filter(Boolean).length;
    if (flags === 1) return 0.8;
    if (flags === 2) return 0.6;
    return 0.3;
};

const detectIntentWithAI = async (message) => {
    try {
        const response = await fetch('/api/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        if (!response.ok) return { html: true, css: true, js: true };
        const data = await response.json();
        return data.intent || { html: true, css: true, js: true };
    } catch (e) {
        console.warn('AI Intent detection failed', e);
        return { html: true, css: true, js: true };
    }
};

const optimizeRequest = async (message) => {
    let keywordIntent = analyzeUserIntent(message || "");
    if (keywordIntent.css || keywordIntent.js) keywordIntent.html = true;

    if (calculateConfidence(keywordIntent) > 0.7) return keywordIntent;
    
    let aiIntent = await detectIntentWithAI(message || "");
    if (aiIntent.css || aiIntent.js) aiIntent.html = true;
    return aiIntent;
};

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

const lastUsage = ref({
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    billed_tokens: 0
});

const calculateBilledTokens = (usage) => {
    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const creation = (usage.cache_creation_input_tokens || 0) * 1.25;
    const read = (usage.cache_read_input_tokens || 0) * 0.1;
    return Math.round(input + output + creation + read);
};

// Chat & AI — Adaptive Pipeline
const handleSendMessage = async ({ text, attachment, intent, type }) => {
    const targetConversationId = currentConversationId.value;
    const conv = conversations.value.find(c => c.id === targetConversationId);
    
    if (!conv) {
        console.error('No target conversation found for message');
        return;
    }

    // Add user message to conversation object
    const userMsg = { 
        role: 'user', 
        content: text || '(Image attached)', 
        attachment,
        timestamp: new Date().toISOString()
    };
    
    if (!conv.messages) conv.messages = [];
    conv.messages.push(userMsg);
    
    // Update title if it's the first message
    if (conv.messages.length === 1 && text) {
        conv.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
    }
    
    // Update local reactive state ONLY if still on the same conversation
    if (currentConversationId.value === targetConversationId) {
        chatMessages.value.push(userMsg);
    }
    
    saveConversations();
    isChatLoading.value = true;
    
    try {
        const payload = {
            message: text,
            conversationId: targetConversationId,
            html: conv.code?.html || htmlCode.value,
            css: conv.code?.css || cssCode.value,
            javascript: conv.code?.js || jsCode.value,
            image: attachment ? attachment.dataUrl : null,
            model: currentModel.value,
        };

        let response;
        if (intent){
            console.log('📱 Sending to responsive pipeline...');
            response = await fetch(`/api/responsive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, type })
            });
        } else {
            console.log('🧠 Sending to adaptive pipeline...');
            response = await fetch(`/api/adaptive-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        
        const data = await response.json();
        
        if (data.pipeline) {
            console.log(`📊 Pipeline: strategy=${data.pipeline.strategy}, type=${data.pipeline.mutationType}, elapsed=${data.pipeline.elapsed}ms`);
        }
        
        // Update code in the conversation object
        const updates = [];
        if (data.html !== undefined && data.html !== null) {
            conv.code.html = data.html;
            updates.push('HTML');
        }
        if (data.css !== undefined && data.css !== null) {
            conv.code.css = data.css;
            updates.push('CSS');
        }
        const newJs = data.javascript !== undefined ? data.javascript : data.js;
        if (newJs !== undefined && newJs !== null) {
            conv.code.js = newJs;
            updates.push('JS');
        }
        
        // Sync to reactive state if current
        if (currentConversationId.value === targetConversationId && updates.length > 0) {
            if (data.html !== undefined && data.html !== null) htmlCode.value = data.html;
            if (data.css !== undefined && data.css !== null) cssCode.value = data.css;
            if (newJs !== undefined && newJs !== null) jsCode.value = newJs;
            console.log(`✅ Applied updates to: ${updates.join(', ')}`);
            
            // Force history save immediately for AI updates to ensure it's captured in undo/redo stack
            saveToHistory();
        }
        
        // Update token usage
        if (data.usage) {
            const billed = calculateBilledTokens(data.usage);
            totalTokens.value += billed;
            lastUsage.value = { ...data.usage, billed_tokens: billed };
            
            totalUsageStats.value.input_tokens += (data.usage.input_tokens || 0);
            totalUsageStats.value.output_tokens += (data.usage.output_tokens || 0);
            totalUsageStats.value.cache_creation_input_tokens += (data.usage.cache_creation_input_tokens || 0);
            totalUsageStats.value.cache_read_input_tokens += (data.usage.cache_read_input_tokens || 0);
            totalUsageStats.value.billed_tokens += billed;

            localStorage.setItem('total-tokens', totalTokens.value);
            localStorage.setItem('last-usage', JSON.stringify(lastUsage.value));
            localStorage.setItem('total-usage-stats', JSON.stringify(totalUsageStats.value));
        }
        
        // Add assistant message
        const pipelineTag = data.pipeline ? ` [${data.pipeline.strategy}/${data.pipeline.mutationType}]` : '';
        const explanation = (data.message || data.explanation || `I've updated the code based on your request.`) + 
            ` (${lastUsage.value.billed_tokens} tokens${pipelineTag})`;
        
        const aiMsg = { 
            role: 'assistant', 
            content: explanation, 
            model: currentModel.value,
            timestamp: new Date().toISOString()
        };
        
        conv.messages.push(aiMsg);
        
        if (currentConversationId.value === targetConversationId) {
            chatMessages.value.push(aiMsg);
        }
        
        saveConversations();
    } catch (error) {
        console.error('Error in AI Chat:', error);
        const errorMsg = { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' };
        conv.messages.push(errorMsg);
        if (currentConversationId.value === targetConversationId) {
            chatMessages.value.push(errorMsg);
        }
    } finally {
        isChatLoading.value = false;
    }
};
const handleResponsiveEdit = (message   , type) => {
    // When editing via shape selection, we send the selection context as the message
    // We DON'T assume an attachment unless explicitly added (which isn't supported in this flow yet)
    handleSendMessage({ text: message, attachment: null, intent: "responsive", type: type });
};

const handleAIEdit = (message) => {
    // When editing via shape selection, we send the selection context as the message
    // We DON'T assume an attachment unless explicitly added (which isn't supported in this flow yet)
    handleSendMessage({ text: message, attachment: null });
};

const handleUpdateAllCode = ({ html, css, js }) => {
    if (html !== undefined) htmlCode.value = html;
    if (css !== undefined) cssCode.value = css;
    if (js !== undefined) jsCode.value = js;
    saveToHistory();
};

const handleDissectResult = (sections) => {
    if (!sections || sections.length === 0) return;
    
    // Create a new conversation for each section
    sections.forEach(section => {
        const conversationId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const conversation = {
            id: conversationId,
            title: `Extracted: ${section.name}`,
            date: new Date().toISOString(),
            messages: [{
                id: Date.now().toString(),
                role: 'assistant',
                text: `I've extracted the **${section.name}** section for you.\n\n**Description:** ${section.description}`,
                timestamp: new Date().toISOString()
            }],
            code: {
                html: section.html || '',
                css: section.css || '',
                js: ''
            },
            history: [{ html: section.html || '', css: section.css || '', js: '' }],
            historyIndex: 0
        };
        conversations.value.unshift(conversation);
    });
    
    saveConversations();
    
    // Load the first (most recent) extracted section
    if (conversations.value.length > 0) {
        loadConversation(conversations.value[0].id);
    }
};

const handleModernizeResult = async ({ screenshotUrl, theme, color }) => {
    if (!screenshotUrl) return;
    
    isChatLoading.value = true;
    
    try {
        // 1. Fetch the image and convert to base64
        const imgResponse = await fetch(screenshotUrl);
        const blob = await imgResponse.blob();
        
        const base64data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        console.log('🚀 Starting direct modernization...');
        
        // 2. Direct modernization call
        const modernizeRes = await fetch('/api/modernize-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64data, theme, color })
        });
        
        if (!modernizeRes.ok) throw new Error('Direct modernization failed');
        const modernizedData = await modernizeRes.json();
        
        console.log('✂️ Modernization complete. Factoring into components...');

        // 3. Factor into components
        const factorRes = await fetch('/api/factor-components', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                html: modernizedData.html, 
                css: modernizedData.css, 
                javascript: modernizedData.javascript 
            })
        });
        
        if (!factorRes.ok) throw new Error('Dismantling into components failed');
        const factoredData = await factorRes.json();
        
        // 4. Update the component system and automatically create a page
        if (factoredData.components && factoredData.components.length > 0) {
            const newComponentIds = [];
            
            factoredData.components.forEach(comp => {
                const component = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    name: comp.name || 'Modernized Section',
                    html: comp.html,
                    css: comp.css,
                    js: comp.js || '',
                    dateCreated: new Date().toISOString(),
                    thumbnail: comp.html.substring(0, 50)
                };
                savedComponents.value.unshift(component);
                newComponentIds.push(component.id);
            });
            
            // Persist components
            localStorage.setItem('webdev_saved_components', JSON.stringify(savedComponents.value));
            
            // 5. Create a new page automatically
            const pageId = Date.now().toString();
            const page = {
                id: pageId,
                title: `${theme} Modernized Page`,
                components: newComponentIds,
                dateCreated: new Date().toISOString(),
                dateModified: new Date().toISOString()
            };
            pages.value.unshift(page);
            savePages();
            
            // Load the page
            loadPage(pageId);
            
            console.log(`✅ Flow complete! Processed ${factoredData.components.length} components.`);
        } else {
            throw new Error('No components were extracted');
        }

    } catch (error) {
        console.error('Error in modernization flow:', error);
        alert('Modernization process failed: ' + error.message);
    } finally {
        isChatLoading.value = false;
    }
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

const handleOpenComponentInConversation = (component) => {
    // 1. Create a fresh conversation
    initializeConversation();

    // 2. Set its title and code to this component's content
    const conv = conversations.value[0];
    if (conv) {
        conv.title = component.name || 'Component';
        conv.code = {
            html: component.html || '',
            css: component.css || '',
            js: component.js || ''
        };
        // Seed its history with the initial state
        conv.history = [{ ...conv.code }];
        conv.historyIndex = 0;
        saveConversations();
    }

    // 3. Sync reactive code refs
    htmlCode.value = component.html || '';
    cssCode.value = component.css || '';
    jsCode.value = component.js || '';
    saveToHistory();

    // 4. Close Page Builder so editor becomes visible
    closePage();
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
        '    <style>\n' +
        combinedCSS + '\n' +
        '    </style>\n' +
        '</head>\n' +
        '<body>\n' +
        combinedHTML + '\n' +
        '    <scr' + 'ipt>\n' +
        combinedJS + '\n' +
        '    </scr' + 'ipt>\n' +
        '</body>\n' +
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
            :total-usage-stats="totalUsageStats"
            :last-usage="lastUsage"
            @toggle-sidebar="toggleSidebar"
            @new-conversation="initializeConversation"
            @load-conversation="loadConversation"
            @delete-conversation="deleteConversation"
            @rename-conversation="renameConversation"
            @new-page="createNewPage"
            @load-page="loadPage"
            @delete-page="deletePage"
            @close-page="closePage"
            @dissect-website="handleDissectResult"
            @modernize-web="handleModernizeResult"
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
            @open-in-conversation="handleOpenComponentInConversation"
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
                    @add-responsive="handleResponsiveEdit"
                    @direct-update-code="(code) => { htmlCode = code }"
                    @update-all-code="handleUpdateAllCode"
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

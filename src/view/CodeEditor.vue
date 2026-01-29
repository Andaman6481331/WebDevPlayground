<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
    htmlCode: String,
    cssCode: String,
    jsCode: String
});

const emit = defineEmits(['update:htmlCode', 'update:cssCode', 'update:jsCode']);

const activeTab = ref('html');

const setActiveTab = (tab) => {
    activeTab.value = tab;
};

// Local state for inputs to avoid prop mutation (though v-model on parent handles it, but safer to emit)
// Actually we can just emit input events directly.

const updateCode = (type, event) => {
    emit(`update:${type}Code`, event.target.value);
};

// Copy/Paste Logic
const pasteModalOpen = ref(false);
const pasteInput = ref('');
const copyButtonText = ref('📋 Copy Full');

const openPasteModal = () => {
    pasteInput.value = '';
    pasteModalOpen.value = true;
};

const closePasteModal = () => {
    pasteModalOpen.value = false;
};

const copyFullCode = () => {
    const fullCode = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
${props.cssCode}
    </style>
</head>
<body>
${props.htmlCode}
    <script>
${props.jsCode}
    <\/script>
</body>
</html>`;

    navigator.clipboard.writeText(fullCode).then(() => {
        const originalText = copyButtonText.value;
        copyButtonText.value = '✅ Copied!';
        setTimeout(() => {
            copyButtonText.value = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
};

const importPaste = () => {
    const fullCode = pasteInput.value;
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(fullCode, 'text/html');

        const styles = Array.from(doc.querySelectorAll('style')).map(s => s.innerHTML).join('\n\n');
        const scripts = Array.from(doc.querySelectorAll('script')).map(s => s.innerHTML).join('\n\n');

        const bodyClone = doc.body.cloneNode(true);
        const bodyScripts = bodyClone.querySelectorAll('script');
        bodyScripts.forEach(s => s.remove());
        const bodyStyles = bodyClone.querySelectorAll('style');
        bodyStyles.forEach(s => s.remove());

        let bodyContent = bodyClone.innerHTML;
        bodyContent = bodyContent.replace(/^\s*\n/gm, '').trim();

        emit('update:htmlCode', bodyContent);
        emit('update:cssCode', styles.trim());
        emit('update:jsCode', scripts.trim());

        closePasteModal();
    } catch (e) {
        console.error('Error parsing code:', e);
        alert('Error parsing HTML code. Please ensure it is valid HTML.');
    }
};

</script>

<template>
    <aside class="editor-panel">
        <div class="panel-header editor-header">
            <h2>CODE EDITOR</h2>
            <div class="header-actions">
                <button class="action-btn" @click="copyFullCode" title="Copy full HTML code">
                    {{ copyButtonText }}
                </button>
                <button class="action-btn" @click="openPasteModal" title="Paste full HTML code">
                    📥 Paste
                </button>
            </div>
        </div>

        <!-- Editor Tabs -->
        <div class="editor-tabs">
            <button class="tab" :class="{ active: activeTab === 'html' }" @click="setActiveTab('html')">
                <span class="tab-icon">🌐</span>
                <span class="tab-label">HTML</span>
            </button>
            <button class="tab" :class="{ active: activeTab === 'css' }" @click="setActiveTab('css')">
                <span class="tab-icon">🎨</span>
                <span class="tab-label">CSS</span>
            </button>
            <button class="tab" :class="{ active: activeTab === 'js' }" @click="setActiveTab('js')">
                <span class="tab-icon">⚡</span>
                <span class="tab-label">JavaScript</span>
            </button>
        </div>

        <!-- Code Editors -->
        <div class="editor-container">
            <div class="editor" :class="{ active: activeTab === 'html' }">
                <textarea 
                    class="code-textarea" 
                    :value="htmlCode" 
                    @input="updateCode('html', $event)"
                    placeholder="<!-- Your HTML Body content here... -->"
                ></textarea>
            </div>
            <div class="editor" :class="{ active: activeTab === 'css' }">
                <textarea 
                    class="code-textarea" 
                    :value="cssCode" 
                    @input="updateCode('css', $event)"
                    placeholder="/* Your CSS styles here... */"
                ></textarea>
            </div>
            <div class="editor" :class="{ active: activeTab === 'js' }">
                <textarea 
                    class="code-textarea" 
                    :value="jsCode" 
                    @input="updateCode('js', $event)"
                    placeholder="// Your JavaScript code here..."
                ></textarea>
            </div>
        </div>

        <!-- Paste Modal (Using native dialog or custom) -->
        <div v-if="pasteModalOpen" class="modal-overlay">
            <div class="modal-content">
                <h3>Paste Full Code</h3>
                <p>Paste your full HTML code here (including styles and scripts). We'll separate them for you.</p>
                <textarea v-model="pasteInput" placeholder="<!DOCTYPE html>..."></textarea>
                <div class="modal-actions">
                    <button @click="closePasteModal" class="modal-btn secondary">Cancel</button>
                    <button @click="importPaste" class="modal-btn primary">Import</button>
                </div>
            </div>
        </div>
    </aside>
</template>

<style scoped>
/* ========== RIGHT PANEL (CODE EDITORS) ========== */
.editor-panel {
    grid-column: 3;
    grid-row: 1;
    background: #282c34;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid #2a2a2a;
    height: 100%; /* Ensure it takes full height */
}

.editor-header {
    background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
    padding: 12px 16px; /* Added padding to match other headers */
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: white; /* Ensure text is white */
}

.panel-header h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin: 0;
}


/* Editor Tabs */
.editor-tabs {
    display: flex;
    background: #21252b;
    border-bottom: 1px solid #181a1f;
    padding: 0 8px;
    flex-shrink: 0;
}

.tab {
    padding: 10px 16px;
    background: transparent;
    border: none;
    color: #666;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
}

.tab:hover {
    color: #aaa;
    background: rgba(255, 255, 255, 0.03);
}

.tab.active {
    color: #61dafb;
    border-bottom-color: #61dafb;
    background: #282c34;
}

.tab-icon {
    font-size: 14px;
}

/* Editor Container */
.editor-container {
    flex: 1;
    background: #282c34;
    position: relative;
    overflow: hidden;
}

.editor {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: none;
}

.editor.active {
    display: block;
}

.code-textarea {
    width: 100%;
    height: 100%;
    padding: 16px;
    background: #282c34;
    color: #61dafb;
    border: none;
    font-family: 'Courier New', 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.6;
    resize: none;
    outline: none;
}

.code-textarea::placeholder {
    color: #4a5568;
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
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    background: #2a2a2a;
    padding: 24px;
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    border: 1px solid #3a3a3a;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.modal-content h3 {
    margin: 0 0 12px 0;
    color: white;
}

.modal-content p {
    color: #aaa;
    font-size: 14px;
    margin-bottom: 16px;
}

.modal-content textarea {
    width: 100%;
    height: 200px;
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    color: #e0e0e0;
    padding: 12px;
    font-family: monospace;
    resize: vertical;
    margin-bottom: 20px;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

.modal-btn {
    padding: 10px 20px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
}

.modal-btn.secondary {
    background: #333;
    color: white;
}

.modal-btn.primary {
    background: #2563eb;
    color: white;
}

.action-btn {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 4px;
    border: none;
    transition: all 0.2s;
    cursor: pointer;
}

.action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}
</style>
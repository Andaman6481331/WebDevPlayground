<script setup>
import { ref, nextTick, watch } from 'vue';

const props = defineProps({
    messages: {
        type: Array,
        default: () => []
    },
    isLoading: Boolean
});

const emit = defineEmits(['send-message', 'reset-chat']);

const messageInput = ref('');
const fileInput = ref(null);
const currentAttachment = ref(null);
const chatMessagesRef = ref(null);

const triggerFileInput = () => {
    fileInput.value.click();
};

const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        e.target.value = '';
        return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('File size must be less than 10MB');
        e.target.value = '';
        return;
    }

    try {
        const dataUrl = await fileToBase64(file);
        
        currentAttachment.value = {
            file: file,
            type: file.type,
            dataUrl: dataUrl,
            name: file.name,
            size: formatFileSize(file.size)
        };
    } catch (error) {
        console.error('Error reading file:', error);
        alert('Error reading file. Please try again.');
    }

    e.target.value = '';
};

const removeAttachment = () => {
    currentAttachment.value = null;
};

const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const sendMessage = () => {
    const text = messageInput.value.trim();
    if (!text && !currentAttachment.value) return;

    emit('send-message', {
        text: text,
        attachment: currentAttachment.value
    });
    console.log("User Send message: ", text);
    messageInput.value = '';
    currentAttachment.value = null;
};

const handleEnter = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

// Scroll to bottom on new messages
watch(() => props.messages.length, () => {
    nextTick(() => {
        if (chatMessagesRef.value) {
            chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
    });
});

watch(() => props.isLoading, (newVal) => {
    if (newVal) {
        nextTick(() => {
            if (chatMessagesRef.value) {
                chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
            }
        });
    }
});

</script>

<template>
    <!-- Bottom Panel: AI Assistant (Terminal Style) -->
    <aside class="chat-panel">
        <div class="panel-header chat-header">
            <div class="header-left">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z">
                    </path>
                </svg>
                <h2>AI ASSISTANT</h2>
            </div>
            <button class="reset-btn" title="Reset conversation" @click="$emit('reset-chat')">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15">
                    </path>
                </svg>
            </button>
        </div>

        <!-- Chat Messages -->
        <div class="chat-messages" ref="chatMessagesRef">
            <div 
                v-for="(msg, index) in messages" 
                :key="index" 
                class="message" 
                :class="msg.role"
            >
                <div 
                    class="message-content"
                    :class="{ 
                        'has-attachment': msg.attachment?.type?.startsWith('image/'),
                        'has-selection': msg.content.includes('SELECTED AREAS')
                    }"
                >
                    <div class="message-header" v-if="msg.role === 'assistant'">AI Assistant</div>
                    {{ msg.content }}
                    
                    <!-- Image Attachment -->
                    <div v-if="msg.attachment && msg.role === 'user' && msg.attachment.type.startsWith('image/')" class="attachment-indicator is-image">
                        <img :src="msg.attachment.dataUrl" alt="Attachment">
                        <span>📎 {{ msg.attachment.name }}</span>
                    </div>

                    <!-- Shape Selection Indicator check msg content -->
                    <div v-if="msg.content.includes('SELECTED AREAS') && msg.role === 'user'" class="attachment-indicator is-selection">
                        <span>⛶ Shape Selection Active</span>
                    </div>
                </div>
            </div>
            
            <!-- Loading Indicator -->
            <div v-if="isLoading" class="message assistant" id="loadingMessage">
                <div class="message-content">
                    <div class="loading-dots">
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Chat Input -->
        <div class="chat-input-area">
            <!-- File attachment preview -->
            <div v-if="currentAttachment" class="attachment-section">
                <div class="attachment-preview">
                    <img :src="currentAttachment.dataUrl" alt="Preview">
                    <div class="file-info">
                        <div class="file-name">{{ currentAttachment.name }}</div>
                        <div class="file-size">{{ currentAttachment.size }}</div>
                    </div>
                </div>
                <button class="remove-attachment-btn" @click="removeAttachment" title="Remove attachment">×</button>
            </div>
            
            <div class="input-row">
                <button class="attach-file-btn" @click="triggerFileInput" title="Attach image">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
                    </svg>
                </button>
                <input 
                    type="text" 
                    v-model="messageInput" 
                    @keypress="handleEnter"
                    class="message-input" 
                    placeholder="Type a message..."
                >
                <button class="send-btn" @click="sendMessage">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                    </svg>
                    Send
                </button>
            </div>
            
            <!-- Hidden file input -->
            <input 
                type="file" 
                ref="fileInput" 
                accept="image/*" 
                style="display: none;" 
                @change="handleFileChange"
            >
        </div>
    </aside>
</template>

<style scoped>
/* ========== BOTTOM PANEL (AI CHAT - TERMINAL STYLE) ========== */
.chat-panel {
    grid-column: 2 / 4;
    grid-row: 2;
    background: linear-gradient(180deg, #1a1a1a 0%, #151515 100%);
    border-top: 1px solid #2a2a2a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
}
.preview-panel {
    grid-column: 2;
    grid-row: 1;
    background: #f5f5f7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.icon {
    width: 20px;
    height: 20px;
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

.panel-header h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-right: auto;
    margin-top: 0;
    margin-bottom: 0;
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
.chat-header {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    padding: 8px 16px;
}

.reset-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}

.reset-btn:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: rotate(180deg);
}

.reset-btn .icon {
    width: 16px;
    height: 16px;
    stroke: white;
}

/* Chat Messages */
.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.message {
    display: flex;
    animation: messageSlide 0.3s ease;
}

@keyframes messageSlide {
    from {
        opacity: 0;
        transform: translateY(10px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.message.user {
    justify-content: flex-end;
}

.message.assistant {
    justify-content: flex-start;
}

.message-content {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.5;
    position: relative;
    word-break: break-word;
}

/* Message Types Customization */
.message.user .message-content.has-attachment {
    border-left: 3px solid #ff6b6b;
}

.message.user .message-content.has-selection {
    border-left: 3px solid #10b981;
}

/* Message with attachment indicator */
.message.user .attachment-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    font-size: 11px;
}

.message.user .attachment-indicator.is-image img {
    width: 30px;
    height: 30px;
    object-fit: cover;
    border-radius: 3px;
}

.message.user .attachment-indicator.is-selection {
    color: #10b981;
    font-weight: 600;
}

.send-btn {
    padding: 10px 16px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white;
    border: none;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
}

.send-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}

.send-btn:active {
    transform: translateY(0);
}

.send-btn .icon {
    width: 14px;
    height: 14px;
}
/* Custom Scrollbar */
.chat-messages::-webkit-scrollbar {
    width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
    background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
    background: #444;
}
</style>
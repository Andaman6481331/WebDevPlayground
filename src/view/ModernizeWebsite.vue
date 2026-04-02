<template>
  <!-- Trigger Button — drop this anywhere in your sidebar/toolbar -->
<button
  class="tool-btn"
  :class="{ 'tool-btn--loading': isLoading }"
  @click="isLoading ? null : openModal()"
  :style="{ '--progress': progressPct + '%' }"
  :title="isLoading ? 'Modernizing in background...' : 'Modernize Website'"
>
  <svg v-if="!isLoading" class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
  </svg>
  <div v-else class="tool-btn__spinner"></div>
  <span>{{ isLoading ? `Modernizing... ${progressPct}%` : 'Modernize' }}</span>
</button>

  <!-- Modal -->
  <dialog ref="modalRef" class="modernize-modal" @click.self="closeModal">
    <div class="modernize-modal__box">

      <!-- Header -->
      <div class="modernize-modal__header">
        <div>
          <h2 class="modernize-modal__title">Modernize a Website</h2>
          <p class="modernize-modal__subtitle">
            Paste any URL — Claude will scrape, analyse, and rebuild it as a clean modern page.
          </p>
        </div>
        <button class="modernize-modal__close" @click="closeModal">✕</button>
      </div>

      <!-- Step 1: URL input -->
      <div v-if="step === 'input'" class="modernize-modal__body">
        <label class="modernize-modal__label">Website URL</label>
        <div class="modernize-modal__url-row">
          <input
            v-model="urlInput"
            type="url"
            class="modernize-modal__input"
            placeholder="https://www.old-website.com"
            @keydown.enter="goToColors"
            :disabled="isLoading"
          />
          <button
            class="modernize-modal__go-btn"
            @click="goToColors"
            :disabled="isLoading || !urlInput.trim()"
          >
            Next →
          </button>
        </div>

        <!-- Model selector -->
        <div class="modernize-modal__options">
          <label class="modernize-modal__label">Model</label>
          <div class="modernize-modal__model-pills">
            <button
              v-for="m in modelOptions"
              :key="m.value"
              class="modernize-modal__pill"
              :class="{ active: selectedModel === m.value }"
              @click="selectedModel = m.value"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <p v-if="error" class="modernize-modal__error">⚠ {{ error }}</p>
      </div>

      <!-- Step 2: Color picker -->
      <div v-if="step === 'colors'" class="modernize-modal__body">
        <p class="modernize-modal__hint">Choose a color theme for the modernized website. Claude will use these as the primary and secondary brand colors.</p>

        <div class="modernize-modal__color-section">
          <label class="modernize-modal__label">Primary Color</label>
          <div class="modernize-modal__color-row">
            <input type="color" v-model="primaryColor" class="modernize-modal__color-input" />
            <span class="modernize-modal__color-hex">{{ primaryColor }}</span>
            <div class="modernize-modal__color-swatch" :style="{ background: primaryColor }"></div>
          </div>
          <div class="modernize-modal__presets">
            <button v-for="c in colorPresets" :key="c.value"
              class="modernize-modal__preset-bubble"
              :style="{ background: c.value, outline: primaryColor === c.value ? '2px solid #fff' : 'none' }"
              :title="c.name"
              @click="primaryColor = c.value"
            />
          </div>
        </div>

        <div class="modernize-modal__color-section">
          <label class="modernize-modal__label">Secondary Color</label>
          <div class="modernize-modal__color-row">
            <input type="color" v-model="secondaryColor" class="modernize-modal__color-input" />
            <span class="modernize-modal__color-hex">{{ secondaryColor }}</span>
            <div class="modernize-modal__color-swatch" :style="{ background: secondaryColor }"></div>
          </div>
          <div class="modernize-modal__presets">
            <button v-for="c in colorPresets" :key="c.value"
              class="modernize-modal__preset-bubble"
              :style="{ background: c.value, outline: secondaryColor === c.value ? '2px solid #fff' : 'none' }"
              :title="c.name"
              @click="secondaryColor = c.value"
            />
          </div>
        </div>

        <div class="modernize-modal__actions" style="justify-content: space-between;">
          <button class="modernize-modal__action-btn modernize-modal__action-btn--outline" @click="step = 'input'">← Back</button>
          <button class="modernize-modal__go-btn" @click="startModernize" :disabled="isLoading">
            {{ isLoading ? 'Working...' : 'Modernize →' }}
          </button>
        </div>
      </div>

      <!-- Loading state (removed modal block as it's now in the header button) -->
      <div v-if="isLoading && step === 'colors'" class="modernize-modal__body">
        <p class="modernize-modal__progress-text">Modernization has started in the background. You can close this modal and keep working!</p>
      </div>

    </div>
  </dialog>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

// ── Props / Emits ─────────────────────────────────────────────
const emit = defineEmits(['modernize-website']);

// ── State ─────────────────────────────────────────────────────
const modalRef    = ref(null);
const previewFrame = ref(null);
const step        = ref('input');   // 'input' | 'colors' | 'preview'
const urlInput    = ref('');
const isLoading   = ref(false);
const error       = ref('');
const result      = ref(null);
const progressPct = ref(0);
const progressLabel = ref('');
const selectedModel = ref('sonnet');
const primaryColor  = ref('#3b82f6');
const secondaryColor = ref('#10b981');

const colorPresets = [
  { name: 'Blue',    value: '#3b82f6' },
  { name: 'Indigo',  value: '#6366f1' },
  { name: 'Purple',  value: '#a855f7' },
  { name: 'Pink',    value: '#ec4899' },
  { name: 'Red',     value: '#ef4444' },
  { name: 'Orange',  value: '#f97316' },
  { name: 'Amber',   value: '#f59e0b' },
  { name: 'Green',   value: '#22c55e' },
  { name: 'Teal',    value: '#14b8a6' },
  { name: 'Cyan',    value: '#06b6d4' },
  { name: 'Slate',   value: '#64748b' },
  { name: 'Black',   value: '#1a1a1a' },
];

const modelOptions = [
  { value: 'sonnet', label: 'Sonnet 4.6 — recommended' },
  { value: 'opus',   label: 'Opus 4.6 — best quality'  },
  { value: 'haiku',  label: 'Haiku — fastest'           },
];

// ── Progress simulation ───────────────────────────────────────
let progressTimer = null;
const STAGES = [
  { pct: 12,  label: 'Launching browser...'          },
  { pct: 28,  label: 'Loading page...'               },
  { pct: 45,  label: 'Scraping content & images...'  },
  { pct: 60,  label: 'Taking screenshot...'          },
  { pct: 72,  label: 'Sending to Claude...'          },
  { pct: 85,  label: 'Claude is redesigning...'      },
  { pct: 95,  label: 'Parsing output...'             },
];

function startProgress() {
  progressPct.value = 0;
  progressLabel.value = 'Starting...';
  let i = 0;
  progressTimer = setInterval(() => {
    if (i < STAGES.length) {
      progressPct.value  = STAGES[i].pct;
      progressLabel.value = STAGES[i].label;
      i++;
    }
  }, 2200);
}

function stopProgress() {
  clearInterval(progressTimer);
  progressPct.value   = 100;
  progressLabel.value = 'Done!';
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal() {
  step.value    = 'input';
  error.value   = '';
  result.value  = null;
  urlInput.value = '';
  primaryColor.value = '#3b82f6';
  secondaryColor.value = '#10b981';
  modalRef.value?.showModal();
}

function closeModal() {
  if (isLoading.value) return;
  modalRef.value?.close();
}

// ── Validate URL and go to color picker ───────────────────────
function goToColors() {
  const url = urlInput.value.trim();
  if (!url.startsWith('http')) {
    error.value = 'Please enter a full URL starting with http:// or https://';
    return;
  }
  error.value = '';
  step.value = 'colors';
}

// ── Main action ───────────────────────────────────────────────
async function startModernize() {
  const url = urlInput.value.trim();
  if (!url.startsWith('http')) {
    error.value = 'Please enter a full URL starting with http:// or https://';
    return;
  }

  isLoading.value = true;
  error.value     = '';
  
  // Close the modal immediately so user can do other things
  closeModal();
  
  startProgress();

  try {
    const response = await fetch('/api/modernize-website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, model: selectedModel.value, primaryColor: primaryColor.value, secondaryColor: secondaryColor.value })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Server error');
    }

    stopProgress();
    result.value = data;
    
    // Automatically apply to editor (creates conversation in App.vue)
    applyToEditor();

  } catch (err) {
    stopProgress();
    // Re-open modal with error if possible, or just log
    console.error('Modernize error:', err);
    alert('Modernization failed: ' + err.message);
  } finally {
    isLoading.value = false;
  }
}

// ── Inject HTML into iframe ───────────────────────────────────
function injectPreview(html) {
  const frame = previewFrame.value;
  if (!frame) return;
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

// Re-inject if iframe ref becomes available after step change
watch(() => step.value, async (val) => {
  if (val === 'preview' && result.value?.html) {
    await nextTick();
    injectPreview(result.value.html);
  }
});

// ── Download ──────────────────────────────────────────────────
function downloadHtml() {
  if (!result.value?.html) return;
  const blob = new Blob([result.value.html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `modernized-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Emit to parent editor ─────────────────────────────────────
function applyToEditor() {
  if (!result.value) return;
  emit('modernize-website', {
    html:     result.value.html,
    css:      '',          // CSS is already inlined in the HTML
    analysis: result.value.analysis,
    changes:  result.value.changes,
    url:      result.value.url,
    usage:    result.value.usage,
  });
  closeModal();
}
</script>

<style scoped>
/* Add to ModernizeWebsite.vue <style scoped> */
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
  position: relative;
  overflow: hidden;
}
.tool-btn--loading {
  background: linear-gradient(to right, rgba(124, 58, 237, 0.2) var(--progress), #18181b var(--progress));
  border-color: #7c3aed;
  color: #fafafa;
}
.tool-btn:hover:not(.tool-btn--loading) {
  background: #27272a;
  border-color: #3f3f46;
  color: #fafafa;
}
.tool-btn__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.icon { width: 20px; height: 20px; }
/* ── Trigger button ────────────────────────────────── */
.modernize-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.modernize-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.modernize-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.modernize-btn__icon { font-size: 16px; }

/* ── Modal backdrop ────────────────────────────────── */
.modernize-modal {
  position: fixed !important;
  z-index: 9999 !important;
  inset: 0;
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  background: rgba(0,0,0,0.55);
  border: none;
  padding: 0;
  display: none;
  align-items: center;
  justify-content: center;
}
.modernize-modal[open] {
  display: flex;
}
.modernize-modal::backdrop { background: rgba(0,0,0,0.55); }

/* ── Modal box ─────────────────────────────────────── */
.modernize-modal__box {
  background: #fff;
  border-radius: 14px;
  width: min(560px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.2);
}
.modernize-modal__box:has(.modernize-modal__body--wide) {
  width: min(900px, 95vw);
}

/* ── Header ────────────────────────────────────────── */
.modernize-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 24px 24px 0;
}
.modernize-modal__title {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 4px;
}
.modernize-modal__subtitle {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}
.modernize-modal__close {
  background: none;
  border: none;
  font-size: 18px;
  color: #9ca3af;
  cursor: pointer;
  padding: 0 0 0 12px;
  flex-shrink: 0;
}
.modernize-modal__close:hover { color: #374151; }

/* ── Body ──────────────────────────────────────────── */
.modernize-modal__body {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Label ─────────────────────────────────────────── */
.modernize-modal__label {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  display: block;
}

/* ── URL row ───────────────────────────────────────── */
.modernize-modal__url-row {
  display: flex;
  gap: 8px;
}
.modernize-modal__input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.modernize-modal__input:focus { border-color: #7c3aed; }
.modernize-modal__input:disabled { background: #f9fafb; color: #9ca3af; }

.modernize-modal__go-btn {
  padding: 10px 20px;
  background: #7c3aed;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.modernize-modal__go-btn:hover:not(:disabled) { background: #6d28d9; }
.modernize-modal__go-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Model pills ───────────────────────────────────── */
.modernize-modal__model-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.modernize-modal__pill {
  padding: 6px 14px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  font-size: 12px;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
}
.modernize-modal__pill:hover { border-color: #7c3aed; color: #7c3aed; }
.modernize-modal__pill.active { background: #7c3aed; border-color: #7c3aed; color: #fff; }

/* ── Progress ──────────────────────────────────────── */
.modernize-modal__progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modernize-modal__progress-bar {
  height: 4px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}
.modernize-modal__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #7c3aed, #4f46e5);
  border-radius: 999px;
  transition: width 1.8s ease;
}
.modernize-modal__progress-text {
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}

/* ── Error ─────────────────────────────────────────── */
.modernize-modal__error {
  font-size: 13px;
  color: #dc2626;
  background: #fef2f2;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #fecaca;
}

/* ── Color Picker Step ─────────────────────────────── */
.modernize-modal__hint {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  margin-bottom: 4px;
}
.modernize-modal__color-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modernize-modal__color-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.modernize-modal__color-input {
  width: 40px;
  height: 40px;
  border: none;
  padding: 0;
  border-radius: 8px;
  cursor: pointer;
  background: none;
}
.modernize-modal__color-hex {
  font-size: 13px;
  font-family: monospace;
  color: #374151;
  background: #f3f4f6;
  border-radius: 6px;
  padding: 4px 10px;
}
.modernize-modal__color-swatch {
  flex: 1;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  transition: background 0.2s;
}
.modernize-modal__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.modernize-modal__preset-bubble {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  outline-offset: 2px;
}
.modernize-modal__preset-bubble:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

/* ── Analysis ──────────────────────────────────────── */
.modernize-modal__analysis {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
  color: #3730a3;
  line-height: 1.6;
}
.modernize-modal__analysis-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 6px;
  color: #7c3aed;
}

/* ── Changes ───────────────────────────────────────── */
.modernize-modal__changes {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
}
.modernize-modal__changes-title {
  font-weight: 600;
  color: #166534;
  margin-bottom: 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.modernize-modal__changes ul { padding-left: 16px; }
.modernize-modal__changes li { color: #15803d; margin-bottom: 3px; }

/* ── Token usage ───────────────────────────────────── */
.modernize-modal__usage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9ca3af;
}
.modernize-modal__usage-sep { color: #d1d5db; }
.modernize-modal__truncated {
  color: #f59e0b;
  font-weight: 600;
  margin-left: 4px;
}

/* ── Preview iframe ────────────────────────────────── */
.modernize-modal__preview-wrap {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  height: 480px;
}
.modernize-modal__iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* ── Action buttons ────────────────────────────────── */
.modernize-modal__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.modernize-modal__action-btn {
  padding: 9px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.modernize-modal__action-btn--outline {
  background: #fff;
  border: 1px solid #d1d5db;
  color: #374151;
}
.modernize-modal__action-btn--outline:hover { border-color: #7c3aed; color: #7c3aed; }
.modernize-modal__action-btn--primary {
  background: #7c3aed;
  border: none;
  color: #fff;
}
.modernize-modal__action-btn--primary:hover { background: #6d28d9; }
</style>
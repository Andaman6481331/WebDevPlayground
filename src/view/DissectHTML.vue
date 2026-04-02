<template>
  <!-- Trigger Button -->
  <button class="tool-btn" @click="openModal" title="Dissect Current HTML into Components">
    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
    <span>Dissect</span>
  </button>

  <!-- Dissect Modal -->
  <dialog ref="modalRef" class="dissect-modal">
    <div class="dissect-modal__box">

      <!-- Header -->
      <div class="dissect-modal__header">
        <div>
          <h2 class="dissect-modal__title">Dissect into Components</h2>
          <p class="dissect-modal__subtitle">Select sections from your current HTML and give them names. Each group becomes a reusable component.</p>
        </div>
        <button class="dissect-modal__close" @click="closeModal">✕</button>
      </div>

      <!-- No HTML state -->
      <div v-if="sections.length === 0" class="dissect-modal__empty">
        <p>No HTML sections found. Make sure you have HTML in the editor first.</p>
        <button class="dissect-modal__btn dissect-modal__btn--primary" @click="closeModal">Got it</button>
      </div>

      <!-- Main content -->
      <div v-else class="dissect-modal__body">

        <!-- Left: section list -->
        <div class="dissect-modal__list">
          <p class="dissect-modal__list-hint">Click sections to select/deselect. Drag to reorder. Edit names inline.</p>

          <div
            v-for="(sec, idx) in sections"
            :key="sec.id"
            class="dissect-section-card"
            :class="{ selected: sec.selected, previewing: previewIdx === idx }"
            @click="toggleSelect(idx)"
          >
            <div class="dissect-section-card__left">
              <span class="dissect-section-card__num">{{ idx + 1 }}</span>
              <div class="dissect-section-card__info">
                <div class="dissect-section-card__tag">{{ sec.tag }}{{ sec.id ? '#' + sec.id : '' }}{{ sec.classes ? '.' + sec.classes.split(' ')[0] : '' }}</div>
                <div class="dissect-section-card__preview-text">{{ sec.textSnippet }}</div>
              </div>
            </div>
            <div class="dissect-section-card__right">
              <input
                v-if="sec.selected"
                v-model="sec.name"
                class="dissect-section-card__name-input"
                placeholder="Component name…"
                @click.stop
              />
              <button class="dissect-section-card__eye" @click.stop="togglePreview(idx)" :class="{ active: previewIdx === idx }" title="Preview">👁</button>
              <span class="dissect-section-card__check">{{ sec.selected ? '✓' : '' }}</span>
            </div>
          </div>
        </div>

        <!-- Right: preview pane -->
        <div class="dissect-modal__preview">
          <div class="dissect-modal__preview-label">
            {{ previewIdx !== null ? `Preview: ${sections[previewIdx]?.tag}` : 'Click 👁 to preview a section' }}
          </div>
          <iframe
            ref="previewFrame"
            class="dissect-modal__iframe"
            sandbox="allow-scripts"
          ></iframe>
        </div>
      </div>

      <!-- Footer actions -->
      <div v-if="sections.length > 0" class="dissect-modal__footer">
        <span class="dissect-modal__sel-count">{{ selectedSections.length }} section(s) selected</span>
        <div class="dissect-modal__footer-actions">
          <button class="dissect-modal__btn dissect-modal__btn--outline" @click="selectAll">Select All</button>
          <button class="dissect-modal__btn dissect-modal__btn--outline" @click="deselectAll">Clear</button>
          <button
            class="dissect-modal__btn dissect-modal__btn--primary"
            :disabled="selectedSections.length === 0"
            @click="doDiscard"
          >
            Dissect {{ selectedSections.length > 0 ? `(${selectedSections.length})` : '' }} →
          </button>
        </div>
      </div>

    </div>
  </dialog>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';

const props = defineProps({
  htmlCode: { type: String, default: '' },
  cssCode:  { type: String, default: '' },
  jsCode:   { type: String, default: '' },
});

const emit = defineEmits(['dissect-sections']);

const modalRef    = ref(null);
const previewFrame = ref(null);
const sections    = ref([]);
const previewIdx  = ref(null);
let   idCounter   = 0;

// ── Parse HTML into top-level sections ──────────────────────
function parseHTMLSections(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  const BLOCK_TAGS = new Set(['DIV','SECTION','HEADER','FOOTER','NAV','MAIN','ARTICLE','ASIDE','FORM','TABLE','UL','OL']);

  // Gather candidates: direct children of body, OR first-level block children of a wrapper
  let candidates = [...body.children];

  // If there's only one big wrapper div, drill one level deeper
  if (candidates.length === 1 && BLOCK_TAGS.has(candidates[0].tagName)) {
    const inner = [...candidates[0].children].filter(el => BLOCK_TAGS.has(el.tagName));
    if (inner.length >= 2) candidates = inner;
  }

  return candidates
    .filter(el => BLOCK_TAGS.has(el.tagName) && el.innerHTML.trim().length > 10)
    .map(el => {
      const textSnippet = el.innerText?.trim().slice(0, 80).replace(/\s+/g, ' ') || '';
      return {
        id: ++idCounter,
        tag: el.tagName.toLowerCase(),
        elId: el.id || '',
        classes: el.className || '',
        textSnippet,
        html: el.outerHTML,
        name: guessName(el),
        selected: false,
      };
    });
}

function guessName(el) {
  const tag = el.tagName.toLowerCase();
  const cls = (el.className || '').toLowerCase();
  const id  = (el.id || '').toLowerCase();
  const combined = cls + ' ' + id;

  if (tag === 'nav' || combined.includes('nav') || combined.includes('menu')) return 'Navbar';
  if (tag === 'header' || combined.includes('header')) return 'Header';
  if (tag === 'footer' || combined.includes('footer')) return 'Footer';
  if (combined.includes('hero') || combined.includes('banner')) return 'Banner';
  if (combined.includes('carousel') || combined.includes('slider')) return 'Carousel';
  if (combined.includes('faq') || combined.includes('accordion')) return 'FAQ';
  if (combined.includes('shelf') || combined.includes('grid') || combined.includes('product')) return 'Product Shelf';
  if (combined.includes('feature')) return 'Features';
  if (combined.includes('testimonial') || combined.includes('review')) return 'Testimonials';
  if (combined.includes('contact') || combined.includes('form')) return 'Contact';
  return `Section ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
}

const selectedSections = computed(() => sections.value.filter(s => s.selected));

// ── Open / close ─────────────────────────────────────────────
function openModal() {
  sections.value = parseHTMLSections(props.htmlCode);
  previewIdx.value = null;
  modalRef.value?.showModal();
}

function closeModal() {
  modalRef.value?.close();
}

// ── Section interactions ─────────────────────────────────────
function toggleSelect(idx) {
  sections.value[idx].selected = !sections.value[idx].selected;
}

function selectAll() {
  sections.value.forEach(s => s.selected = true);
}

function deselectAll() {
  sections.value.forEach(s => s.selected = false);
}

async function togglePreview(idx) {
  if (previewIdx.value === idx) {
    previewIdx.value = null;
    return;
  }
  previewIdx.value = idx;
  await nextTick();
  injectPreview(idx);
}

function injectPreview(idx) {
  const sec = sections.value[idx];
  if (!sec || !previewFrame.value) return;

  const fullHtml = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: sans-serif; }
      ${props.cssCode || ''}
    </style>
  </head><body>${sec.html}<script>${props.jsCode || ''}<\/script></body></html>`;

  const frame = previewFrame.value;
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();
}

// ── CSS Dissection Helper ────────────────────────────────────
function extractRelevantCSS(html, fullCSS) {
  if (!fullCSS) return '';
  
  // 1. Extract all classes and IDs from the HTML
  const classMatches = html.match(/class=["']([^"']+)["']/g) || [];
  const idMatches    = html.match(/id=["']([^"']+)["']/g) || [];
  
  const usedClasses = new Set();
  classMatches.forEach(m => {
    m.match(/["']([^"']+)["']/)[1].split(/\s+/).forEach(c => usedClasses.add(c.trim()));
  });
  
  const usedIds = new Set();
  idMatches.forEach(m => {
    usedIds.add(m.match(/["']([^"']+)["']/)[1].trim());
  });

  // 2. Split CSS into rules (heuristic: split by '}' and filter)
  // This is a simple heuristic and won't handle nested media queries perfectly, 
  // but works well for most playground-style CSS.
  const rules = fullCSS.split('}');
  const relevantRules = rules.filter(rule => {
    const selector = rule.split('{')[0].trim().toLowerCase();
    if (!selector) return false;

    // Keep global/reset rules
    if (selector.includes(':root') || selector === '*' || selector === 'html' || selector === 'body' || selector.includes('@font-face') || selector.includes('@keyframes')) {
      return true;
    }

    // Check if selector contains any used class or ID
    for (const cls of usedClasses) {
      if (selector.includes('.' + cls.toLowerCase())) return true;
    }
    for (const id of usedIds) {
      if (selector.includes('#' + id.toLowerCase())) return true;
    }

    // Check for tag names (very basic)
    const tags = ['h1','h2','h3','h4','h5','h6','p','span','div','section','ul','ol','li','a','img','button','input','svg'];
    for (const tag of tags) {
      if (selector === tag || selector.startsWith(tag + ' ') || selector.includes(' ' + tag)) return true;
    }

    return false;
  });

  return relevantRules.join('}\n') + (relevantRules.length > 0 ? '}' : '');
}

// ── Dissect ──────────────────────────────────────────────────
function doDiscard() {
  const components = selectedSections.value.map(sec => ({
    name: sec.name || `${sec.tag} component`,
    html: sec.html,
    css: extractRelevantCSS(sec.html, props.cssCode),
    js: props.jsCode || '',
  }));

  emit('dissect-sections', components);
  closeModal();
}
</script>

<style scoped>
/* Trigger button */
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
.tool-btn:hover { background: #27272a; border-color: #3f3f46; color: #fafafa; }
.icon { width: 16px; height: 16px; }

/* Modal backdrop */
.dissect-modal {
  position: fixed !important;
  z-index: 9999 !important;
  inset: 0;
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  background: rgba(0,0,0,0.6);
  border: none;
  padding: 0;
  display: none;
  align-items: center;
  justify-content: center;
}
.dissect-modal[open] { display: flex; }
.dissect-modal::backdrop { background: rgba(0,0,0,0.6); }

/* Modal box */
.dissect-modal__box {
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 14px;
  width: min(1100px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 32px 80px rgba(0,0,0,0.5);
  overflow: hidden;
}

/* Header */
.dissect-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 24px 12px;
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
}
.dissect-modal__title {
  font-size: 17px;
  font-weight: 700;
  color: #f0f0f0;
  margin-bottom: 4px;
}
.dissect-modal__subtitle {
  font-size: 12px;
  color: #71717a;
  line-height: 1.5;
}
.dissect-modal__close {
  background: none;
  border: none;
  color: #71717a;
  font-size: 18px;
  cursor: pointer;
  padding: 0 0 0 12px;
}
.dissect-modal__close:hover { color: #f0f0f0; }

/* Empty */
.dissect-modal__empty {
  padding: 40px 24px;
  text-align: center;
  color: #71717a;
}

/* Body: two-column layout */
.dissect-modal__body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* Left: section list */
.dissect-modal__list {
  width: 380px;
  flex-shrink: 0;
  border-right: 1px solid #1e1e1e;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dissect-modal__list-hint {
  font-size: 11px;
  color: #52525b;
  padding: 0 4px 4px;
}

/* Section card */
.dissect-section-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: #1a1a1a;
  border: 1px solid #27272a;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.dissect-section-card:hover { border-color: #3f3f46; background: #1f1f1f; }
.dissect-section-card.selected { border-color: #6366f1; background: #1e1b4b; }
.dissect-section-card.previewing { border-color: #0ea5e9; }

.dissect-section-card__left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.dissect-section-card__num {
  min-width: 22px;
  height: 22px;
  background: #27272a;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.dissect-section-card.selected .dissect-section-card__num {
  background: #6366f1;
  color: #fff;
}
.dissect-section-card__info { min-width: 0; }
.dissect-section-card__tag {
  font-size: 12px;
  font-weight: 600;
  color: #a78bfa;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dissect-section-card__preview-text {
  font-size: 11px;
  color: #52525b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  margin-top: 2px;
}

.dissect-section-card__right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.dissect-section-card__name-input {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #f0f0f0;
  font-size: 12px;
  width: 120px;
  outline: none;
}
.dissect-section-card__name-input:focus { border-color: #6366f1; }
.dissect-section-card__eye {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.15s;
  padding: 2px;
}
.dissect-section-card__eye:hover, .dissect-section-card__eye.active { opacity: 1; }
.dissect-section-card__check {
  font-size: 14px;
  color: #6366f1;
  min-width: 14px;
}

/* Right: preview */
.dissect-modal__preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dissect-modal__preview-label {
  padding: 8px 14px;
  font-size: 11px;
  color: #52525b;
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
}
.dissect-modal__iframe {
  flex: 1;
  border: none;
  width: 100%;
  background: #fff;
}

/* Footer */
.dissect-modal__footer {
  padding: 12px 20px;
  border-top: 1px solid #1e1e1e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.dissect-modal__sel-count {
  font-size: 12px;
  color: #71717a;
}
.dissect-modal__footer-actions {
  display: flex;
  gap: 8px;
}
.dissect-modal__btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.dissect-modal__btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dissect-modal__btn--outline {
  background: transparent;
  border: 1px solid #3f3f46;
  color: #a1a1aa;
}
.dissect-modal__btn--outline:hover:not(:disabled) { border-color: #6366f1; color: #a78bfa; }
.dissect-modal__btn--primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  box-shadow: 0 2px 10px rgba(99,102,241,0.3);
}
.dissect-modal__btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow: 0 4px 16px rgba(99,102,241,0.5);
}
</style>

/**
 * intentService.js — Intent Parsing (Stage 1)
 * 
 * Model: claude-haiku-4-5-20251001 (Fast & Cheap)
 * Role: Converts natural language into a structured intent JSON object.
 * Includes Thai normalization + context strategy determination.
 */

// Thai → English normalization map
const THAI_NORMALIZATION = {
    // UI Elements
    'ปุ่ม': 'button', 'ข้อความ': 'text', 'รูปภาพ': 'image', 'รูป': 'image',
    'ส่วนหัว': 'header', 'ส่วนท้าย': 'footer', 'แถบเมนู': 'navbar',
    'แถบข้าง': 'sidebar', 'การ์ด': 'card', 'แบบฟอร์ม': 'form',
    'ช่องกรอก': 'input', 'รายการเลือก': 'dropdown', 'หน้าต่างเด้ง': 'modal',
    'ตาราง': 'table', 'รายการ': 'list', 'ไอคอน': 'icon', 'ลิงก์': 'link',
    'หน้าเว็บ': 'page', 'เมนู': 'menu', 'แท็บ': 'tab', 'พื้นที่': 'area',

    // Actions
    'เปลี่ยน': 'change', 'แก้ไข': 'edit', 'เพิ่ม': 'add', 'ลบ': 'remove',
    'สร้าง': 'create', 'ทำ': 'make', 'ใส่': 'put', 'ย้าย': 'move',
    'ซ่อน': 'hide', 'แสดง': 'show', 'จัดวาง': 'align', 'จัดกลาง': 'center',
    'ปรับ': 'adjust', 'ออกแบบ': 'design', 'ตกแต่ง': 'decorate',

    // Properties  
    'สี': 'color', 'ขนาด': 'size', 'ฟอนต์': 'font', 'ตัวหนังสือ': 'font',
    'พื้นหลัง': 'background', 'เส้นขอบ': 'border', 'มุมมน': 'rounded',
    'เงา': 'shadow', 'ระยะห่าง': 'spacing', 'ช่องว่าง': 'gap',
    'กว้าง': 'width', 'สูง': 'height', 'ใหญ่': 'big', 'เล็ก': 'small',
    'โปร่งใส': 'transparent', 'เบลอ': 'blur', 'ไล่สี': 'gradient',

    // Colors
    'แดง': 'red', 'น้ำเงิน': 'blue', 'เขียว': 'green', 'เหลือง': 'yellow',
    'ขาว': 'white', 'ดำ': 'black', 'ส้ม': 'orange', 'ม่วง': 'purple',
    'ชมพู': 'pink', 'เทา': 'gray',

    // Layout
    'แถว': 'row', 'คอลัมน์': 'column', 'ตาราง': 'grid',
    'ยืดหยุ่น': 'flex', 'ซ้อน': 'stack', 'เลื่อน': 'scroll',
};

// Actions that determine complexity
const LAYOUT_ACTIONS = ['align', 'resize', 'grid', 'flex', 'layout', 'arrange', 'reorder', 'responsive', 'stack', 'position'];
const COMPLEX_ACTIONS = ['redesign', 'rebuild', 'build a', 'generate a', 'add section', 'new page', 'overhaul', 'create a section', 'create a page', 'make a section', 'make a page', 'design a'];
const SIMPLE_ACTIONS = ['color', 'recolor', 'font-size', 'size', 'opacity', 'shadow', 'border', 'radius', 'background', 'margin', 'padding', 'text', 'bold', 'italic', 'underline', 'font', 'spacing', 'gap', 'rounded', 'transparent', 'gradient', 'red', 'blue', 'green', 'white', 'black', 'yellow', 'purple', 'pink', 'orange', 'gray'];

// Image mode detection keywords
const IMAGE_REFERENCE_KEYWORDS = [
    'like this', 'look like', 'based on', 'reference', 'design like',
    'copy this', 'replicate', 'match this', 'same as', 'follow this',
    'recreate', 'clone', 'mimic', 'inspired by', 'similar to',
    'from this image', 'from the image', 'ตามนี้', 'แบบนี้', 'ตามรูป',
    'ทำตาม', 'เหมือน', 'อ้างอิง', 'ทำแบบ', 'ref', 'reference', 'reference image', 'ref image'
    // Default when no text is provided — just an image alone = reference
];
const IMAGE_EMBED_KEYWORDS = [
    'paste', 'embed', 'insert', 'put this image', 'add this image',
    'use this image', 'place this', 'set as background', 'as background',
    'as banner', 'as hero', 'as logo', 'as icon', 'placeholder',
    'แปะ', 'วาง', 'ใส่รูป', 'ใช้รูป', 'วางรูป', 'เป็นพื้นหลัง',
];

/**
 * Normalize Thai text to English equivalents
 */
function normalizeThaiText(message) {
    let normalized = message;
    for (const [thai, eng] of Object.entries(THAI_NORMALIZATION)) {
        normalized = normalized.replace(new RegExp(thai, 'g'), eng);
    }
    return normalized;
}

/**
 * Determine the context strategy based on the intent complexity
 * - 'simple': CSS-only changes (color, size, etc.) — use Haiku, surgical merge
 * - 'medium': HTML+CSS changes (add element, modify structure) — use Haiku/Sonnet, surgical merge
 * - 'full': Major changes (redesign, new section) — use Sonnet, full code
 */
function determineStrategy(action, normalizedMessage) {
    const msg = normalizedMessage.toLowerCase();

    // Check for simple CSS-only FIRST (highest priority for token savings)
    if (SIMPLE_ACTIONS.some(a => msg.includes(a)) && !LAYOUT_ACTIONS.some(a => msg.includes(a))) return 'simple';

    // Check for full/complex (multi-word phrases to avoid false positives like 'make it red')
    if (COMPLEX_ACTIONS.some(a => msg.includes(a))) return 'full';

    // Check for medium (layout-sensitive)
    if (LAYOUT_ACTIONS.some(a => msg.includes(a))) return 'medium';

    // Default to medium for safety
    return 'medium';
}

/**
 * Detect how the user intends to use their attached image.
 * @param {string} message - The user's message text
 * @returns {'reference'|'embed'|null} 
 *   - 'reference': user wants to generate HTML/CSS that matches the image
 *   - 'embed': user wants to insert the image into their code as an <img> or bg
 *   - null: no image-specific intent detected (shouldn't happen if image exists)
 */
export function detectImageMode(message) {
    const msg = (message || '').toLowerCase();

    // Check embed keywords first (more specific intent)
    if (IMAGE_EMBED_KEYWORDS.some(k => msg.includes(k))) return 'embed';

    // Check reference keywords
    if (IMAGE_REFERENCE_KEYWORDS.some(k => msg.includes(k))) return 'reference';

    // Default: if user sends an image with no clear instruction, treat as reference
    // ("here's what I want it to look like")
    if (!msg.trim() || msg.length < 10) return 'reference';

    // If user has text but no image-specific keywords, treat as reference
    // (they're describing what they want + showing the image as context)
    return 'reference';
}

function extractSelectionContext(message) {
    if (!message.includes('=== SELECTED AREAS ===')) {
        return { cleanedMessage: message, hasSelection: false };
    }

    const parts = message.split('=== SELECTED AREAS ===');
    const cleanedMessage = parts[0].trim();
    const selectionData = parts[1].trim();

    return {
        cleanedMessage,
        hasSelection: true,
        selectionContext: selectionData
    };
}

/**
 * Parse user intent using Claude Haiku
 * Returns structured intent object
 */
export async function parseIntent(anthropic, message, hasImage = false, history = []) {
    const { cleanedMessage, hasSelection, selectionContext } = extractSelectionContext(message);
    const normalizedMessage = normalizeThaiText(cleanedMessage);

    // Quick local analysis first
    const localStrategy = determineStrategy(null, normalizedMessage);

    try {
        let prompt = `Analyze this user request for a web development code editor. Extract the structured intent.
        
User request: "${normalizedMessage}"`;

        if (history && history.length > 0) {
            prompt += `\n\n📜 RECENT CONVERSATION HISTORY:\n`;
            history.slice(-3).forEach(msg => {
                const content = typeof msg.content === 'string' ? msg.content : (msg.content?.[0]?.text || '');
                prompt += `${msg.role.toUpperCase()}: ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}\n`;
            });
            prompt += `\nUse the history above to resolve references like "it", "that", "this part", or "previous" in the user request.`;
        }

        if (hasSelection) {
            prompt += `\n\nCONTEXT: The user has explicitly selected specific elements on the page. The selection data is:\n${selectionContext}\n\nTASK: Determine if the user's request applies ONLY to the selected elements (local) or requires changes to the surrounding/global context (global).`;
        }

        prompt += `\n\nRespond with ONLY a JSON object:
{
  "action": "what the user wants to do",
  "targetHint": "element to target (e.g., '.my-class', '#id')",
  "scope": "${hasSelection ? 'local|global' : 'global'}", 
  "property": "CSS/HTML property being changed",
  "value": "desired value",
  "intent": {"html": true, "css": true, "js": true},
  "complexity": "simple|medium|full"
}

Rules:
- "scope": "local" if the change affects ONLY the selected elements (e.g., 'change color', 'fix text'). "global" if it affects layout outside, or adds new sections outside.
- "simple" = CSS-only changes
- "medium" = HTML+CSS contents/structure changes
- "full" = major complex logic or redesigns`;

        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            temperature: 0,
            messages: [{ role: "user", content: prompt }]
        });

        let responseText = msg.content[0].text;

        // Extract JSON
        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1) {
            const parsed = JSON.parse(responseText.substring(startIndex, endIndex + 1));

            // Strategy reconciliation: prefer the LESS expensive strategy
            // Local analysis is better at detecting simple cases; LLM is better at detecting complex ones
            const strategyRank = { 'simple': 1, 'medium': 2, 'full': 3 };
            const localRank = strategyRank[localStrategy] || 2;
            const llmRank = strategyRank[parsed.complexity] || 2;

            // Use the less expensive strategy unless the LLM detected complexity local missed
            const finalStrategy = (localRank <= llmRank) ? localStrategy : parsed.complexity;

            console.log(`🔍 Intent: action=${parsed.action}, target=${parsed.targetHint}, strategy=${finalStrategy} (local=${localStrategy}, llm=${parsed.complexity})`);

            return {
                action: parsed.action || 'modify',
                targetHint: parsed.targetHint || 'body',
                scope: parsed.scope || 'global',
                property: parsed.property || null,
                value: parsed.value || null,
                strategy: hasImage ? 'full' : finalStrategy,
                intent: parsed.intent || { html: true, css: true, js: false },
                normalizedMessage,
                hasImage,
                hasSelection,
                selectionContext,
                usage: msg.usage
            };
        }
    } catch (err) {
        console.warn("⚠️ Intent parsing failed, using local analysis:", err.message);
    }

    // Fallback: local-only analysis
    return {
        action: 'modify',
        targetHint: 'body',
        scope: hasSelection ? 'local' : 'global', // fallback guess
        property: null,
        value: null,
        strategy: hasImage ? 'full' : localStrategy,
        intent: { html: true, css: true, js: false },
        normalizedMessage,
        hasImage,
        hasSelection,
        usage: { input_tokens: 0, output_tokens: 0 }
    };
}

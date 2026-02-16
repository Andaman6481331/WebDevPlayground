/**
 * mutationService.js — Mutation Execution (Stage 3)
 * 
 * Models: claude-sonnet-4-5-20250929 (Full) or claude-haiku-4-5-20251001 (Simple/Medium)
 * Role: Generates code mutations based on intent and context.
 * For simple/medium: generates fragments → surgically merges.
 * For full: generates complete code (same as original flow).
 * For image-reference: generates code from an image design reference.
 * For image-embed: injects image URLs into existing code.
 */

import { mergeHTMLFragment, mergeCSSFragment } from '../utils/mergeHTML.js';

// System prompt for FRAGMENT-based mutations (simple/medium)
const FRAGMENT_SYSTEM_PROMPT = `You are a precision web code editor. You generate ONLY the specific code fragment that needs to change — NOT the entire file.

RESPONSE FORMAT - JSON only:
{
  "message": "Brief description of change",
  "htmlFragment": "ONLY the changed HTML element/section (or null if no HTML changes)",
  "cssFragment": "ONLY the new/modified CSS rules (or null if no CSS changes)", 
  "jsFragment": "ONLY the new/modified JavaScript (or null if no JS changes)",
  "mergeMode": "replace|append"
}

RULES:
1. Return ONLY the fragment that changes, not the full file
2. CSS changes must include full rule blocks for affected selectors. Preserve existing class names and properties; only modify or add the properties that need to change.
3. HTML fragments should be the minimum subtree that needs to change
4. Use "replace" mergeMode to swap content, "append" to add new content
5. Preserve existing class names — do NOT rename them
6. New class names MUST include a timestamp suffix (e.g., .new-element-1707654321)
7. AVOID hacky CSS (negative margins, !important abuse) — use proper Flexbox/Grid
8. NO BASE64: Do NOT generate base64 or SVG data URLs for images.
9. PLACEHOLDERS: For generic images, use "https://placehold.co/600x400".
10. ATTACHED IMAGES: If the user provided an image, use "__ATTACHED_IMAGE__" as the src/url placeholder.
11. Return valid JSON only — no markdown wrapping`;

// System prompt for FULL code mutations (complex/fallback)
const FULL_SYSTEM_PROMPT = `You are a creative web development assistant. 

CRITICAL JSON FORMATTING RULES:
1. You MUST respond with ONLY valid JSON
2. Use proper JSON escaping for special characters:
   - Newlines must be \\n (not literal newlines)
   - Quotes must be \\"
   - Backslashes must be \\\\
3. The class name of the element must contain timestamp to prevent same class name collision on css
4. Format:
{
  "message": "Describe your changes",
  "html": "Complete HTML (body content only, no DOCTYPE/html/head)",
  "css": "Complete CSS code",
  "javascript": "Complete JavaScript code"
}

CRITICAL JAVASCRIPT SAFETY RULES:
1. ALWAYS check if elements exist before adding event listeners
2. Use null checks for ALL DOM queries: if (element) { ... }
3. Each component MUST be self-contained

- HTML: RETURN THE BODY CONTENT. Do NOT return DOCTYPE, html, or head tags.
- FULL CODE RULE: Return the COMPLETE content for changed fields. No snippets or "... existing code ...".
- NO BASE64: Do NOT generate base64 or SVG data URLs for images.
- PLACEHOLDERS: For any generic images, use "https://placehold.co/600x400".
- ATTACHED IMAGES: If the user provided an image, use "https://placehold.co/600x400?text=Attached+Image" as the src.
- OPTIMIZATION RULE: Return null for unchanged fields.
- PRESERVE existing structures and class names.`;

// System prompt for SELECTION-based mutations (Targeted Full Code)
const SELECTION_SYSTEM_PROMPT = `You are a precision UI editor specializing in Selection-Driven modifications.
The user has highlighted specific areas of the page to edit. Your PRIMARY objective is to modify ONLY the selected elements or their immediate layout containers.

CRITICAL JSON FORMATTING RULES:
1. You MUST respond with ONLY valid JSON
2. Use proper JSON escaping (\\n for newlines, \\" for quotes)
3. Format:
{
  "message": "Explain how you modified the selected elements",
  "html": "Complete HTML (body content only)",
  "css": "Complete CSS code",
  "javascript": "Complete JavaScript code or null"
}

SELECTION RULES:
- PRIORITIZE: The "SELECTION CONTEXT" provided contains IDs, Classes, and Text of the elements the user wants to change.
- SURGICAL EDITS: While you return the full code, focus your creative effort on the selected elements.
- PRESERVE SCOPE: Do NOT modify sections of the page that were not selected unless the user's request (e.g. "center everything") explicitly requires it.
- NO SNIPPETS: Return the COMPLETE content for all fields. No "... existing code ..." placeholders.
- HTML: RETURN BODY CONTENT ONLY. No DOCTYPE, html, or head tags.
- IMAGES: Use "https://placehold.co/600x400" for generic images. No base64.`;

// System prompt for IMAGE REFERENCE mutations (generate code from image)
const IMAGE_REFERENCE_SYSTEM_PROMPT = `You are a web development assistant that converts visual designs into code.

You are looking at a reference image and must recreate it as closely as possible using HTML and CSS.

CRITICAL JSON FORMATTING RULES:
1. You MUST respond with ONLY valid JSON
2. Use proper JSON escaping for special characters
3. The class name of the element must contain timestamp to prevent same class name collision on css
4. Format:
{
  "message": "Describe what you recreated from the image",
  "html": "Complete HTML (body content only, no DOCTYPE/html/head)",
  "css": "Complete CSS code",
  "javascript": "Complete JavaScript code or null"
}

RULES:
- Recreate the visual design as accurately as possible
- Use modern CSS (flexbox, grid) for layout
- Use realistic placeholder text that matches the image content
- ATTACHED IMAGES: Use "https://placehold.co/600x400?text=Attached+Image" for the primary subject/image appearing in the reference image.
- NO BASE64: Do NOT generate base64 or SVG data URLs.
- PLACEHOLDERS: For secondary/generic images, use "https://placehold.co/600x400".
- Match colors, fonts, spacing, and proportions from the image
- HTML: RETURN THE BODY CONTENT ONLY. No DOCTYPE, html, or head tags.
- FULL CODE RULE: Return COMPLETE content. No snippets.`;

// System prompt for IMAGE EMBED mutations (paste image into code)  
const IMAGE_EMBED_SYSTEM_PROMPT = `You are a precision web code editor. The user wants to insert/use an image in their code.

CRITICAL JSON FORMATTING RULES:
1. You MUST respond with ONLY valid JSON
2. Use proper JSON escaping
3. Format:
{
  "message": "Describe where you placed the image",
  "html": "Updated HTML with the image placed appropriately",
  "css": "Updated CSS with any needed image styling",
  "javascript": null
}

RULES:
- Use "https://placehold.co/600x400?text=Attached+Image" for the user's attached image source
- If user says "as background", use CSS: background-image: url("https://placehold.co/600x400?text=Attached+Image")
- If user says "placeholder" or "put this image", replace <img> placeholder elements with the attached image placeholder
- NO BASE64: Do NOT generate base64 or SVG data URLs for any other images.
- PLACEHOLDERS: For any generic images, use "https://placehold.co/600x400".
- Maintain existing page structure — only add/modify the image placement
- PRESERVE existing class names and structures
- Return COMPLETE content for changed fields, null for unchanged`;

/**
 * Execute a mutation based on the strategy.
 * 
 * @param {Object} anthropic - Anthropic client
 * @param {Object} intent - From intentService
 * @param {Object} context - From contextService  
 * @param {Object} currentCode - { html, css, javascript }
 * @param {string} feedbackPrompt - Optional feedback from validation retry
 * @param {string} userModel - The model selected by the user
 * @returns {Object} { html, css, javascript, message, usage, mutationType }
 */
export async function executeMutation(anthropic, intent, context, currentCode, feedbackPrompt = null, userModel) {
    const strategy = context.strategy;

    // Highest Priority: Selection-Driven Mutation
    if (intent.hasSelection) {
        return executeSelectionMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel);
    }

    if (strategy === 'full') {
        return executeFullMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel);
    } else {
        return executeFragmentMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel);
    }
}

/**
 * Execute an image-based mutation (reference or embed).
 * 
 * @param {Object} anthropic - Anthropic client
 * @param {string} imageMode - 'reference' or 'embed'
 * @param {string} imageDataUrl - The base64 image data URL
 * @param {string} message - User's request message
 * @param {Object} intent - From intentService  
 * @param {Object} currentCode - { html, css, javascript }
 * @param {string} userModel - The model selected by the user
 * @returns {Object} { html, css, javascript, message, usage, mutationType }
 */
export async function executeImageMutation(anthropic, imageMode, imageDataUrl, message, intent, currentCode, userModel) {
    if (imageMode === 'embed') {
        return executeImageEmbedMutation(anthropic, imageDataUrl, message, intent, currentCode, userModel);
    } else {
        return executeImageReferenceMutation(anthropic, imageDataUrl, message, intent, currentCode, userModel);
    }
}

/**
 * Apply changes to a specific fragment of code (Surgical / Low-Token).
 * Uses Haiku for simple, Sonnet for medium
 * 
 * @param {Object} anthropic - Anthropic client
 * @param {Object} intent - From intentService
 * @param {Object} context - From contextService  
 * @param {Object} currentCode - { html, css, javascript }
 * @param {string} feedbackPrompt - Optional feedback from validation retry
 * @param {string} userModel - The model selected by the user
 * @returns {Object} { html, css, javascript, message, usage, mutationType }
 */
async function executeFragmentMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel) {
    // If user explicitly chose a model, use it. Otherwise follow adaptive strategy.
    // Note: server/index.js currently defaults to Sonnet if undefined, so userModel is likely always set.
    // To preserve 'simple' optimization, we could check if userModel is the default Sonnet? 
    // But simplest interpretation of "use user selected model" is to just use it.
    const model = (context.strategy === 'simple'
        ? 'claude-haiku-4-5-20251001'
        : userModel || 'claude-sonnet-4-5-20250929');

    const userContent = buildFragmentPrompt(intent, context, currentCode, feedbackPrompt);

    console.log(`🔧 Fragment mutation (${context.strategy}) using ${model}`);

    try {
        const msg = await anthropic.messages.create({
            model,
            max_tokens: 4000,
            temperature: 0.1,
            system: FRAGMENT_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }]
        });

        const responseText = msg.content[0].text;
        const parsed = parseJSON(responseText);

        if (!parsed) {
            throw new Error('Failed to parse fragment response as JSON');
        }

        // Surgical merge: inject fragments into full code
        let mergedHTML = currentCode.html;
        let mergedCSS = currentCode.css;
        let mergedJS = currentCode.javascript;

        if (parsed.htmlFragment) {
            mergedHTML = mergeHTMLFragment(
                currentCode.html,
                parsed.htmlFragment,
                context.selector,
                parsed.mergeMode || 'replace'
            );
        }

        if (parsed.cssFragment) {
            mergedCSS = mergeCSSFragment(
                currentCode.css,
                parsed.cssFragment,
                context.selector
            );
        }

        if (parsed.jsFragment) {
            // For JS, we append (don't replace) since JS is additive
            mergedJS = currentCode.javascript
                ? currentCode.javascript + '\n\n' + parsed.jsFragment
                : parsed.jsFragment;
        }

        return {
            html: mergedHTML !== currentCode.html ? mergedHTML : null,
            css: mergedCSS !== currentCode.css ? mergedCSS : null,
            javascript: mergedJS !== currentCode.javascript ? mergedJS : null,
            message: parsed.message || 'Applied surgical edit.',
            usage: msg.usage,
            mutationType: 'fragment'
        };
    } catch (err) {
        console.warn(`⚠️ Fragment mutation failed: ${err.message}. Will need fallback.`);
        throw err; // Let orchestrator handle fallback
    }
}

/**
 * Full code mutation (full strategy or fallback)
 * Always uses Sonnet (or user selected model) for quality
 */
async function executeFullMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel) {
    const model = userModel || 'claude-sonnet-4-5-20250929';

    const userContent = buildFullPrompt(intent, context, currentCode, feedbackPrompt);

    console.log(`🔧 Full mutation using ${model}`);

    const msg = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        temperature: 0.1,
        system: FULL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
    });

    const responseText = msg.content[0].text;
    const parsed = parseJSON(responseText);

    if (!parsed) {
        throw new Error('Failed to parse full mutation response as JSON');
    }

    return {
        html: parsed.html !== undefined ? parsed.html : null,
        css: parsed.css !== undefined ? parsed.css : null,
        javascript: parsed.javascript !== undefined ? parsed.javascript : (parsed.js !== undefined ? parsed.js : null),
        message: parsed.message || parsed.explanation || 'Updated code.',
        usage: msg.usage,
        mutationType: 'full'
    };
}

/**
 * Selection-specific mutation: prioritizes selected elements within full code.
 */
async function executeSelectionMutation(anthropic, intent, context, currentCode, feedbackPrompt, userModel) {
    // Selection mutations always use Sonnet for high-precision awareness
    const model = userModel || 'claude-sonnet-4-5-20250929';

    const userContent = buildSelectionPrompt(intent, context, currentCode, feedbackPrompt);

    console.log(`🎯 Selection mutation using ${model}`);

    const msg = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        temperature: 0, // Lower temperature for higher precision
        system: SELECTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
    });

    const responseText = msg.content[0].text;
    const parsed = parseJSON(responseText);

    if (!parsed) {
        throw new Error('Failed to parse selection mutation response as JSON');
    }

    return {
        html: parsed.html !== undefined ? parsed.html : null,
        css: parsed.css !== undefined ? parsed.css : null,
        javascript: parsed.javascript !== undefined ? parsed.javascript : (parsed.js !== undefined ? parsed.js : null),
        message: parsed.message || 'Updated selected elements.',
        usage: msg.usage,
        mutationType: 'selection'
    };
}

// ========== Prompt Builders ==========

function buildFragmentPrompt(intent, context, currentCode, feedbackPrompt) {
    let prompt = `TASK: ${intent.normalizedMessage || intent.action}`;

    if (intent.hasSelection) {
        prompt += `\n\n🎯 SELECTION CONTEXT: The user selected these elements:\n${intent.selectionContext}\n\nIMPORTANT: Focus your changes on these selected elements. ${intent.scope === 'local' ? 'Do NOT modify external layout.' : 'You may modify surrounding layout if needed.'}`;
    }

    prompt += `\n\nTARGET ELEMENT: ${context.selector} (resolved by: ${context.resolvedBy})
    ACTION: ${intent.action}
    ${intent.property ? `PROPERTY: ${intent.property}` : ''}
    ${intent.value ? `VALUE: ${intent.value}` : ''}

    SURROUNDING HTML:
    ${context.surroundingHTML}

    RELEVANT CSS:
    ${context.surroundingCSS}`;

    if (feedbackPrompt) {
        prompt += `\n\n⚠️ RETRY — PREVIOUS ATTEMPT FAILED:\n${feedbackPrompt}`;
    }

    return prompt;
}

function buildSelectionPrompt(intent, context, currentCode, feedbackPrompt) {
    let prompt = `PRECISION TASK: ${intent.normalizedMessage || intent.action}\n\n`;

    prompt += `🎯 SELECTION CONTEXT (Priority Targets):\n${intent.selectionContext}\n\n`;

    prompt += `INSTRUCTION: Modify the elements listed above as requested. You have access to the full code below to ensure layout consistency, but the focus is SURGICAL editing of the selected areas.\n\n`;

    prompt += `CURRENT CODE:\n`;
    prompt += `HTML:\n${currentCode.html}\n\n`;
    prompt += `CSS:\n${currentCode.css}\n\n`;
    if (currentCode.javascript) prompt += `JavaScript:\n${currentCode.javascript}\n\n`;

    if (feedbackPrompt) {
        prompt += `\n⚠️ RETRY — PREVIOUS ATTEMPT FAILED:\n${feedbackPrompt}`;
    }

    return prompt;
}

// ========== Helpers ==========

function parseJSON(text) {
    let cleaned = text.trim();

    // Remove markdown code blocks
    const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(cleaned);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    // Find JSON boundaries
    if (!cleaned.startsWith('{')) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn('⚠️ JSON parse failed:', e.message);

        // Try regex extraction as last resort
        const extractField = (field) => {
            const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,|"\\s*})`, 'g');
            const match = regex.exec(cleaned);
            return match ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
        };

        const result = {
            message: extractField('message'),
            htmlFragment: extractField('htmlFragment'),
            cssFragment: extractField('cssFragment'),
            jsFragment: extractField('jsFragment'),
            html: extractField('html'),
            css: extractField('css'),
            javascript: extractField('javascript') || extractField('js'),
            mergeMode: extractField('mergeMode') || 'replace'
        };

        // If at least something was extracted, return it
        if (result.htmlFragment || result.cssFragment || result.html || result.css) {
            console.log('✅ Partial JSON extraction successful');
            return result;
        }

        return null;
    }
}

// ========== Image Mutation Functions ==========

/**
 * Extract media type and base64 data from a data URL.
 * Also attempts to detect the correct media type from the base64 content itself.
 */
function parseImageDataUrl(dataUrl) {
    // Format: data:image/png;base64,iVBOR...
    let mediaType = 'image/jpeg';
    let base64Data = dataUrl;

    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
    if (match) {
        mediaType = match[1];
        base64Data = match[2];
    } else if (dataUrl.includes(';base64,')) {
        base64Data = dataUrl.split(';base64,')[1];
    } else {
        base64Data = dataUrl.replace(/^data:image\/[a-zA-Z+]+,/, '');
    }

    // Sanitize: remove any whitespace
    base64Data = base64Data.replace(/\s/g, '');

    // Magic bytes detection (more robust than trusting the header)
    if (base64Data.startsWith('iVBOR')) mediaType = 'image/png';
    else if (base64Data.startsWith('/9j/')) mediaType = 'image/jpeg';
    else if (base64Data.startsWith('UklG')) mediaType = 'image/webp';
    else if (base64Data.startsWith('R0lG')) mediaType = 'image/gif';

    return { mediaType, data: base64Data };
}

/**
 * Image Reference mutation: generate HTML/CSS from a design image.
 * Uses Sonnet vision to analyze the image and produce matching code.
 */
async function executeImageReferenceMutation(anthropic, imageDataUrl, message, intent, currentCode, userModel) {
    const model = userModel || 'claude-sonnet-4-5-20250929';
    const { mediaType, data } = parseImageDataUrl(imageDataUrl);

    console.log(`🖼️ Image Reference mutation using ${model}`);

    const userContent = [
        {
            type: "image",
            source: { type: "base64", media_type: mediaType, data }
        },
        {
            type: "text",
            text: `${message || 'Recreate this design as HTML/CSS code.'}\n\n${currentCode.html && currentCode.html.trim()
                ? `EXISTING CODE (preserve structure where possible):\nHTML:\n${currentCode.html}\n\nCSS:\n${currentCode.css}`
                : 'There is no existing code. Create from scratch.'
                }`
        }
    ];

    const msg = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        temperature: 0.1,
        system: IMAGE_REFERENCE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
    });

    const parsed = parseJSON(msg.content[0].text);

    if (!parsed) throw new Error('Failed to parse image reference response');

    // No injection needed — uses placeholder URL directly

    return {
        html: parsed.html !== undefined ? parsed.html : null,
        css: parsed.css !== undefined ? parsed.css : null,
        javascript: parsed.javascript !== undefined ? parsed.javascript : null,
        message: parsed.message || 'Recreated the design from the reference image.',
        usage: msg.usage,
        mutationType: 'image-reference'
    };
}

/**
 * Image Embed mutation: insert an image into existing code.
 * Places it as an <img> tag, background-image, or replaces a placeholder.
 */
async function executeImageEmbedMutation(anthropic, imageDataUrl, message, intent, currentCode, userModel) {
    const model = userModel || 'claude-sonnet-4-5-20250929';
    const { mediaType, data } = parseImageDataUrl(imageDataUrl);

    console.log(`🖼️ Image Embed mutation using ${model}`);

    const userContent = [
        {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: data }
        },
        {
            type: "text",
            text: `USER REQUEST: ${message || 'Insert this image into the page.'}

INSTRUCTION: 
1. Identify the best place to insert the attached image.
2. Use the exact string "https://placehold.co/600x400?text=Attached+Image" as the placeholder for the image URL in the code.
3. Replace existing <img> src or CSS background-image values with this placeholder.

CURRENT CODE:
HTML:
${currentCode.html}

CSS:
${currentCode.css}

JavaScript:
${currentCode.javascript || ''}`
        }
    ];

    const msg = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        temperature: 0.1,
        system: IMAGE_EMBED_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
    });

    const parsed = parseJSON(msg.content[0].text);

    if (!parsed) throw new Error('Failed to parse image embed response');

    // No injection needed — we serve the code with the placeholder URL directly

    return {
        html: parsed.html !== undefined ? parsed.html : null,
        css: parsed.css !== undefined ? parsed.css : null,
        javascript: parsed.javascript !== undefined ? parsed.javascript : null,
        message: parsed.message || 'Embedded the image in the page.',
        usage: msg.usage,
        mutationType: 'image-embed'
    };
}

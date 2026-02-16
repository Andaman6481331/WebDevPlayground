/**
 * claudeService.js — Orchestrator (The Brain)
 * 
 * Coordinates the entire Adaptive AI pipeline:
 * 1. Intent Parsing (intentService)
 * 2. Context Building (contextService)
 * 3. Mutation Execution (mutationService)
 * 4. Validation & Retry (validationService)
 * 
 * Falls back to original full-code approach if the adaptive pipeline fails.
 */

import { parseIntent, detectImageMode } from './intentService.js';
import { resolveContext } from './contextService.js';
import { executeMutation, executeImageMutation } from './mutationService.js';
import { validateMutation } from './validationService.js';

const MAX_RETRIES = 1;

/**
 * Process a user request through the adaptive pipeline.
 * 
 * @param {Object} anthropic - Anthropic client
 * @param {string} message - User's natural language request
 * @param {Object} currentCode - { html, css, javascript }
 * @param {Object} options - { image, conversationMessages }
 * @returns {Object} { html, css, javascript, message, usage, pipeline }
 */
export async function processAdaptiveRequest(anthropic, message, currentCode, options = {}) {
    const startTime = Date.now();
    let totalUsage = { input_tokens: 0, output_tokens: 0 };
    let pipelineSteps = [];

    try {
        // ========== Stage 1: Intent Parsing ==========
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧠 ADAPTIVE PIPELINE START: "${message.substring(0, 60)}..."`);
        console.log(`${'='.repeat(60)}`);

        const intent = await parseIntent(anthropic, message, !!options.image);
        addUsage(totalUsage, intent.usage);
        pipelineSteps.push({ stage: 'intent', strategy: intent.strategy, action: intent.action, hasImage: !!options.image });

        console.log(`📋 Stage 1 Complete — Strategy: ${intent.strategy}, Action: ${intent.action}, Target: ${intent.targetHint}, Image: ${!!options.image}`);

        // ========== Stage 1.5: Image Logic (If Image Exists) ==========
        if (options.image) {
            const imageMode = detectImageMode(message);
            console.log(`🖼️ Image Detected — Mode: ${imageMode}`);

            try {
                const imageResult = await executeImageMutation(anthropic, imageMode, options.image, message, intent, currentCode, options.model);
                addUsage(totalUsage, imageResult.usage);
                pipelineSteps.push({ stage: 'image-mutation', mode: imageMode, success: true });

                // Return immediately for image tasks (they are usually full-page or specific embeds)
                return finalizePipeline(imageResult, totalUsage, pipelineSteps, startTime);
            } catch (imageError) {
                console.warn(`⚠️ Image Mutation Failed: ${imageError.message}`);
                pipelineSteps.push({ stage: 'image-mutation', mode: imageMode, success: false, error: imageError.message });
                // Fall back to original flow if image mutation fails
                throw imageError;
            }
        }

        // ========== Stage 2: Context Building ==========
        const context = resolveContext(intent, currentCode);
        pipelineSteps.push({ stage: 'context', selector: context.selector, resolvedBy: context.resolvedBy, strategy: context.strategy });

        console.log(`📋 Stage 2 Complete — Selector: ${context.selector}, ResolvedBy: ${context.resolvedBy}`);

        // ========== Stage 3: Mutation Execution ==========
        let mutationResult;
        try {
            // Pass the model selection down
            mutationResult = await executeMutation(anthropic, intent, context, currentCode, null, options.model);
            addUsage(totalUsage, mutationResult.usage);
            pipelineSteps.push({ stage: 'mutation', type: mutationResult.mutationType, success: true });

            console.log(`📋 Stage 3 Complete — Type: ${mutationResult.mutationType}`);
        } catch (mutationError) {
            console.warn(`⚠️ Stage 3 Failed: ${mutationError.message}`);
            pipelineSteps.push({ stage: 'mutation', type: 'fragment', success: false, error: mutationError.message });

            // Fall back to full mutation
            console.log(`🔄 Falling back to full mutation...`);
            intent.strategy = 'full';
            context.strategy = 'full';
            mutationResult = await executeMutation(anthropic, intent, context, currentCode, null, options.model);
            addUsage(totalUsage, mutationResult.usage);
            pipelineSteps.push({ stage: 'mutation-fallback', type: 'full', success: true });
        }

        // ========== Stage 4: Validation ==========
        const validation = validateMutation(intent, currentCode, mutationResult);
        pipelineSteps.push({ stage: 'validation', valid: validation.valid, errors: validation.errors });

        console.log(`📋 Stage 4 Complete — Valid: ${validation.valid}`);

        // ========== Retry if validation failed ==========
        if (!validation.valid && validation.feedbackPrompt) {
            for (let retry = 0; retry < MAX_RETRIES; retry++) {
                console.log(`🔄 Retry ${retry + 1}/${MAX_RETRIES} with feedback...`);

                try {
                    mutationResult = await executeMutation(anthropic, intent, context, currentCode, validation.feedbackPrompt, options.model);
                    addUsage(totalUsage, mutationResult.usage);

                    const retryValidation = validateMutation(intent, currentCode, mutationResult);
                    pipelineSteps.push({ stage: `retry-${retry + 1}`, valid: retryValidation.valid });

                    if (retryValidation.valid) {
                        console.log(`✅ Retry ${retry + 1} succeeded!`);
                        break;
                    }
                } catch (retryError) {
                    console.warn(`⚠️ Retry ${retry + 1} failed: ${retryError.message}`);
                    pipelineSteps.push({ stage: `retry-${retry + 1}`, success: false, error: retryError.message });
                }
            }
        }

        return finalizePipeline(mutationResult, totalUsage, pipelineSteps, startTime, context.strategy);
    } catch (pipelineError) {
        // ========== FULL FALLBACK ==========
        console.error(`❌ Adaptive pipeline failed entirely: ${pipelineError.message}`);
        console.log(`🔄 Falling back to ORIGINAL FLOW (send everything to Sonnet)...`);

        return executeOriginalFlow(anthropic, message, currentCode, options, totalUsage, pipelineSteps, startTime);
    }
}

/**
 * Helper to finalize the pipeline response
 */
function finalizePipeline(result, totalUsage, pipelineSteps, startTime, strategyOverride = null) {
    const elapsed = Date.now() - startTime;
    const strategy = strategyOverride || result.mutationType || 'unknown';

    console.log(`\n✅ ADAPTIVE PIPELINE COMPLETE in ${elapsed}ms`);
    console.log(`   Strategy: ${strategy} | Type: ${result.mutationType} | Tokens: ${totalUsage.input_tokens + totalUsage.output_tokens}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
        html: result.html,
        css: result.css,
        javascript: result.javascript,
        message: result.message,
        usage: totalUsage,
        pipeline: {
            strategy: strategy,
            mutationType: result.mutationType,
            steps: pipelineSteps,
            elapsed
        }
    };
}

/**
 * Original flow fallback: send entire code to Sonnet with full system prompt.
 * This is the same behavior as the existing /api/chat endpoint.
 */
async function executeOriginalFlow(anthropic, message, currentCode, options, totalUsage, pipelineSteps, startTime) {
    const SYSTEM_PROMPT = `You are a web development assistant. 

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
  "html": "HTML content (body only)",
  "css": "Complete CSS code",
  "javascript": "Complete JavaScript code"
}

CRITICAL JAVASCRIPT SAFETY RULES:
1. ALWAYS check if elements exist before adding event listeners
2. Use null checks for ALL DOM queries: if (element) { ... }
3. Each component MUST be self-contained

- HTML: RETURN THE BODY CONTENT. Do NOT return DOCTYPE, html, or head tags.
- FULL CODE RULE: Return the COMPLETE content for changed fields. No snippets.
- NO BASE64: Do NOT generate base64 or SVG data URLs for images.
- PLACEHOLDERS: For any generic images, use "https://placehold.co/600x400".
- ATTACHED IMAGES: If the user provided an image, use "https://placehold.co/600x400?text=Attached+Image" as the src.
- OPTIMIZATION RULE: Return null for unchanged fields.
- PRESERVE existing structures and class names.`;

    const userContent = [];

    // 1. Add Image if present
    if (options.image) {
        let base64Data = options.image;
        let mediaType = 'image/jpeg';

        const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(options.image);
        if (match) {
            mediaType = match[1];
            base64Data = match[2];
        } else if (options.image.includes(';base64,')) {
            base64Data = options.image.split(';base64,')[1];
        }

        base64Data = base64Data.replace(/\s/g, '');
        if (base64Data.startsWith('iVBOR')) mediaType = 'image/png';
        else if (base64Data.startsWith('/9j/')) mediaType = 'image/jpeg';
        else if (base64Data.startsWith('UklG')) mediaType = 'image/webp';
        else if (base64Data.startsWith('R0lG')) mediaType = 'image/gif';

        userContent.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data }
        });
    }

    // 2. Add Code State
    userContent.push({
        type: "text",
        text: `CURRENT CODE STATE:\nHTML:\n${currentCode.html}\n\nCSS:\n${currentCode.css}\n\nJavaScript:\n${currentCode.javascript}`
    });

    // 3. Add User Request
    userContent.push({
        type: "text",
        text: `User Request: ${message || (options.image ? "Make code based on this image." : "Update the code.")}\n\nINSTRUCTION: Use "https://placehold.co/600x400?text=Attached+Image" as the placeholder for the attached image source. DO NOT output the full data URL yourself.\n\nPlease generate the updated full HTML, CSS, and JS code.`
    });

    try {
        const msg = await anthropic.messages.create({
            model: options.model || 'claude-sonnet-4-5-20250929',
            max_tokens: 16000,
            temperature: 0.1,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }]
        });

        addUsage(totalUsage, msg.usage);

        const responseText = msg.content[0].text;
        let parsed;

        // Robust JSON extraction
        let cleaned = responseText.trim();
        const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(cleaned);
        if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
        if (!cleaned.startsWith('{')) {
            const f = cleaned.indexOf('{');
            const l = cleaned.lastIndexOf('}');
            if (f !== -1 && l !== -1 && l > f) cleaned = cleaned.substring(f, l + 1);
        }

        try {
            parsed = JSON.parse(cleaned);
        } catch (e) {
            // Regex fallback
            const extractField = (field) => {
                const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,|"\\s*})`, 'g');
                const match = regex.exec(cleaned);
                return match ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : null;
            };
            parsed = {
                message: extractField('message') || 'Updated code.',
                html: extractField('html'),
                css: extractField('css'),
                javascript: extractField('javascript') || extractField('js')
            };
        }

        pipelineSteps.push({ stage: 'original-fallback', success: true });

        const elapsed = Date.now() - startTime;
        console.log(`✅ FALLBACK COMPLETE in ${elapsed}ms | Tokens: ${totalUsage.input_tokens + totalUsage.output_tokens}`);

        // No injection - serve placeholder URL directly

        return {
            html: parsed.html !== undefined ? parsed.html : null,
            css: parsed.css !== undefined ? parsed.css : null,
            javascript: parsed.javascript !== undefined ? parsed.javascript : (parsed.js !== undefined ? parsed.js : null),
            message: parsed.message || parsed.explanation || 'Updated code.',
            usage: totalUsage,
            pipeline: {
                strategy: 'fallback',
                mutationType: 'full',
                steps: pipelineSteps,
                elapsed
            }
        };
    } catch (fallbackError) {
        console.error(`❌ ORIGINAL FLOW ALSO FAILED: ${fallbackError.message}`);
        throw fallbackError;
    }
}


// ========== Helpers ==========

function addUsage(total, usage) {
    if (!usage) return;
    total.input_tokens = (total.input_tokens || 0) + (usage.input_tokens || 0);
    total.output_tokens = (total.output_tokens || 0) + (usage.output_tokens || 0);
    if (usage.cache_creation_input_tokens) {
        total.cache_creation_input_tokens = (total.cache_creation_input_tokens || 0) + usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens) {
        total.cache_read_input_tokens = (total.cache_read_input_tokens || 0) + usage.cache_read_input_tokens;
    }
}

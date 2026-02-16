/**
 * contextService.js — Adaptive Context Building (Stage 2)
 * 
 * Role: Resolves abstract targetHint into actual DOM elements
 * and gathers surrounding metadata for surgical mutations.
 * 
 * Uses 5 resolution strategies + automatic strategy elevation.
 */

// Visual synonym mappings: general terms → probable HTML/CSS targets
const VISUAL_SYNONYMS = {
    // Layout sections
    'box': ['div', 'section', 'article'],
    'container': ['div.container', 'main', '.wrapper'],
    'wrapper': ['div.wrapper', '.container', 'main'],
    'theme': ['body', ':root', 'html'],
    'page': ['body', 'main', '.page'],
    'content': ['main', '.content', 'article'],

    // Navigation
    'navbar': ['nav', '.navbar', '.nav', 'header nav'],
    'menu': ['nav', '.menu', 'ul.nav'],
    'navigation': ['nav', '.navigation', 'header'],

    // Common UI
    'button': ['button', '.btn', 'a.btn', 'input[type="submit"]'],
    'header': ['header', 'h1', '.header'],
    'title': ['h1', 'h2', '.title', '.heading'],
    'subtitle': ['h2', 'h3', '.subtitle'],
    'heading': ['h1', 'h2', 'h3'],
    'paragraph': ['p', '.text'],
    'text': ['p', 'span', '.text'],
    'link': ['a', '.link'],
    'image': ['img', 'picture', '.image'],
    'card': ['.card', 'article', '.card-container'],
    'footer': ['footer', '.footer'],
    'hero': ['.hero', '.hero-section', 'section:first-of-type'],
    'sidebar': ['aside', '.sidebar', '.side-panel'],
    'form': ['form', '.form'],
    'input': ['input', 'textarea', '.input-field'],
    'modal': ['.modal', '.dialog', '.popup'],
    'banner': ['.banner', '.hero', 'header'],
    'icon': ['i', '.icon', 'svg'],
    'list': ['ul', 'ol', '.list'],
    'table': ['table', '.table'],
};

// Action-based defaults: which elements to target based on action type
const ACTION_DEFAULTS = {
    'recolor': ['p', 'h1', 'h2', 'h3', 'span', 'button', 'a'],
    'change_color': ['p', 'h1', 'h2', 'h3', 'span', 'button', 'a'],
    'resize': ['div', 'section', 'img', '.container'],
    'add_element': ['main', 'body', '.container'],
    'modify_layout': ['body', 'main', '.container'],
    'add_animation': ['button', '.card', 'a', 'img'],
    'fix_bug': ['body'],
};

// Layout-sensitive actions that should elevate 'simple' to 'medium'
const LAYOUT_SENSITIVE_ACTIONS = [
    'align', 'resize', 'rearrange', 'reorder', 'move', 'position',
    'grid', 'flex', 'layout', 'responsive', 'stack', 'distribute',
    'modify_layout', 'center'
];

/**
 * Resolve targetHint into a concrete CSS selector + surrounding context.
 * 
 * @param {Object} intent - Parsed intent from intentService
 * @param {Object} currentCode - { html, css, javascript }
 * @returns {Object} { selector, surroundingHTML, surroundingCSS, strategy, resolvedBy }
 */
export function resolveContext(intent, currentCode) {
    const { targetHint, action, strategy: originalStrategy } = intent;
    const html = currentCode.html || '';
    const css = currentCode.css || '';

    let resolved = null;
    let resolvedBy = 'none';

    // Strategy 0: Explicit Selection (Highest Priority)
    if (intent.hasSelection) {
        resolved = trySelectionStrategy(intent.selectionContext, html);
        if (resolved) {
            resolvedBy = 'selection';
            // Force local scope if not already set, or respect intent
            if (intent.scope === 'local') {
                console.log('🎯 Using selection context for local scope');
            }
            // FORCE 'full' strategy for selections to ensure we don't do partial fragment replacements
            // on a 'body' selector (which would wipe the page if AI returns just the selection).
            finalStrategy = 'full';
            console.log('📈 Strategy elevated to FULL for selection context.');
        }
    }

    // Strategy 1: Direct Selector (IDs, classes, or hyphenated multi-words)
    if (!resolved) {
        resolved = tryDirectSelector(targetHint, html);
        if (resolved) {
            resolvedBy = 'direct';
        }
    }

    // Strategy 2: Visual Synonyms
    if (!resolved) {
        resolved = tryVisualSynonyms(targetHint, html);
        if (resolved) resolvedBy = 'synonym';
    }

    // Strategy 3: Text-only Search
    if (!resolved) {
        resolved = tryTextSearch(targetHint, html);
        if (resolved) resolvedBy = 'text-search';
    }

    // Strategy 4: Action Fallback
    if (!resolved) {
        resolved = tryActionFallback(action, html);
        if (resolved) resolvedBy = 'action-fallback';
    }

    // Strategy 5: Absolute Fallback
    if (!resolved) {
        resolved = { selector: 'body', matchedTag: 'body' };
        resolvedBy = 'absolute-fallback';
    }

    // Strategy Elevation: upgrade 'simple' → 'medium' for layout-sensitive actions
    let finalStrategy = originalStrategy;
    if (finalStrategy === 'simple' && LAYOUT_SENSITIVE_ACTIONS.some(a =>
        action?.toLowerCase().includes(a) || intent.normalizedMessage?.toLowerCase().includes(a)
    )) {
        finalStrategy = 'medium';
        console.log(`📈 Strategy elevated: simple → medium (layout-sensitive action: ${action})`);
    }

    // Extract surrounding context
    const surroundingHTML = extractSurroundingHTML(html, resolved.selector);
    const surroundingCSS = extractSurroundingCSS(css, resolved.selector, resolved.matchedTag);

    console.log(`🎯 Context: selector="${resolved.selector}", resolvedBy=${resolvedBy}, strategy=${finalStrategy}`);

    return {
        selector: resolved.selector,
        matchedTag: resolved.matchedTag,
        surroundingHTML,
        surroundingCSS,
        strategy: finalStrategy,
        resolvedBy
    };
}

// ========== Strategy Implementations ==========

function trySelectionStrategy(selectionContext, html) {
    if (!selectionContext) return null;

    try {
        const jsonMatch = selectionContext.match(/\[.*?\]/s);
        if (!jsonMatch) return null;

        const elements = JSON.parse(jsonMatch[0]);
        if (!elements || elements.length === 0) return null;

        // SAFETY NET: User Request
        // Even if we selected specific elements, we calculate the context as 'body' (Global)
        // to ensure the AI sees ALL selected elements and their surrounding layout.
        // The `selectionContext` JSON passed to the LLM will tell it exactly which elements 
        // within this full body to specifically target/modify.
        console.log('🛡️ Selection Safety Net: Forcing full HTML context for multi-element visibility.');

        return { selector: 'body', matchedTag: 'body' };

    } catch (e) {
        console.warn('Failed to parse selection context:', e);
        return null;
    }
}

function tryDirectSelector(targetHint, html) {
    if (!targetHint) return null;
    const hint = targetHint.trim();

    // Already a CSS selector (#id, .class)
    if (hint.startsWith('#') || hint.startsWith('.')) {
        // Verify it exists in the HTML
        if (hint.startsWith('#')) {
            const id = hint.substring(1);
            const regex = new RegExp(`id=["']${escapeRegex(id)}["']`, 'i');
            if (regex.test(html)) {
                return { selector: hint, matchedTag: extractTagForSelector(html, hint) };
            }
        } else {
            const className = hint.substring(1);
            const regex = new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b`, 'i');
            if (regex.test(html)) {
                return { selector: hint, matchedTag: extractTagForSelector(html, hint) };
            }
        }
    }

    // Tag name (e.g., "header", "nav", "h1")
    if (/^[a-z][a-z0-9]*$/i.test(hint)) {
        const tagRegex = new RegExp(`<${escapeRegex(hint)}[\\s>]`, 'i');
        if (tagRegex.test(html)) {
            return { selector: hint.toLowerCase(), matchedTag: hint.toLowerCase() };
        }
    }

    // Hyphenated multi-word (likely a class name like "hero-section")
    if (hint.includes('-') && /^[a-z][a-z0-9-]+$/i.test(hint)) {
        // Check as class
        const classRegex = new RegExp(`class=["'][^"']*\\b${escapeRegex(hint)}\\b`, 'i');
        if (classRegex.test(html)) {
            return { selector: `.${hint}`, matchedTag: extractTagForSelector(html, `.${hint}`) };
        }
        // Check as ID
        const idRegex = new RegExp(`id=["']${escapeRegex(hint)}["']`, 'i');
        if (idRegex.test(html)) {
            return { selector: `#${hint}`, matchedTag: extractTagForSelector(html, `#${hint}`) };
        }
    }

    return null;
}

function tryVisualSynonyms(targetHint, html) {
    if (!targetHint) return null;
    const hint = targetHint.toLowerCase().trim();

    const synonyms = VISUAL_SYNONYMS[hint];
    if (!synonyms) return null;

    for (const synonym of synonyms) {
        if (synonym.startsWith('.')) {
            const className = synonym.substring(1);
            const regex = new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b`, 'i');
            if (regex.test(html)) {
                return { selector: synonym, matchedTag: extractTagForSelector(html, synonym) };
            }
        } else {
            const tagRegex = new RegExp(`<${escapeRegex(synonym)}[\\s>]`, 'i');
            if (tagRegex.test(html)) {
                return { selector: synonym, matchedTag: synonym };
            }
        }
    }

    return null;
}

function tryTextSearch(targetHint, html) {
    if (!targetHint) return null;
    const hint = targetHint.trim();

    // Search for elements containing specific text
    // Find elements that contain the text content
    const textRegex = new RegExp(`<(\\w+)[^>]*>[^<]*${escapeRegex(hint)}[^<]*</\\1>`, 'i');
    const match = textRegex.exec(html);

    if (match) {
        const tag = match[1].toLowerCase();
        // Try to get a more specific selector from the element's attributes
        const elementHTML = match[0];
        const classMatch = elementHTML.match(/class=["']([^"']+)["']/);
        const idMatch = elementHTML.match(/id=["']([^"']+)["']/);

        if (idMatch) return { selector: `#${idMatch[1]}`, matchedTag: tag };
        if (classMatch) {
            const firstClass = classMatch[1].split(/\s+/)[0];
            return { selector: `.${firstClass}`, matchedTag: tag };
        }
        return { selector: tag, matchedTag: tag };
    }

    return null;
}

function tryActionFallback(action, html) {
    if (!action) return null;

    const defaults = ACTION_DEFAULTS[action.toLowerCase()];
    if (!defaults) return null;

    for (const selector of defaults) {
        if (selector.startsWith('.')) {
            const className = selector.substring(1);
            const regex = new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b`, 'i');
            if (regex.test(html)) {
                return { selector, matchedTag: extractTagForSelector(html, selector) };
            }
        } else {
            const tagRegex = new RegExp(`<${escapeRegex(selector)}[\\s>]`, 'i');
            if (tagRegex.test(html)) {
                return { selector, matchedTag: selector };
            }
        }
    }

    return null;
}

// ========== Helpers ==========

function extractTagForSelector(html, selector) {
    if (selector.startsWith('#')) {
        const id = selector.substring(1);
        const match = new RegExp(`<(\\w+)[^>]*\\bid=["']${escapeRegex(id)}["']`, 'i').exec(html);
        return match ? match[1].toLowerCase() : 'div';
    }
    if (selector.startsWith('.')) {
        const className = selector.substring(1);
        const match = new RegExp(`<(\\w+)[^>]*\\bclass=["'][^"']*\\b${escapeRegex(className)}\\b`, 'i').exec(html);
        return match ? match[1].toLowerCase() : 'div';
    }
    return selector.toLowerCase();
}

function extractSurroundingHTML(html, selector) {
    if (!html || !selector) return html;

    // For simple/medium strategy, we want to send only the relevant HTML fragment
    // Try to extract the matched element and its contents
    let pattern;

    if (selector.startsWith('#')) {
        const id = selector.substring(1);
        pattern = new RegExp(`<(\\w+)[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*>[\\s\\S]*?</\\1>`, 'i');
    } else if (selector.startsWith('.')) {
        const className = selector.substring(1);
        pattern = new RegExp(`<(\\w+)[^>]*\\bclass=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>[\\s\\S]*?</\\1>`, 'i');
    } else {
        pattern = new RegExp(`<(${escapeRegex(selector)})[^>]*>[\\s\\S]*?</\\1>`, 'i');
    }

    const match = pattern.exec(html);
    if (match) {
        return match[0];
    }

    // Fallback: return full HTML
    return html;
}

function extractSurroundingCSS(css, selector, matchedTag) {
    if (!css) return '';

    const relevantRules = [];
    // Extract CSS rules that affect the targeted selector
    const selectors = [selector, matchedTag].filter(Boolean);

    for (const sel of selectors) {
        const escaped = escapeRegex(sel);
        // Match rules where this selector appears
        const ruleRegex = new RegExp(`[^{}]*${escaped}[^{]*\\{[^}]*\\}`, 'gi');
        let match;
        while ((match = ruleRegex.exec(css)) !== null) {
            relevantRules.push(match[0].trim());
        }
    }

    return relevantRules.length > 0 ? relevantRules.join('\n\n') : css;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

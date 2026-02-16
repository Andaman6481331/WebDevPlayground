/**
 * mergeHTML.js — Surgical HTML/CSS fragment merge utility
 * 
 * Injects or replaces HTML/CSS fragments into the full codebase
 * using CSS selectors, without needing a full DOM parser.
 */

/**
 * Merge an HTML fragment into the full HTML at the target selector.
 * Supports: #id, .class, tag selectors.
 * 
 * Modes:
 * - 'replace': Replace the inner content of the matched element
 * - 'append': Append the fragment inside the matched element
 * - 'wrap': Replace the entire matched element (outer)
 */
export function mergeHTMLFragment(fullHTML, fragmentHTML, selector, mode = 'replace') {
    if (!fullHTML || !fragmentHTML || !selector) {
        return fragmentHTML || fullHTML;
    }

    // Build regex pattern for the selector
    const selectorPattern = buildSelectorPattern(selector);
    if (!selectorPattern) {
        // Can't parse selector — just return fragment as full replacement
        return fragmentHTML;
    }

    const { tagRegex, tagName } = selectorPattern;
    const match = tagRegex.exec(fullHTML);

    if (!match) {
        // Selector not found — append fragment at the end
        return fullHTML + '\n' + fragmentHTML;
    }

    // Find the closing tag for this element
    const openTagEnd = match.index + match[0].length;
    const closeTag = findClosingTag(fullHTML, tagName, match.index);

    if (closeTag === -1) {
        // Self-closing or no closing tag found — append after
        return fullHTML + '\n' + fragmentHTML;
    }

    switch (mode) {
        case 'replace':
            // Replace inner content
            return fullHTML.substring(0, openTagEnd) +
                '\n' + fragmentHTML + '\n' +
                fullHTML.substring(closeTag);
        case 'append':
            // Append inside, before closing tag
            return fullHTML.substring(0, closeTag) +
                '\n' + fragmentHTML +
                fullHTML.substring(closeTag);
        case 'wrap':
            // Replace entire element including tags
            const closeTagEnd = closeTag + `</${tagName}>`.length;
            return fullHTML.substring(0, match.index) +
                fragmentHTML +
                fullHTML.substring(closeTagEnd);
        default:
            return fullHTML;
    }
}

/**
 * Merge CSS fragment into the full CSS.
 * If rules for the same selector already exist, replace them.
 * Otherwise, append the new rules.
 */
export function mergeCSSFragment(fullCSS, fragmentCSS, selector) {
    if (!fullCSS && !fragmentCSS) return '';
    if (!fullCSS) return fragmentCSS;
    if (!fragmentCSS) return fullCSS;

    // Try to find and replace existing rules for this selector
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleRegex = new RegExp(
        `(${escapedSelector}\\s*\\{[^}]*\\})`,
        'g'
    );

    // Extract new rules from fragment
    const fragmentRules = extractCSSRules(fragmentCSS);

    if (fragmentRules.length === 0) {
        // No parseable rules in fragment — just append
        return fullCSS + '\n\n' + fragmentCSS;
    }

    let mergedCSS = fullCSS;
    let hasReplaced = false;

    for (const rule of fragmentRules) {
        const ruleSelector = rule.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingRuleRegex = new RegExp(
            `${ruleSelector}\\s*\\{[^}]*\\}`,
            'g'
        );

        if (existingRuleRegex.test(mergedCSS)) {
            // Replace existing rule
            mergedCSS = mergedCSS.replace(existingRuleRegex, rule.full);
            hasReplaced = true;
        }
    }

    if (!hasReplaced) {
        // No existing rules found — append all fragment CSS
        mergedCSS = mergedCSS.trim() + '\n\n' + fragmentCSS.trim();
    } else {
        // Some rules were replaced, but check if there are new selectors not in original
        for (const rule of fragmentRules) {
            const ruleSelector = rule.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const existsRegex = new RegExp(ruleSelector + '\\s*\\{');
            if (!existsRegex.test(fullCSS)) {
                mergedCSS = mergedCSS.trim() + '\n\n' + rule.full;
            }
        }
    }

    return mergedCSS;
}

// ========== Internal Helpers ==========

function buildSelectorPattern(selector) {
    selector = selector.trim();

    // #id selector
    if (selector.startsWith('#')) {
        const id = selector.substring(1);
        return {
            tagRegex: new RegExp(`<(\\w+)[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*>`, 'i'),
            tagName: null // will be captured from match
        };
    }

    // .class selector
    if (selector.startsWith('.')) {
        const className = selector.substring(1);
        return {
            tagRegex: new RegExp(`<(\\w+)[^>]*\\bclass=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`, 'i'),
            tagName: null
        };
    }

    // tag selector (e.g., "body", "header", "section")
    if (/^\w+$/.test(selector)) {
        return {
            tagRegex: new RegExp(`<(${escapeRegex(selector)})[^>]*>`, 'i'),
            tagName: selector.toLowerCase()
        };
    }

    // tag.class or tag#id
    const tagClassMatch = selector.match(/^(\w+)\.(.+)$/);
    if (tagClassMatch) {
        const [, tag, className] = tagClassMatch;
        return {
            tagRegex: new RegExp(`<(${escapeRegex(tag)})[^>]*\\bclass=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`, 'i'),
            tagName: tag.toLowerCase()
        };
    }

    return null;
}

function findClosingTag(html, tagName, startIndex) {
    if (!tagName) {
        // Extract tag name from the opening tag at startIndex
        const openMatch = /<(\w+)/.exec(html.substring(startIndex));
        if (!openMatch) return -1;
        tagName = openMatch[1];
    }

    // Simple nesting-aware closing tag finder
    let depth = 0;
    const openPattern = new RegExp(`<${tagName}[\\s>/]`, 'gi');
    const closePattern = new RegExp(`</${tagName}>`, 'gi');

    // Collect all open and close positions after startIndex
    const positions = [];

    openPattern.lastIndex = startIndex;
    let m;
    while ((m = openPattern.exec(html)) !== null) {
        positions.push({ index: m.index, type: 'open' });
    }

    closePattern.lastIndex = startIndex;
    while ((m = closePattern.exec(html)) !== null) {
        positions.push({ index: m.index, type: 'close' });
    }

    positions.sort((a, b) => a.index - b.index);

    for (const pos of positions) {
        if (pos.type === 'open') depth++;
        if (pos.type === 'close') {
            depth--;
            if (depth === 0) return pos.index;
        }
    }

    return -1;
}

function extractCSSRules(css) {
    const rules = [];
    // Match selector { ... } blocks (non-nested, simple rules)
    const ruleRegex = /([^{}]+?)\s*\{([^{}]*)\}/g;
    let match;
    while ((match = ruleRegex.exec(css)) !== null) {
        rules.push({
            selector: match[1].trim(),
            body: match[2].trim(),
            full: match[0].trim()
        });
    }
    return rules;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

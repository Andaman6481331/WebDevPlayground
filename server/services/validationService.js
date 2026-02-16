/**
 * validationService.js — Validation & Retry (Stage 4)
 * 
 * Role: "Visual/Logical Auditor"
 * Checks if the requested change was actually applied and
 * generates feedback prompts for retry if validation fails.
 */

/**
 * Validate that the mutation actually achieved the user's intent.
 * 
 * @param {Object} intent - Parsed intent from intentService
 * @param {Object} originalCode - { html, css, javascript } before mutation
 * @param {Object} mutatedCode - { html, css, javascript } after mutation (null fields = unchanged)
 * @returns {Object} { valid, errors, feedbackPrompt }
 */
export function validateMutation(intent, originalCode, mutatedCode) {
    const errors = [];

    // 1. Check that at least something changed
    const htmlChanged = mutatedCode.html !== null && mutatedCode.html !== undefined;
    const cssChanged = mutatedCode.css !== null && mutatedCode.css !== undefined;
    const jsChanged = mutatedCode.javascript !== null && mutatedCode.javascript !== undefined;

    if (!htmlChanged && !cssChanged && !jsChanged) {
        errors.push('NO_CHANGES: The mutation produced no changes to any code file.');
    }

    // 2. Syntax checks
    if (htmlChanged) {
        const htmlErrors = checkHTMLSyntax(mutatedCode.html);
        errors.push(...htmlErrors);
    }

    if (cssChanged) {
        const cssErrors = checkCSSSyntax(mutatedCode.css);
        errors.push(...cssErrors);
    }

    // 3. Property-specific validation
    if (intent.property && intent.value) {
        const propertyApplied = checkPropertyApplied(intent, originalCode, mutatedCode);
        if (!propertyApplied) {
            errors.push(`PROPERTY_NOT_APPLIED: Expected "${intent.property}: ${intent.value}" but the change was not detected in the output.`);
        }
    }

    // 4. Check for anti-patterns (hacky CSS)
    if (cssChanged) {
        const antiPatterns = checkAntiPatterns(mutatedCode.css);
        if (antiPatterns.length > 0) {
            // These are warnings, not hard failures
            console.warn('⚠️ CSS anti-patterns detected:', antiPatterns);
        }
    }

    // 5. Check for code truncation (incomplete output)
    if (htmlChanged && isTruncated(mutatedCode.html)) {
        errors.push('TRUNCATED_HTML: The HTML output appears to be truncated (unclosed tags detected).');
    }

    const valid = errors.length === 0;
    const feedbackPrompt = valid ? null : buildFeedbackPrompt(intent, errors, originalCode, mutatedCode);

    console.log(`${valid ? '✅' : '❌'} Validation: ${valid ? 'PASSED' : `FAILED (${errors.length} errors)`}`);
    if (!valid) {
        errors.forEach(e => console.log(`   - ${e}`));
    }

    return { valid, errors, feedbackPrompt };
}

// ========== Validation Checks ==========

function checkHTMLSyntax(html) {
    const errors = [];

    if (!html || html.trim().length === 0) {
        errors.push('EMPTY_HTML: HTML output is empty.');
        return errors;
    }

    // Check for unclosed tags (basic)
    const openTags = [];
    const selfClosingTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

    const tagRegex = /<\/?(\w+)[^>]*\/?>/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
        const fullMatch = match[0];
        const tagName = match[1].toLowerCase();

        if (selfClosingTags.has(tagName) || fullMatch.endsWith('/>')) continue;

        if (fullMatch.startsWith('</')) {
            const lastOpen = openTags.pop();
            if (lastOpen && lastOpen !== tagName) {
                errors.push(`MISMATCHED_TAG: Expected closing tag for <${lastOpen}>, found </${tagName}>.`);
                openTags.push(lastOpen); // Put it back, the close might be for something else
            }
        } else {
            openTags.push(tagName);
        }
    }

    // Allow some unclosed tags (HTML is forgiving) but flag many
    if (openTags.length > 3) {
        errors.push(`UNCLOSED_TAGS: ${openTags.length} unclosed tags detected: ${openTags.slice(0, 5).join(', ')}...`);
    }

    return errors;
}

function checkCSSSyntax(css) {
    const errors = [];

    if (!css || css.trim().length === 0) return errors;

    // Check balanced braces
    const openBraces = (css.match(/\{/g) || []).length;
    const closeBraces = (css.match(/\}/g) || []).length;

    if (openBraces !== closeBraces) {
        errors.push(`UNBALANCED_CSS: CSS has ${openBraces} opening braces and ${closeBraces} closing braces.`);
    }

    return errors;
}

function checkPropertyApplied(intent, originalCode, mutatedCode) {
    const property = intent.property?.toLowerCase();
    const value = intent.value?.toLowerCase();

    if (!property) return true; // Can't check without a property

    // Check if the property appears in the CSS
    const css = mutatedCode.css || originalCode.css || '';

    // Look for the property in the CSS
    const propertyRegex = new RegExp(`${escapeRegex(property)}\\s*:`, 'i');
    if (propertyRegex.test(css)) {
        // If we also have a value, check that too
        if (value) {
            const valueRegex = new RegExp(`${escapeRegex(property)}\\s*:\\s*[^;]*${escapeRegex(value)}`, 'i');
            return valueRegex.test(css);
        }
        return true;
    }

    // Also check HTML for inline styles or attribute changes
    const html = mutatedCode.html || originalCode.html || '';
    if (html.includes(property) || (value && html.includes(value))) {
        return true;
    }

    return false;
}

function checkAntiPatterns(css) {
    const patterns = [];

    // Negative margins (often a hack)
    if (/margin[^:]*:\s*-\d/i.test(css)) {
        patterns.push('NEGATIVE_MARGIN: Consider using proper layout (Flexbox/Grid) instead of negative margins.');
    }

    // Excessive !important
    const importantCount = (css.match(/!important/gi) || []).length;
    if (importantCount > 3) {
        patterns.push(`EXCESSIVE_IMPORTANT: ${importantCount} uses of !important detected. This can cause specificity wars.`);
    }

    // Fixed pixel widths that might break responsiveness
    if (/width\s*:\s*\d{4,}px/i.test(css)) {
        patterns.push('LARGE_FIXED_WIDTH: Very large fixed pixel width detected. Consider using max-width or responsive units.');
    }

    return patterns;
}

function isTruncated(html) {
    // Simple heuristic: check if HTML ends abruptly
    const trimmed = html.trim();
    if (trimmed.endsWith('...') || trimmed.endsWith('…')) return true;

    // Check if the last tag is an opening tag (not closed)
    const lastTagMatch = /<(\w+)[^>]*>$/.exec(trimmed);
    if (lastTagMatch) {
        const tag = lastTagMatch[1].toLowerCase();
        const selfClosing = ['br', 'hr', 'img', 'input', 'meta', 'link'];
        if (!selfClosing.includes(tag)) {
            // Check if there's a matching close tag
            const closeRegex = new RegExp(`</${tag}>`, 'i');
            if (!closeRegex.test(html)) return true;
        }
    }

    return false;
}

// ========== Feedback Builder ==========

function buildFeedbackPrompt(intent, errors, originalCode, mutatedCode) {
    let feedback = `The previous code generation attempt had the following issues:\n\n`;

    errors.forEach((error, i) => {
        feedback += `${i + 1}. ${error}\n`;
    });

    feedback += `\nOriginal user request: "${intent.normalizedMessage || intent.action}"`;
    feedback += `\nTarget: ${intent.targetHint || 'unspecified'}`;

    if (intent.property) {
        feedback += `\nExpected change: ${intent.property}${intent.value ? ` to "${intent.value}"` : ''}`;
    }

    feedback += `\n\nPlease fix these issues and regenerate the code. Ensure the requested change is clearly visible in the output.`;

    return feedback;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

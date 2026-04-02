/**
 * Shared utility to parse a full HTML string into separate parts: HTML body, CSS styles, and JS scripts.
 * Used by CodeEditor paste import and Modernize Web result handling.
 */
export function parseFullCode(fullCode) {
    if (!fullCode) return { html: '', css: '', js: '' };
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(fullCode, 'text/html');

        // 1. Extract styles
        const styles = Array.from(doc.querySelectorAll('style'))
            .map(s => s.innerHTML)
            .join('\n\n');

        // 2. Extract scripts
        const scripts = Array.from(doc.querySelectorAll('script'))
            .map(s => s.innerHTML)
            .join('\n\n');

        // 3. Extract body content, removing style/script tags
        const bodyClone = doc.body.cloneNode(true);
        const bodyScripts = bodyClone.querySelectorAll('script');
        bodyScripts.forEach(s => s.remove());
        const bodyStyles = bodyClone.querySelectorAll('style');
        bodyStyles.forEach(s => s.remove());

        let bodyContent = bodyClone.innerHTML;
        // Basic cleanup of excessive whitespace
        bodyContent = bodyContent.replace(/^\s*\n/gm, '').trim();

        return {
            html: bodyContent,
            css: styles.trim(),
            js: scripts.trim()
        };
    } catch (e) {
        console.error('Error parsing full code:', e);
        // Fallback: return everything as HTML if parsing fails
        return { html: fullCode, css: '', js: '' };
    }
}

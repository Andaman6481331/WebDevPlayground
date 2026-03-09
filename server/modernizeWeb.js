// ============================================================
//  MODERNIZE WEBSITE  —  Drop this block into your server/index.js
//  Dependencies: npm install puppeteer-core @sparticuz/chromium
//  (or just: npm install puppeteer   for local dev)
// ============================================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import chardet from 'chardet';

// ─── Scraper ────────────────────────────────────────────────
async function scrapeWebsiteForModernization(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const initialBuffer = response.data.slice(0, 10000).toString('ascii').toLowerCase();
        let charset = chardet.detect(response.data);
        
        if (charset === 'windows-1252' || charset === 'ISO-8859-1' || !charset) {
            if (initialBuffer.includes('windows-874')) charset = 'windows-874';
            else if (initialBuffer.includes('tis-620')) charset = 'tis-620';
        }

        let body;
        try {
            if (charset && iconv.encodingExists(charset)) {
                body = iconv.decode(response.data, charset);
            } else {
                body = response.data.toString('utf-8');
            }
        } catch (e) {
            body = response.data.toString('utf-8');
        }

        const $ = cheerio.load(body);
        
        // ── Helpers ──────────────────────────────────────────
        const unique = arr => [...new Map(arr.map(x => [JSON.stringify(x), x])).values()];

        const title = $('title').text().trim();
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const metaKeys = $('meta[name="keywords"]').attr('content') || '';
        
        const bodyBg = 'inherit';
        const bodyColor = 'inherit';
        
        const navLinks = unique(
            $('nav a, header a, [role="navigation"] a').map((i, el) => ({
                text: $(el).text().trim().slice(0, 400),
                href: $(el).attr('href') || ''
            })).get().filter(l => l.text && l.text.length < 60)
        );

        const headings = $('h1, h2, h3').map((i, el) => ({
            tag: el.name.toUpperCase(),
            text: $(el).text().trim().slice(0, 400)
        })).get().filter(h => h.text).slice(0, 20);

        const paragraphs = $('p, li, td, th').map((i, el) => $(el).text().trim().slice(0, 400))
            .get().filter(t => t.length > 30 && t.length < 500).slice(0, 30);

        const images = unique(
            $('img').map((i, el) => ({
                src: $(el).attr('src') || $(el).attr('data-src') || '',
                alt: $(el).attr('alt') || '',
                width: 100 // Hardcoded since cheerio can't easily get natural width without downloading image
            })).get().filter(img => img.src && !img.src.startsWith('data:'))
        ).map(img => {
            try {
                img.src = img.src.startsWith('http') ? img.src : new URL(img.src, url).href;
            } catch (e) {}
            return img;
        }).slice(0, 20);

        const allLinks = unique(
            $('a').map((i, el) => ({
                text: $(el).text().trim().slice(0, 400),
                href: $(el).attr('href') || ''
            })).get().filter(l => l.text && l.text.length < 80 && l.href && !l.href.startsWith('javascript'))
        ).slice(0, 80);

        const forms = $('form').map((i, el) => ({
            action: $(el).attr('action') || '',
            inputs: $(el).find('input, textarea, select').map((j, input) => ({
                type: $(input).attr('type') || input.name,
                name: $(input).attr('name') || '',
                placeholder: $(input).attr('placeholder') || ''
            })).get()
        })).get();

        const rawHtml = $('body').html()?.slice(0, 60000) || '';

        const scraped = {
            title, metaDesc, metaKeys,
            bodyBg, bodyColor,
            navLinks, headings, paragraphs,
            images, allLinks, forms,
            rawHtml
        };

        return { ...scraped, url, screenshotBase64: null };
    } catch (err) {
        console.error("❌ Scrape failed:", err.message);
        throw err;
    }
}

// ─── Format scraped data → structured prompt context ────────
function formatScrapedForPrompt(scraped) {
    const nav = scraped.navLinks.map(l => `  • ${l.text}${l.href ? ` → ${l.href}` : ''}`).join('\n');
    const headings = scraped.headings.map(h => `  [${h.tag}] ${h.text}`).join('\n');
    const paragraphs = scraped.paragraphs.map(p => `  - ${p}`).join('\n');
    const images = scraped.images.map(i => `  [IMG] src="${i.src}" alt="${i.alt}"`).join('\n');
    const links = scraped.allLinks.map(l => `  • "${l.text}" → ${l.href}`).join('\n');

    return `
URL: ${scraped.url}
TITLE: ${scraped.title}
META DESCRIPTION: ${scraped.metaDesc || 'none'}
PAGE BACKGROUND COLOR: ${scraped.bodyBg}
PAGE TEXT COLOR: ${scraped.bodyColor}

── NAVIGATION LINKS ──────────────────────────────────
${nav || '  (none found)'}

── HEADINGS ──────────────────────────────────────────
${headings || '  (none found)'}

── BODY TEXT / KEY PARAGRAPHS ────────────────────────
${paragraphs || '  (none found)'}

── IMAGES ────────────────────────────────────────────
${images || '  (none found)'}

── ALL PAGE LINKS (categories, products, sections) ───
${links || '  (none found)'}

── RAW HTML (first 60k chars) ────────────────────────
${scraped.rawHtml}
`.trim();
}

// ─── The 6-step modernisation system prompt ─────────────────
const MODERNIZE_SYSTEM_PROMPT = `You are a senior front-end architect and UI designer.
You will receive the full scraped content of an old website and produce a single, modern, 
self-contained HTML file that completely reimagines its design while preserving all real content.

Follow these six steps mentally before writing any code:

STEP 1 — AUDIT
Read all provided content. Identify every content zone:
navigation, hero, product/service listings, announcements, 
shipping/policy info, utility links, contact, footer.
Note what is duplicated or redundant.

STEP 2 — CLASSIFY
Classify each zone into one of three roles:
- NAVIGATION → belongs in top nav or sticky sidebar filter
- DISCOVERY → belongs in main body (cards, grids, hero, sections)
- REFERENCE → belongs in footer or info-blocks section

STEP 3 — PLAN THE PAGE (top to bottom)
1. Announcement strip (if there are notices/alerts)
2. Sticky top nav — logo + nav links + search + cart/CTA
3. Hero banner — full-width, headline + subtext + CTA buttons
4. Trust / info bar — 3–5 icon+label highlights (shipping, policy, etc.)
5. Main 2-column layout:
   Left: Sticky filter sidebar (category chips, size swatches, price range)
   Right: Product/content area with sections (Browse by Category, Featured, New)
6. Info blocks — 4-col grid of key service/policy topics
7. Footer — brand col + 3 link cols + bottom bar
Adapt to the actual content — not every site is a shop.

STEP 4 — DESIGN RULES
- Single self-contained .html file. All CSS in <style>, no frameworks.
- CSS custom properties for ALL colours and fonts.
- Import exactly 2 Google Fonts: one display/serif for headings, one sans for body.
- Avoid: Arial, Roboto, Inter, system-ui. Use characterful fonts.
- CSS Grid for layouts, Flexbox for nav/bars.
- Sidebar hidden on mobile, grids collapse to 1-2 cols.
- Card hover: transform: translateY(-2px) + box-shadow lift.
- Sticky nav with scroll-triggered background opacity (JS).
- Colour palette: derive from the site's niche and mood.
  Define: --primary, --primary-light, --primary-dark, --bg, --bg-alt, --text, --text-muted, --border.
- Real image URLs from the scraped data must appear as <img src="exact_url"> tags.
- Real nav links and text must be used as-is — no invented content.

STEP 5 — CONSOLIDATE
- If the same info appears multiple times, keep it once in its best location.
- Merge all notices into one announcement strip.
- Category lists with 15+ items: group into parent cards, use filters for sub-variants.
- Utility links: info blocks + footer only.

STEP 6 — OUTPUT FORMAT
Respond ONLY using these XML tags. No text outside them:
<ANALYSIS>
One short paragraph describing what the site does, its audience, 
and the 3 main layout decisions you made.
</ANALYSIS>
<HTML>
Complete, valid HTML file from <!DOCTYPE html> to </html>.
Includes all <style> and <script> inline.
All real content from the source embedded.
</HTML>
<CHANGES>
Bullet list of every structural change made vs the original.
</CHANGES>`;

// ─── API Route ───────────────────────────────────────────────
export default function setupModernizeWeb(app, anthropic, modelMap) {
    app.post('/api/modernize-website', async (req, res) => {
    const { url, model } = req.body;

    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'A valid URL is required.' });
    }

    console.log(`\n🔍 Modernize request: ${url}`);

    // ── 1. Scrape ──────────────────────────────────────────────
    let scraped;
    try {
        console.log('🕷️  Scraping website...');
        scraped = await scrapeWebsiteForModernization(url);
        console.log(`✅ Scraped: ${scraped.navLinks.length} nav links, ${scraped.images.length} images, ${scraped.headings.length} headings`);
    } catch (err) {
        console.error('❌ Scrape failed:', err.message);
        return res.status(500).json({ error: 'Failed to scrape website.', details: err.message });
    }

    const promptContent = formatScrapedForPrompt(scraped);

    // ── 2. Build messages (with optional screenshot) ──────────
    const userMessageContent = [];

    // Attach screenshot for visual context if available
    if (scraped.screenshotBase64) {
        userMessageContent.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/png',
                data: scraped.screenshotBase64
            }
        });
    }

    userMessageContent.push({
        type: 'text',
        text: `Here is the complete scraped content of the website to modernize:\n\n${promptContent}\n\nApply all 6 steps and produce the modernized HTML.`
    });

    // ── 3. Call Claude ─────────────────────────────────────────
    let aiResponse;
    try {
        console.log('🧠 Calling Claude...');
        const selectedModel = (model && modelMap[model]) || 'claude-sonnet-4-6';

        aiResponse = await anthropic.messages.create({
            model: selectedModel,
            max_tokens: 32000,
            temperature: 1,  // Claude 4 models require temperature=1 for extended thinking;
            // set to 0 if you don't want thinking mode
            system: MODERNIZE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessageContent }]
        });

        if (aiResponse.stop_reason === 'max_tokens') {
            console.warn('⚠️  Response truncated at max_tokens');
        }

        console.log(`✅ Claude responded: ${aiResponse.usage.output_tokens} output tokens`);
    } catch (err) {
        console.error('❌ Claude API error:', err.message);
        return res.status(500).json({ error: 'AI generation failed.', details: err.message });
    }

    // ── 4. Parse response ──────────────────────────────────────
    const responseText = aiResponse.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

    const extract = (tag) => {
        const open = `<${tag}>`;
        const close = `</${tag}>`;
        const start = responseText.indexOf(open);
        if (start === -1) return null;
        const end = responseText.indexOf(close, start);
        return end === -1
            ? responseText.slice(start + open.length).trim()   // truncation fallback
            : responseText.slice(start + open.length, end).trim();
    };

    const html = extract('HTML');
    const analysis = extract('ANALYSIS');
    const changes = extract('CHANGES');

    if (!html) {
        console.error('❌ Could not extract <HTML> tag from response');
        console.error('Raw response start:', responseText.slice(0, 500));
        return res.status(500).json({
            error: 'AI response missing HTML block.',
            rawPreview: responseText.slice(0, 1000)
        });
    }

    // ── 5. Return ─────────────────────────────────────────────
    res.json({
        url,
        analysis: analysis || '',
        changes: changes
            ? changes.split('\n').filter(l => l.trim()).map(l => l.replace(/^[-•*]\s*/, ''))
            : [],
        html,
        usage: aiResponse.usage,
        truncated: aiResponse.stop_reason === 'max_tokens'
    });
});
}
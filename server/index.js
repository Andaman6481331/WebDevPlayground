import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import puppeteer from 'puppeteer';
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { processAdaptiveRequest } from './services/claudeService.js';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Initialize Anthropic client
// Defaults to process.env.ANTHROPIC_API_KEY
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ⭐ Initialize state stores
const conversations = new Map();
const conversationStates = new Map();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files from the src directory
app.use(express.static(path.join(__dirname, '../src')));

// Serve screenshots publicly
const screenshotsDir = path.join(process.cwd(), 'public', 'screenshots');
if (!fs.existsSync(path.join(process.cwd(), 'public'))) fs.mkdirSync(path.join(process.cwd(), 'public'));
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
app.use('/screenshots', express.static(screenshotsDir));

// ⭐ Intent Detection Endpoint (Cheap & Fast)
app.post("/api/intent", async (req, res) => {
  try {
    const { message } = req.body;
    console.log(`🔍 Intent Check: "${message.substring(0, 50)}..."`);

    const prompt = `Analyze this user request and determine which code files are needed to fulfill it. 
    Respond ONLY with a JSON object: {"intent": {"html": boolean, "css": boolean, "js": boolean}}
    
    Request: "${message}"`;

    const msg = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 100,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    });

    let responseText = msg.content[0].text;
    const startIndex = responseText.indexOf('{');
    const endIndex = responseText.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1) {
      const intent = JSON.parse(responseText.substring(startIndex, endIndex + 1));
      res.json(intent);
    } else {
      res.json({ intent: { html: true, css: true, js: true } });
    }
  } catch (err) {
    console.warn("⚠️ Intent Detection error:", err.message);
    res.json({ intent: { html: true, css: true, js: true } });
  }
});

const SYSTEM_PROMPT = `You are a web development assistant. 

CRITICAL JSON FORMATTING RULES:
1. You MUST respond with ONLY valid JSON
2. You MUST find all the color Hex in the code. Prepare to use them when user ask for color
3. Use proper JSON escaping for special characters:
   - Newlines must be \\n (not literal newlines)
   - Quotes must be \\"
   - Backslashes must be \\\\
4. The class name of the element must contain timestamp to prevent same class name collision on css
5. if the source code contain any image, you must remember the alt text of the image as the image name, then if user want to use the image, you must use the image alt text as the image name
6. Format:
{
  "message": "First, describe the layout or image you see (if provided). Then describe your changes.",
  "html": "HTML content. Typically internal elements only, but can include <style> or multiple <script> tags if creating a standalone/complex component.",
  "css": "Complete CSS code with proper escaping",
  "javascript": "Complete JavaScript code with proper escaping. If multiple scripts are needed, you can also place them in the 'html' field."
}

CRITICAL JAVASCRIPT SAFETY RULES:
1. ALWAYS check if elements exist before adding event listeners or manipulating them
2. Use null checks for ALL DOM queries: if (element) { ... }
3. Each component MUST be self-contained - do NOT reference elements from other components
4. Example of safe code:
   const loginBtn = document.querySelector('.nav-login-btn');
   if (loginBtn) {
     loginBtn.addEventListener('click', function() { ... });
   }
5. NEVER assume external elements exist - wrap all DOM manipulations in existence checks
6. If creating a component that depends on other elements (like modals needing trigger buttons), either:
   - Include ALL required elements in the HTML, OR
   - Add clear comments explaining dependencies, OR
   - Make the component work standalone with fallback behavior

- HTML: RETURN THE BODY CONTENT. Do NOT return \`<!DOCTYPE html>\`, \`<html>\`, or \`<head>\` tags.
- CSS: Do NOT include \`script\` or \`link\` tags in the CSS field.
- FULL CODE RULE: If you make ANY change to a field (html, css, or js), you MUST return the COMPLETE and FULL content for that field. Do NOT return snippets or comments like "... existing code ...".
- OPTIMIZATION RULE: If a field requires NO changes at all, you MUST return \`null\` for that field to save tokens.
- COORDINATED UPDATES: If you change a class name or ID in one file (e.g. CSS), you MUST also return the other file (e.g. HTML) with the corresponding update, even if no other changes were made to it.
- html SHOULD start with a semantic container (div, section, main, etc.) that uses a unique classname contains timestamp if it's a new component.
- PRESERVE existing structures: If the user has a <section> or <picture> tag as the outer structure, DO NOT wrap it in an extra <div> unless requested.
- if the source code already contain any universal classname, do not change or remove it
- Code Preservation: When updating existing code, try to keep the original structure, classes, and patterns (like responsive <picture> sources) as much as possible.
`
  // Example of proper escaping:
  // {
  //   "html": "<div class=\"container-1703123456791\">\n  <h1>Title</h1>\\n</div>",
  //   "css": ".container-1703123456791 {\\n  display: flex;\\n}"
  // }`
  ;
// Map frontend model names to Anthropic model IDs
const modelMap = {
  'sonnet': "claude-sonnet-4-5-20250929",
  'haiku': "claude-haiku-4-5-20251001",
  'opus': "claude-opus-4-5-20251101"
};

// ========== ADAPTIVE PIPELINE ENDPOINT ==========
app.post("/api/adaptive-chat", async (req, res) => {
  try {
    const { message, html, css, javascript, image, conversationId, model } = req.body;

    console.log(`\n🧠 Adaptive Request: conversationId=${conversationId}, model=${model}`);

    // Default to Sonnet for adaptive pipeline if not specified, 
    // but the pipeline might choose lighter models for simple tasks
    const selectedModel = modelMap[model] || "claude-sonnet-4-5-20250929";

    // Get or initialize conversation state
    let currentCode = conversationStates.get(conversationId) || { html: '', css: '', javascript: '' };
    if (html !== undefined) currentCode.html = html;
    if (css !== undefined) currentCode.css = css;
    if (javascript !== undefined) currentCode.javascript = javascript;
    conversationStates.set(conversationId, currentCode);

    // Get or initialize conversation messages
    let conversationData = conversations.get(conversationId);
    if (!conversationData) {
      conversationData = { messages: [], timestamp: Date.now() };
      conversations.set(conversationId, conversationData);
    }
    conversationData.timestamp = Date.now();

    // Run the adaptive pipeline
    const result = await processAdaptiveRequest(anthropic, message, currentCode, { image, model: selectedModel });

    // Update state with result
    const newCode = {
      html: (result.html !== null && result.html !== undefined) ? result.html : currentCode.html,
      css: (result.css !== null && result.css !== undefined) ? result.css : currentCode.css,
      javascript: (result.javascript !== null && result.javascript !== undefined) ? result.javascript : currentCode.javascript
    };
    conversationStates.set(conversationId, newCode);

    // Store in conversation history
    conversationData.messages.push(
      { role: "user", content: [{ type: "text", text: message }] },
      { role: "assistant", content: [{ type: "text", text: result.message }] }
    );

    console.log(`💾 Adaptive Result: HTML(${newCode.html.length}), CSS(${newCode.css.length}), JS(${newCode.javascript.length})`);

    res.json(result);
  } catch (err) {
    console.error("❌ Error in /api/adaptive-chat:", err);
    res.status(500).json({ error: "Failed to process adaptive request" });
  }
});

// Robust JSON Extraction
const cleanJSON = (text) => {
  let cleaned = text.trim();

  // 1. Remove markdown code blocks if present
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(cleaned);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // 2. If it still doesn't look like JSON, try to find the first '{' and last '}'
  if (!cleaned.startsWith('{')) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  }

  return cleaned;
};

app.post("/api/chat", async (req, res) => {
  try {
    const { message, html, css, javascript, image, model, conversationId, intent } = req.body;

    console.log(`\n📝 Request: conversationId=${conversationId}, intent=${JSON.stringify(intent)}`);

    const selectedModel = modelMap[model] || 'claude-3-haiku-20240307';

    // Get or initialize conversation
    let conversationData = conversations.get(conversationId);
    if (!conversationData) {
      conversationData = { messages: [], timestamp: Date.now() };
      conversations.set(conversationId, conversationData);
    }
    conversationData.timestamp = Date.now();
    let conversationMessages = conversationData.messages;

    // Get current state
    let currentCode = conversationStates.get(conversationId) || { html: '', css: '', javascript: '' };

    // Update state based on what arrived (Selective Sync)
    if (html !== undefined) currentCode.html = html;
    if (css !== undefined) currentCode.css = css;
    if (javascript !== undefined) currentCode.javascript = javascript;
    conversationStates.set(conversationId, currentCode);

    // Build user message content
    const userContent = [];
    if (image) {
      const base64Image = image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      const mediaType = image.match(/^data:image\/(png|jpeg|webp);base64,/)?.[1] || "jpeg";
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: `image/${mediaType}`, data: base64Image }
      });
    }

    // Add context if requested by intent OR if it's the first message
    const isFirstMessage = conversationMessages.length === 0;
    const needsCode = intent ? (intent.html || intent.css || intent.js) : true;

    if (isFirstMessage || needsCode) {
      let codePrompt = 'CURRENT CODE STATE:\n';
      if (isFirstMessage || (intent && intent.html)) codePrompt += `HTML:\n${currentCode.html}\n\n`;
      if (isFirstMessage || (intent && intent.css)) codePrompt += `CSS:\n${currentCode.css}\n\n`;
      if (isFirstMessage || (intent && intent.js)) codePrompt += `JavaScript:\n${currentCode.javascript}`;

      userContent.push({ type: "text", text: codePrompt });
    }

    userContent.push({
      type: "text",
      text: `User Request: ${message || "Update the code."}\n\nPlease generate the updated full HTML, CSS, and JS code based on the intent.`
    });

    conversationMessages.push({ role: "user", content: userContent });

    // ⭐ Sliding Window: Last 10 messages
    const HISTORY_LIMIT = 10;
    const windowedMessages = conversationMessages.slice(-HISTORY_LIMIT);

    // Prepare API call (with caching on the latest code block)
    const messagesForApi = windowedMessages.map((msg, idx) => {
      const content = msg.content.map(block => ({ ...block }));
      // Cache the last user message if it's long (e.g. contains code)
      if (idx === windowedMessages.length - 1 && msg.role === 'user') {
        const codeBlock = content.find(b => b.text && b.text.includes("CURRENT CODE STATE:"));
        if (codeBlock) codeBlock.cache_control = { type: "ephemeral" };
      }
      return { role: msg.role, content };
    });

    console.log(`📤 Sending to ${model === 'gemini' ? 'Gemini' : 'Claude'} (${model === 'gemini' ? 'gemini-2.0-flash' : selectedModel}), window: ${windowedMessages.length}`);

    let responseText = "";
    let usage = {};

    if (model === 'gemini') {
      const geminiModel = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: SYSTEM_PROMPT
      });

      // Convert Anthropic format to Gemini format
      const history = windowedMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n') }]
      }));

      // Current message parts
      const currentParts = [];
      const userMsg = windowedMessages[windowedMessages.length - 1];
      if (image) {
        const base64Image = image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
        const mediaType = image.match(/^data:image\/(png|jpeg|webp);base64,/)?.[1] || "jpeg";
        currentParts.push({
          inlineData: { data: base64Image, mimeType: `image/${mediaType}` }
        });
      }

      const textContent = Array.isArray(userMsg.content)
        ? userMsg.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        : userMsg.content;
      currentParts.push({ text: textContent });

      const chatSession = geminiModel.startChat({ history });
      const result = await chatSession.sendMessage(currentParts);
      responseText = result.response.text();

      usage = {
        input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
        output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0
      };

      // Add response to history in Anthropic-compatible format for future turns
      conversationMessages.push({
        role: "assistant",
        content: [{ type: "text", text: responseText }]
      });
    } else {
      const msg = await anthropic.messages.create({
        model: selectedModel,
        max_tokens: 16000,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: messagesForApi,
      });

      responseText = msg.content[0].text;
      usage = msg.usage;

      // Add response to history
      conversationMessages.push({ role: "assistant", content: msg.content });
    }

    // Debug: Log first 100 chars of AI response
    console.log(`🤖 AI Response (raw start): ${responseText.substring(0, 100)}...`);

    let parsedResponse;
    const extractedText = cleanJSON(responseText);

    try {
      parsedResponse = JSON.parse(extractedText);
    } catch (parseError) {
      console.warn("⚠️ JSON Parse Error, attempting manual extraction:", parseError.message);

      // Fallback: Regex extraction for html, css, and javascript fields
      const extractField = (field) => {
        const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,|"\\s*})`, 'g');
        const match = regex.exec(extractedText);
        return match ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
      };

      const messageMatch = /"message"\s*:\s*"([\s\S]*?)(?="\s*,|"\s*})/.exec(extractedText);

      parsedResponse = {
        message: messageMatch ? messageMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : "I've processed your request, but I had trouble formatting the response.",
        html: extractField('html'),
        css: extractField('css'),
        javascript: extractField('javascript') || extractField('js')
      };

      // If we couldn't even extract the message, then it's a total failure
      if (!parsedResponse.html && !parsedResponse.css && !parsedResponse.javascript) {
        throw parseError; // Re-throw if nothing was found
      }
      console.log("✅ Successfully extracted partial data from malformed JSON");
    }

    // Normalize and update state
    // If AI explicitly returned a field (even if it's an empty string), use it.
    // Otherwise fallback to what we already have in state.
    const newCode = {
      html: (parsedResponse.html !== undefined && parsedResponse.html !== null) ? parsedResponse.html : currentCode.html,
      css: (parsedResponse.css !== undefined && parsedResponse.css !== null) ? parsedResponse.css : currentCode.css,
      javascript: (parsedResponse.javascript !== undefined && parsedResponse.javascript !== null) ? parsedResponse.javascript :
        (parsedResponse.js !== undefined && parsedResponse.js !== null) ? parsedResponse.js : currentCode.javascript
    };

    console.log(`💾 Updated State: HTML(${newCode.html.length}), CSS(${newCode.css.length}), JS(${newCode.javascript.length})`);

    conversationStates.set(conversationId, newCode);
    parsedResponse.usage = usage;

    res.json(parsedResponse);
  } catch (err) {
    console.error("❌ Error in /api/chat:", err);
    res.status(500).json({ error: "Failed to process request with Claude API" });
  }
});

const RESPONSIVE_SYSTEM_PROMPT = `You are a frontend CSS modification agent.

The existing website is desktop-only and must remain visually identical on desktop resolutions.

The user has selected {COMPACT | COMFORTABLE | SPACIOUS} Mobile Mode.

Your task:

1. Convert ALL existing class names into a timestamp-based namespace system.
   - Every class must follow this format:
     .originalName-{{TIMESTAMP}}
   - Example:
     .box → .box-{{TIMESTAMP}}
   - The timestamp must be consistent across the entire response.
   - Use the provided timestamp: {{TIMESTAMP}}

2. Update BOTH HTML and CSS so that:
   - Every renamed class in CSS is also updated in HTML.
   - No old class names remain.
   - No duplicate selectors exist.

3. After converting to timestamp namespace, add mobile and tablet responsiveness ONLY.

4. Use CSS @media (max-width: 1024px) exclusively for responsiveness.

5. Desktop layout, spacing, and visual appearance MUST remain pixel-identical.
   - Do not redesign layouts.
   - Do not change desktop spacing or typography.
   - Do not remove any existing rules.

6. Append responsive overrides below existing CSS.

7. Do not add JavaScript unless absolutely required.
   - If no JavaScript is needed, return null for the javascript field.

Allowed mobile changes inside @media:
- Adjust font sizes
- Adjust padding and margins
- Stack elements vertically
- Hide non-essential sidebars or secondary navigation

STRICT NAMESPACE RULE:
- ALL class names must use the timestamp format.
- No original class names may remain.
- IDs must remain unchanged unless explicitly required.
- Do not rename universal or system-reserved classes (e.g., third-party libraries).
- If a class belongs to an external framework, leave it unchanged.

CRITICAL JSON FORMATTING RULES:

1. You MUST respond with ONLY valid JSON.
2. Use proper JSON escaping:
   - Newlines must be \\n
   - Quotes must be \\"
   - Backslashes must be \\\\
3. The timestamp must be EXACTLY: {{TIMESTAMP}}
4. The same timestamp {{TIMESTAMP}} must be used everywhere in the response.

Format:
{
  "message": "First, describe the layout you received. Then describe the namespace conversion and responsive changes made.",
  "html": "FULL updated body content with all classes converted to timestamp format.",
  "css": "FULL updated CSS including original desktop rules (renamed) plus responsive @media overrides.",
  "javascript": null or "Complete JavaScript if required."
}

FULL CODE RULE:
- If you change HTML, return the COMPLETE HTML body.
- If you change CSS, return the COMPLETE CSS.
- Do NOT return snippets.
- Do NOT return comments like '...existing code...'.

COORDINATED UPDATE RULE:
- If a class is renamed in CSS, it MUST be renamed in HTML.
- No mismatch is allowed.

OPTIMIZATION RULE:
- If javascript is not required, return null.
`;
const responsiveModelMap = {
  compact: `
Apply Compact Mobile Mode.

Characteristics:
- Reduce font size slightly
- Reduce padding and margin spacing
- Increase content density
- Hide non-essential sidebars if present
- Maintain usability for touch
`,

  comfortable: `
Apply Comfortable Mobile Mode.

Characteristics:
- Balanced font sizing
- Moderate padding and margins
- Standard touch-friendly button height (~44px)
- Stack layouts vertically where needed
`,

  spacious: `
Apply Spacious (Accessible) Mobile Mode.

Characteristics:
- Increase font size
- Increase padding and margins
- Increase button height (~52px or more)
- Improve content separation for readability
`
};

app.post("/api/responsive", async (req, res) => {
  try {
    const { html, css, javascript, type, model, conversationId } = req.body;

    let currentCode = conversationStates.get(conversationId) || { html: '', css: '', javascript: '' };

    // Update state based on what arrived (Selective Sync)
    if (html !== undefined) currentCode.html = html;
    if (css !== undefined) currentCode.css = css;
    if (javascript !== undefined) currentCode.javascript = javascript;
    conversationStates.set(conversationId, currentCode);


    //AI Computation
    const modePrompt = responsiveModelMap[type];
    const selectedModel = modelMap[model] || 'claude-3-haiku-20240307';
    const maxTokens = selectedModel.includes('haiku') ? 4096 : 8000;

    // Generate current timestamp in yymmddhhmm format
    const now = new Date();
    const yymmddhhmm = now.getFullYear().toString().slice(-2) +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0');

    console.log(`📱 Responsive Request: model=${selectedModel}, type=${type}, timestamp=${yymmddhhmm}`);

    const systemPrompt = RESPONSIVE_SYSTEM_PROMPT.replaceAll('{{TIMESTAMP}}', yymmddhhmm);

    const response = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: maxTokens,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `${modePrompt}\n\n\nHTML: ${html}\nCSS: ${css}\nJS: ${javascript}`
        },
      ],
    });

    // Extract Claude's text response
    const content = response.content[0].text;
    const usage = response.usage;

    let parsedResponse;
    const extractedText = cleanJSON(content);

    try {
      parsedResponse = JSON.parse(extractedText);
    } catch (parseError) {
      console.warn("⚠️ JSON Parse Error, attempting manual extraction:", parseError.message);

      // Fallback: Regex extraction for html, css, and javascript fields
      const extractField = (field) => {
        const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,|"\\s*})`, 'g');
        const match = regex.exec(extractedText);
        return match ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
      };

      const messageMatch = /"message"\s*:\s*"([\s\S]*?)(?="\s*,|"\s*})/.exec(extractedText);

      parsedResponse = {
        message: messageMatch ? messageMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : "I've processed your request, but I had trouble formatting the response.",
        html: extractField('html'),
        css: extractField('css'),
        javascript: extractField('javascript') || extractField('js')
      };

      // If we couldn't even extract the message, then it's a total failure
      if (!parsedResponse.html && !parsedResponse.css && !parsedResponse.javascript) {
        throw parseError; // Re-throw if nothing was found
      }
      console.log("✅ Successfully extracted partial data from malformed JSON");
    }

    // Normalize and update state
    // If AI explicitly returned a field (even if it's an empty string), use it.
    // Otherwise fallback to what we already have in state.
    const newCode = {
      html: (parsedResponse.html !== undefined && parsedResponse.html !== null) ? parsedResponse.html : currentCode.html,
      css: (parsedResponse.css !== undefined && parsedResponse.css !== null) ? parsedResponse.css : currentCode.css,
      javascript: (parsedResponse.javascript !== undefined && parsedResponse.javascript !== null) ? parsedResponse.javascript :
        (parsedResponse.js !== undefined && parsedResponse.js !== null) ? parsedResponse.js : currentCode.javascript
    };

    console.log(`💾 Updated State: HTML(${newCode.html.length}), CSS(${newCode.css.length}), JS(${newCode.javascript.length})`);

    conversationStates.set(conversationId, newCode);
    parsedResponse.usage = usage;

    res.json(parsedResponse);
  } catch (err) {
    console.error("❌ Error in /api/responsive:", err);
    res.status(500).json({ error: "Failed to process responsive request" });
  }
});


app.post("/api/dissect-website", async (req, res) => {
  let browser;
  try {
    const { url } = req.body;

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2' });

    // 1. Take full-page screenshot
    const screenshot = await page.screenshot({
      fullPage: true,
      encoding: 'base64'
    });

    // 2. Get simplified DOM structure
    const domStructure = await page.evaluate(() => {
      function getSelector(element) {
        if (element.id) return `#${element.id}`;
        if (element.className) return `.${element.className.split(' ')[0]}`;
        return element.tagName.toLowerCase();
      }

      function analyzeElement(el, depth = 0) {
        if (depth > 5) return null; // Increased depth for better section identification

        const rect = el.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(el);

        return {
          tag: el.tagName.toLowerCase(),
          selector: getSelector(el),
          text: el.innerText?.substring(0, 100),
          bounds: {
            top: rect.top,
            height: rect.height,
            width: rect.width
          },
          style: {
            position: computedStyle.position,
            display: computedStyle.display,
            backgroundColor: computedStyle.backgroundColor
          },
          children: Array.from(el.children)
            .map(child => analyzeElement(child, depth + 1))
            .filter(Boolean)
        };
      }

      return analyzeElement(document.body);
    });

    // 3. Ask Claude to identify sections
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot
              }
            },
            {
              type: "text",
              text: `Analyze this website screenshot and identify the main sections.

DOM Structure:
${JSON.stringify(domStructure, null, 2)}

Return ONLY raw JSON (no markdown backticks) for a JSON array of sections with this exact structure:
{
  "sections": [
    {
      "name": "navbar|hero|features|testimonials|footer|etc",
      "description": "Brief description",
      "selector": "CSS selector to target this section",
      "bounds": {"top": 0, "height": 80}
    }
  ]
}

Important:
- Your response must be valid JSON and nothing else.
- Identify sections by visual appearance AND DOM structure
- Common sections: navbar, hero, features, about, testimonials, pricing, footer
- Provide accurate CSS selectors to extract each section
- Order sections from top to bottom`
            }
          ]
        }
      ]
    });

    const aiContent = aiResponse.content[0].text;
    // Strip markdown code blocks if present
    const cleanJson = aiContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const sections = JSON.parse(cleanJson).sections;

    // 4. Extract HTML/CSS for each identified section
    const rawSections = await Promise.all(
      sections.map(async (section) => {
        const sectionData = await page.evaluate((selector) => {
          const mainElement = document.querySelector(selector);
          if (!mainElement) return null;

          const interestingProps = [
            'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight',
            'padding', 'margin', 'display', 'flex-direction', 'justify-content', 'align-items',
            'gap', 'grid-template-columns', 'position', 'top', 'left', 'right', 'bottom',
            'width', 'height', 'max-width', 'border', 'border-radius', 'box-shadow', 'opacity', 'z-index',
            'text-align', 'flex-wrap', 'object-fit'
          ];

          function getStyles(el) {
            const styles = window.getComputedStyle(el);
            let css = '';
            interestingProps.forEach(prop => {
              const val = styles.getPropertyValue(prop);
              if (val && val !== 'normal' && val !== 'none' && val !== '0px' && val !== 'auto' && val !== 'rgba(0, 0, 0, 0)') {
                css += `${prop}: ${val}; `;
              }
            });
            return css;
          }

          // Recursively extract HTML and inline the CRITICAL computed styles
          function extractWithStyles(el) {
            if (el.nodeType !== 1) return el.textContent; // Text node

            const clone = el.cloneNode(false);
            const styles = getStyles(el);
            if (styles) clone.setAttribute('style', styles);

            Array.from(el.childNodes).forEach(child => {
              if (child.nodeType === 1 || child.nodeType === 3) {
                const processed = extractWithStyles(child);
                if (typeof processed === 'string') {
                  clone.appendChild(document.createTextNode(processed));
                } else {
                  clone.appendChild(processed);
                }
              }
            });

            return clone;
          }

          const styledElement = extractWithStyles(mainElement);
          const html = styledElement.outerHTML;

          // Return a simplified CSS block just for the container
          const containerCss = `${selector} { ${getStyles(mainElement)} }`;

          return { html, css: containerCss };
        }, section.selector);

        if (!sectionData) return null;

        return {
          ...section,
          ...sectionData
        };
      })
    );

    await browser.close();

    // 5. Modernize and Refactor each section using AI
    console.log(`✨ Modernizing ${rawSections.filter(Boolean).length} sections...`);

    const modernizedSections = await Promise.all(
      rawSections.filter(Boolean).map(async (section) => {
        try {
          const modernizationResponse = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 4000,
            temperature: 0,
            system: "You are a senior frontend engineer. Your task is to refactor raw, extracted website snippets into clean, modern, and standalone HTML/CSS components. Use semantic HTML and modern CSS (Flexbox/Grid). Remove site-specific junk attributes.",
            messages: [
              {
                role: "user",
                content: `Refactor and modernize this extracted component.
Section Type: ${section.name}
Description: ${section.description}

RAW HTML:
${section.html}

RAW COMPUTED CSS:
${section.css}

REQUIREMENTS:
1. Clean the HTML: Remove redundant classes (if they look like framework junk), data attributes, and unnecessary nesting.
2. Distill the CSS: Convert the verbose computed styles into clean, modular CSS. Use the provided styles as a reference to keep the look identical, but use cleaner selectors.
3. Standalone: Ensure all styles needed for this section are included.
4. Output: Return ONLY raw JSON with "html" and "css" fields.`
              }
            ]
          });

          const rawText = modernizationResponse.content[0].text;
          const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const refactored = JSON.parse(cleanText);

          return {
            ...section,
            html: refactored.html,
            css: refactored.css
          };
        } catch (e) {
          console.error(`Failed to modernize section ${section.name}:`, e);
          return section; // Fallback to raw if AI fails
        }
      })
    );

    res.json({
      url,
      sections: modernizedSections,
      message: `Modernized and extracted ${modernizedSections.length} sections`
    });

  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ Error dissecting website:", err);
    res.status(500).json({
      error: "Failed to dissect website",
      details: err.message
    });
  }
});

app.post("/api/screenshot-website-file", async (req, res) => {
  let browser;
  try {
    const { url } = req.body;

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Generate filename
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;

    const filepath = path.join(screenshotsDir, filename);

    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save screenshot to file
    await page.screenshot({
      path: filepath,
      fullPage: true
    });

    await browser.close();

    res.json({
      success: true,
      url: url,
      screenshotUrl: `/screenshots/${filename}`, // Public URL
      filepath: filepath,
      message: 'Screenshot saved successfully'
    });

  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
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
import * as cheerio from 'cheerio';
import axios from 'axios';
import iconv from 'iconv-lite';
import chardet from 'chardet';
import setupModernizeWeb from './modernizeWeb.js';

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
  'sonnet': 'claude-sonnet-4-6',
  'haiku': 'claude-haiku-4-5-20251001',
  'opus': 'claude-opus-4-6'
};

setupModernizeWeb(app, anthropic, modelMap);

// ========== ADAPTIVE PIPELINE ENDPOINT ==========
app.post("/api/adaptive-chat", async (req, res) => {
  try {
    const { message, html, css, javascript, image, conversationId, model } = req.body;

    console.log(`\n🧠 Adaptive Request: conversationId=${conversationId}, model=${model}`);

    // Default to Sonnet for adaptive pipeline if not specified, 
    // but the pipeline might choose lighter models for simple tasks
    const selectedModel = modelMap[model] || "claude-sonnet-4-6";

    // Get or initialize conversation state
    let currentCode = conversationStates.get(conversationId) || { html: '', css: '', javascript: '' };
    if (html !== undefined) currentCode.html = html || '';
    if (css !== undefined) currentCode.css = css || '';
    if (javascript !== undefined) currentCode.javascript = javascript || '';
    conversationStates.set(conversationId, currentCode);

    // Get or initialize conversation messages
    let conversationData = conversations.get(conversationId);
    if (!conversationData) {
      conversationData = { messages: [], timestamp: Date.now() };
      conversations.set(conversationId, conversationData);
    }
    conversationData.timestamp = Date.now();

    // Run the adaptive pipeline
    const result = await processAdaptiveRequest(anthropic, message, currentCode, {
      image,
      model: selectedModel,
      conversationMessages: conversationData.messages
    });

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

    console.log(`💾 Adaptive Result: HTML(${(newCode.html || '').length}), CSS(${(newCode.css || '').length}), JS(${(newCode.javascript || '').length})`);

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

  // 2. If it still doesn't look like JSON, try to find the first '{' 
  if (!cleaned.startsWith('{')) {
    const firstBrace = cleaned.indexOf('{');
    cleaned = cleaned.substring(firstBrace);
  }

  // 3. Robust Truncation Fix: If it doesn't end with '}', try to close it
  // This is a "hail mary" for truncated AI responses
  if (!cleaned.endsWith('}')) {
    console.warn("⚠️ AI response appears truncated. Attempting to force-close JSON.");

    // If it's cut off inside a string, we need to close the string first
    const openQuotes = (cleaned.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) cleaned += '"';

    // Add missing closing braces
    const openBraces = (cleaned.match(/\{/g) || []).length;
    const closeBraces = (cleaned.match(/\}/g) || []).length;
    for (let i = 0; i < (openBraces - closeBraces); i++) {
      cleaned += '}';
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
    if (html !== undefined) currentCode.html = html || '';
    if (css !== undefined) currentCode.css = css || '';
    if (javascript !== undefined) currentCode.javascript = javascript || '';
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

    console.log(`💾 Updated State: HTML(${(newCode.html || '').length}), CSS(${(newCode.css || '').length}), JS(${(newCode.javascript || '').length})`);

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
    if (html !== undefined) currentCode.html = html || '';
    if (css !== undefined) currentCode.css = css || '';
    if (javascript !== undefined) currentCode.javascript = javascript || '';
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

    console.log(`💾 Updated State: HTML(${(newCode.html || '').length}), CSS(${(newCode.css || '').length}), JS(${(newCode.javascript || '').length})`);

    conversationStates.set(conversationId, newCode);
    parsedResponse.usage = usage;

    res.json(parsedResponse);
  } catch (err) {
    console.error("❌ Error in /api/responsive:", err);
    res.status(500).json({ error: "Failed to process responsive request" });
  }
});


app.post("/api/fetch-website-content", async (req, res) => {
  try {
    const { url } = req.body;
    console.log(`🌐 Fetching website content: ${url}`);

    // Use arraybuffer to handle different encodings (like windows-874)
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      responseType: 'arraybuffer',
      timeout: 10000
    });

    // Detect encoding strategy:
    // 1. Check meta tags in the first few bytes of the buffer
    // 2. Check Content-Type header
    // 3. Fallback to chardet
    const initialBuffer = response.data.slice(0, 10000).toString('ascii');
    // More robust regex for meta tags
    let charsetMatch = initialBuffer.match(/charset=["']?([^"'; >]+)["']?/i);
    let charset = charsetMatch ? charsetMatch[1] : null;

    if (!charset) {
      const contentType = response.headers['content-type'] || '';
      charsetMatch = contentType.match(/charset=([^;]+)/i);
      charset = charsetMatch ? charsetMatch[1] : null;
    }

    if (!charset) {
      charset = chardet.detect(response.data);
    }

    // Special case for Thai: if charset is detected as Western but site is likely Thai
    if (charset === 'windows-1252' || charset === 'ISO-8859-1' || !charset) {
      if (initialBuffer.toLowerCase().includes('windows-874') || initialBuffer.toLowerCase().includes('tis-620')) {
        charset = initialBuffer.toLowerCase().includes('windows-874') ? 'windows-874' : 'tis-620';
        console.log(`💡 Overriding to Thai charset found in meta/text: ${charset}`);
      }
    }

    console.log(`🔤 Detected charset: ${charset}`);

    let body;
    try {
      if (charset && iconv.encodingExists(charset)) {
        body = iconv.decode(response.data, charset);
      } else {
        body = response.data.toString('utf-8');
      }
    } catch (e) {
      console.warn(`Charset decoding failed for ${charset}, falling back to utf-8`);
      body = response.data.toString('utf-8');
    }

    const $ = cheerio.load(body);

    // 1) Find <td class="side"> component (inside tr valign="top")
    const sideTd = $('tr[valign="top"] td.side');
    const navigation = [];

    // 2.1) For "side", go inside it and retrieve only the <td> that is inside <tbody>
    sideTd.find('tbody td').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Look for links or significant text inside these TDs
      const link = $el.find('a').first();
      if (text || link.length) {
        navigation.push({
          id: `nav-${i}`,
          text: text || link.text().trim() || 'Link',
          type: link.length ? 'link' : 'text',
          href: link.attr('href') || null,
          selected: true
        });
      }
    });

    // Fallback if no specific tbody/td found
    if (navigation.length === 0) {
      sideTd.find('a, p, span, div').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        if (text && $el.children().length === 0) {
          navigation.push({
            id: `nav-${i}`,
            text: text,
            type: el.name === 'a' ? 'link' : 'text',
            href: $el.attr('href') || null,
            selected: true
          });
        }
      });
    }

    // 2) Find content next to side component
    let mainArea = sideTd.next('td');
    if (mainArea.length === 0) {
      mainArea = sideTd.parent().find('td').eq(1);
    }

    const mainContent = [];

    // 2.2) Retreive only element that inside <td> that is specifially inside TWO <tbody>, 
    // find and retrieve elements (excluding <br>)
    mainArea.find('td').each((i, td) => {
      let tbodyCount = 0;
      let curr = $(td).parent();
      while (curr.length && !curr.is(mainArea)) {
        if (curr.get(0).tagName.toLowerCase() === 'tbody') {
          tbodyCount++;
        }
        curr = curr.parent();
      }

      if (tbodyCount >= 2) {
        $(td).contents().each((j, el) => {
          if (el.type === 'tag' && el.name !== 'br') {
            const $el = $(el);
            if (el.name === 'img') {
              let src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('original');
              const srcset = $el.attr('srcset');
              if (!src && srcset) src = srcset.split(',')[0].trim().split(' ')[0];

              if (src) {
                try {
                  src = src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, url).href;
                  mainContent.push({ id: `main-${i}-${j}`, type: 'image', src, alt: $el.attr('alt') || '', selected: true });
                } catch (e) { }
              }
            } else {
              const text = $el.text().trim();
              if (text && text.length > 2) {
                mainContent.push({ id: `main-${i}-${j}`, type: 'text', content: text, tag: el.name, selected: true });
              }
            }
          } else if (el.type === 'text') {
            const text = el.data.trim();
            if (text && text.length > 2) {
              mainContent.push({ id: `main-${i}-${j}`, type: 'text', content: text, tag: 'span', selected: true });
            }
          }
        });
      }
    });

    // Fallback if no nested table content found
    if (mainContent.length === 0) {
      let contentContainer = mainArea.find('#lazyimg');
      if (contentContainer.length === 0) {
        contentContainer = mainArea.hasClass('content') ? mainArea : mainArea.find('.content');
      }
      if (contentContainer.length === 0) contentContainer = mainArea;

      contentContainer.find('img, p, h1, h2, h3, h4, h5, h6, span, li, div').each((i, el) => {
        const $el = $(el);
        if (el.name === 'img') {
          let src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('original');
          if (src) {
            try {
              src = src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, url).href;
              mainContent.push({ id: `main-fb-${i}`, type: 'image', src, alt: $el.attr('alt') || '', selected: true });
            } catch (e) { }
          }
        } else {
          const text = $el.text().trim();
          if (text && text.length > 2 && $el.children('p, h1, h2, h3, h4, h5, h6, li, div, span').length === 0) {
            mainContent.push({ id: `main-fb-${i}`, type: 'text', content: text, tag: el.name, selected: true });
          }
        }
      });
    }

    const extractedData = {
      title: $('title').text().trim(),
      navigation: navigation.filter((v, i, a) => a.findIndex(t => (t.text === v.text && t.href === v.href)) === i),
      mainContent: mainContent.filter((v, i, a) => a.findIndex(t => (t.type === 'text' ? t.content === v.content : t.src === v.src)) === i)
    };

    res.json({ success: true, url, data: extractedData });
  } catch (err) {
    console.error("❌ Error fetching website:", err);
    res.status(500).json({ error: "Failed to fetch website content", details: err.message });
  }
});

app.post("/api/dissect-website", async (req, res) => {
  try {
    const { url, extractedData, primaryColor, secondaryColor, model } = req.body;

    if (!extractedData || (!extractedData.navigation && !extractedData.mainContent)) {
      return res.status(400).json({ error: "No selected content provided for dissection" });
    }

    console.log(`📝 Processing selected content from ${url}, sending to AI...`);

    // Format the items for the AI
    const navItemsList = (extractedData.navigation || []).filter(item => item.selected);
    const contentItemsList = (extractedData.mainContent || []).filter(item => item.selected);

    const navItems = navItemsList.map(item => `- ${item.text}${item.href ? ` (${item.href})` : ''}`).join('\n');
    const contentItems = contentItemsList.map(item => {
      if (item.type === 'image') {
        return `- [IMAGE] URL: ${item.src}${item.alt ? `, Alt: ${item.alt}` : ''}`;
      }
      return `- [TEXT] ${item.tag ? `<${item.tag}>` : ''}: ${item.content}`;
    }).join('\n');

    console.log(`✅ AI will receive ${navItemsList.length} nav items and ${contentItemsList.length} content items.`);
    console.log(`🎨 Theme Colors: Primary=${primaryColor}, Secondary=${secondaryColor}`);

    const safePrimary = primaryColor || '#3b82f6';
    const safeSecondary = secondaryColor || '#10b981';

    const aiResponse = await anthropic.messages.create({
      model: modelMap[model] || "claude-sonnet-4-6",
      max_tokens: 24000,
      temperature: 0,
      system: `You are an expert frontend designer reconstructing websites from extracted content.

DATA RULES:
- Use ONLY the data provided in the user message. No invented content.
- Every [IMAGE] URL must appear as an exact <img src="url"> tag. No placeholders or emojis.
- Every navigation link provided must appear in the menu.

COLOR RULES:
- Primary ${safePrimary} = main background (body, nav, hero, cards). Never default to black.
- Secondary ${safeSecondary} = buttons, links, accents only.
- Auto-select white or dark text based on primary color brightness.
- Use shades of primary for depth.

LAYOUT THINKING — before writing any code, mentally:
1. Classify each content item: is it navigation, hero/discovery, or reference?
   - Navigation → sticky top nav
   - First image + main headline → hero banner with overlay
   - Product/service items → card grid with hover effects
   - Policy/contact/FAQ text → info blocks or footer
2. Consolidate — if the same information appears twice, keep it once in its best location
3. Pick the layout pattern that fits the content type:
   - Products/portfolio → image card grid
   - Services → feature blocks with icons
   - Articles/blog → editorial list or masonry
   - Single landing page → hero → features → CTA → footer

DESIGN: Modern, premium, responsive. No border-radius.
Typography: pick Google Fonts suited to the site's niche.
Components: sticky nav, hero with overlay text, card hover lift effects, trust/info bar if relevant.

RESPOND ONLY in these XML tags — no text outside them:
<CSS>...</CSS>
<HTML>...</HTML>
<CHECKLIST>...</CHECKLIST>
<MESSAGE>...</MESSAGE>
<JAVASCRIPT>...</JAVASCRIPT>`,
      messages: [
        {
          role: "user",
          content: `Here is the ONLY data you are allowed to use for the website reconstruction:
          
          TITLE (Project Name): ${extractedData.title}
          
          SPECIFIC NAVIGATION LINKS (Strictly use these for your menu):
          ${navItems || 'None provided'}
          
          SPECIFIC MAIN CONTENT (Strictly use these for the page body — every image URL must be embedded as <img src="...">):
          ${contentItems || 'None provided'}
          
          Final Instruction: 
          - Do not add "sample" data or invent "demo" products.
          - Use the real URLs and real text provided above.
          - FOR IMAGES: Every [IMAGE] URL above MUST appear as <img src="that_exact_url"> in your HTML. No emojis or placeholders.
          - The background of the page MUST use PRIMARY COLOR ${safePrimary}. Do NOT default to black/dark.
          - Use SECONDARY COLOR ${safeSecondary} for buttons and accents.
          - YOU MUST INCLUDE A COMPREHENSIVE <CSS> BLOCK. DO NOT LEAVE IT EMPTY.`
        }
      ]

    });

    if (aiResponse.stop_reason === 'max_tokens') {
      console.warn('⚠️ Response was truncated — increase max_tokens');
      return res.status(500).json({
        error: "AI response was cut off. Try selecting fewer content items."
      });
    }

    const responseText = aiResponse.content[0].text;

    // Extract using the tag helper
    const result = {
      checklist: (extractTagContent(responseText, 'CHECKLIST') || "").split('\n').filter(l => l.trim()).map(l => l.replace(/^- /, '')),
      message: extractTagContent(responseText, 'MESSAGE') || "Website modernized successfully.",
      html: extractTagContent(responseText, 'HTML') || "<div>Error parsing HTML</div>",
      css: extractTagContent(responseText, 'CSS') || `
        /* Fallback Modern Base */
        :root { --primary: ${safePrimary}; --secondary: ${safeSecondary}; --text: #ffffff; }
        body { font-family: 'Inter', sans-serif; background: var(--primary); color: var(--text); line-height: 1.6; padding: 2rem; }
        nav { display: flex; gap: 1rem; padding: 1rem; background: rgba(0,0,0,0.15); backdrop-filter: blur(10px); }
        a { color: var(--secondary); text-decoration: none; }
        .hero { text-align: center; padding: 4rem 0; }
        img { max-width: 100%; border-radius: 0; }
        button, .btn { background: var(--secondary); color: #fff; padding: 0.5rem 1.5rem; border: none; cursor: pointer; }
      `.trim(),
      javascript: extractTagContent(responseText, 'JAVASCRIPT') || ""
    };

    res.json({
      url,
      checklist: result.checklist,
      message: result.message,
      usage: aiResponse.usage, // Added usage stats for tracking
      sections: [{
        name: "Modernized Website",
        description: "A complete reconstruction based on your selected items",
        html: result.html,
        css: result.css,
        javascript: result.javascript
      }]
    });

  } catch (err) {
    console.error("❌ Error dissecting website:", err);
    res.status(500).json({
      error: "Failed to dissect website",
      details: err.message
    });
  }
});

// XML-tag based extractor — works even if AI response is truncated
const extractTagContent = (text, tag) => {
  const openTagRegex = new RegExp(`<${tag}>`, 'i');
  const closeTagRegex = new RegExp(`</${tag}>`, 'i');

  const openMatch = text.match(openTagRegex);
  if (!openMatch) return null;

  const contentStart = openMatch.index + openMatch[0].length;
  const closeMatch = text.match(closeTagRegex);

  // If no closing tag, return whatever was generated so far (handles truncation)
  return !closeMatch
    ? text.substring(contentStart).trim()
    : text.substring(contentStart, closeMatch.index).trim();
};

const MODERNIZE_DIRECT_SYSTEM_PROMPT = `You are a senior frontend engineer. 

Modernize a website screenshot into a modern, premium design.

Steps:
  1. Analyze the screenshot and identify the main sections (Navbar, Hero, etc.)
  2. Extract the content from each section, you must know what is the essential content of each section
  3. Refactor the content into clean, professional, modern HTML (NO NEED TO USE SAME STRUCTURE AS THE SCREENSHOT)
  4. Apply the user's specified theme and color palette
  5. Carefully check if all essential content is included in the refactored HTML
  6. If not, add the missing content to the refactored HTML

  RULES:
1. Include <!-- SECTION: Name --> comments in HTML to mark each section (Navbar, Hero, etc.)
2. Use the user's specified theme and color palette
3. Premium aesthetic: glassmorphism, excellent typography, smooth gradients
4. DO NOT use .body or * as classnames — use semantic names only
5. DO NOT add any border-radius (NO ROUND EDGES)
6. Main container: NO margin, padding, border, or max-width
7. USE a timestamp suffix for all classnames to avoid collisions (e.g. .nav-1708123456)
8. BE CONCISE with CSS — use variables and shorthand to minimize token usage

RESPONSE FORMAT — use exactly these XML tags, nothing else before or after:
<MESSAGE>
Brief description of changes made
</MESSAGE>
<HTML>
...full HTML body content here...
</HTML>
<CSS>
...full CSS here...
</CSS>
<JAVASCRIPT>
...JS here or leave empty...
</JAVASCRIPT>`;

app.post("/api/modernize-direct", async (req, res) => {
  try {
    const { image, theme, color } = req.body;
    console.log(`🎨 Modernizing direct: theme=${theme}, color=${color}`);

    const base64Image = image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    const mediaType = image.match(/^data:image\/(png|jpeg|webp);base64,/)?.[1] || "jpeg";

    const prompt = `Modernize this website screenshot.
Theme: ${theme}
Primary Color: ${color}
Incorporate the ${theme} theme with ${color} as the primary color. Use state-of-the-art aesthetics.`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16000,
      temperature: 0.1,
      system: MODERNIZE_DIRECT_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: `image/${mediaType}`, data: base64Image }
          },
          { type: "text", text: prompt }
        ]
      }]
    });

    const responseText = msg.content[0].text;
    console.log(`📄 Raw response length: ${responseText.length} chars`);

    // Use XML-tag extraction — resilient to truncation
    const html = extractTagContent(responseText, 'HTML');
    const css = extractTagContent(responseText, 'CSS');
    const javascript = extractTagContent(responseText, 'JAVASCRIPT');
    const message = extractTagContent(responseText, 'MESSAGE');

    if (!html && !css) {
      console.error("❌ Could not extract HTML or CSS from response");
      return res.status(500).json({ error: "AI response did not contain valid HTML/CSS tags. Try again." });
    }

    console.log(`✅ Extracted: HTML(${(html || '').length}), CSS(${(css || '').length}), JS(${(javascript || '').length})`);

    res.json({ message: message || "Modernization complete.", html, css, javascript });
  } catch (err) {
    console.error("❌ Error in /api/modernize-direct:", err);
    res.status(500).json({ error: "Failed to modernize website" });
  }
});

app.post("/api/factor-components", async (req, res) => {
  try {
    const { html, css, javascript } = req.body;
    console.log(`✂️ Factoring components...`);

    const prompt = `I have a full webpage's code. Please break it down into modular, standalone components. 
    The code contains comments like "<!-- SECTION: Name -->" to help you identify where each section begins and ends.
    
    HTML:
    ${html}
    
    CSS:
    ${css}
    
    JavaScript:
    ${javascript}
    
    Return a JSON object with a "components" field which is an array of objects:
    {
      "components": [
        {
          "name": "Component Name",
          "html": "...",
          "css": "...",
          "js": "..."
        }
      ]
    }
    
    For each component:
    1. Extract the corresponding HTML for that section.
    2. Extract ONLY the CSS relevant to that section's HTML.
    3. Ensure each component is fully functional on its own (contains all necessary styles).`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    });

    const responseText = msg.content[0].text;
    const extractedText = cleanJSON(responseText);
    const parsedResponse = JSON.parse(extractedText);

    res.json(parsedResponse);
  } catch (err) {
    console.error("❌ Error in /api/factor-components:", err);
    res.status(500).json({ error: "Failed to factor components" });
  }
});

app.post("/api/screenshot-website-file", async (req, res) => {
  let browser;
  try {
    const { url } = req.body;

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',

        // 🔥 Important ones:
        '--disable-features=SafeBrowsing,IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-extensions',
      ],
    });


    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9'
    });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      const isJunk = /google-analytics|doubleclick|recaptcha|facebook\.com|track|analytics/i.test(url);
      if (isJunk) {
        request.abort();
      } else {
        request.continue();
      }
    });

    page.on('requestfailed', req => {
      // Silence noisy aborted logs for non-essential resources
      if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
      console.log('Resource Failed:', req.url(), req.failure());
    });

    try {
      await page.goto(url, {
        waitUntil: 'networkidle2', // Wait for most network activity to stop
        timeout: 45000
      });
    } catch (e) {
      console.warn('⚠️ Navigation timeout or warning, attempting to proceed anyway...', e.message);
      // If it times out but we have content, we still try to take the screenshot
    }

    // Give a small buffer for layouts to settle
    await new Promise(r => setTimeout(r, 2000));



    // Generate filename
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;

    const filepath = path.join(screenshotsDir, filename);

    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check page height and cap it to prevent Anthropic API errors (8000px limit)
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const MAX_HEIGHT = 7500; // Leaving some buffer

    // Save screenshot to file
    if (pageHeight > MAX_HEIGHT) {
      console.log(`📏 Page height (${pageHeight}px) exceeds limit. Capping at ${MAX_HEIGHT}px.`);
      await page.setViewport({ width: 1920, height: MAX_HEIGHT });
      await page.screenshot({
        path: filepath,
        fullPage: false // Take only the viewport since we set it to MAX_HEIGHT
      });
    } else {
      await page.screenshot({
        path: filepath,
        fullPage: true
      });
    }

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
    console.error("❌ Screenshot Error:", err);
    res.status(500).json({ error: "Failed to take screenshot", details: err.message });
  }
});

app.post("/api/scrape-images", async (req, res) => {
  let browser;
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    console.log(`🕵️ Scraping images from: ${url}`);

    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Scroll to bottom to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 100;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    const images = await page.evaluate((baseUrl) => {
      const imgElements = Array.from(document.querySelectorAll('img, [style*="background-image"], source'));
      const urls = new Set();
      imgElements.forEach(el => {
        let src = '';
        if (el.tagName === 'IMG') {
          src = el.src || el.dataset.src || el.dataset.lazySrc;
        } else if (el.tagName === 'SOURCE') {
          src = el.srcset ? el.srcset.split(' ')[0] : (el.src || '');
        } else {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none') {
            const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (match) src = match[1];
          }
        }
        if (src && !src.startsWith('data:')) {
          try { urls.add(new URL(src, baseUrl).href); } catch (e) { }
        }
      });
      return Array.from(urls);
    }, url);

    await browser.close();
    res.json({ success: true, count: images.length, images });
  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ Scraping Error:", err);
    res.status(500).json({ error: "Failed to scrape images", details: err.message });
  }
});

// Proxy endpoint to bypass CORS when fetching images for canvas
app.get("/api/proxy-image", async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send("No URL provided");

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const contentType = response.headers['content-type'];
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (err) {
    console.error("❌ Proxy Error:", err.message);
    res.status(500).send("Failed to fetch image");
  }
});

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
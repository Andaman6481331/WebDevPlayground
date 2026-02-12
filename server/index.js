import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

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
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../src')));

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

// const SYSTEM_PROMPT = `You are an expert Frontend Web Developer and UI Designer acting as an intelligent coding agent.

// Your goal is to help the user build and modify a web page by generating HTML, CSS, and JavaScript code.

// INPUT CONTEXT:
// The user will provide you with:
// 1. The user's request/instruction.
// 2. The current state of HTML, CSS, and JavaScript code.
// 3. Optionally, an image for reference.

// OUTPUT FORMAT:
// You must return a JSON object with the following structure:
// {
//   "html": "The complete HTML code",
//   "css": "The complete CSS code",
//   "javascript": "The complete JavaScript code",
//   "explanation": "A brief explanation of what you changed or created"
// }

// GUIDELINES:
// 1. **Complete Code**: Always return the FULL code for each section (HTML, CSS, JS), not just snippets. If a section hasn't changed, return the existing code for that section.
// 2. **Modern Standards**: Use modern HTML5, CSS3 (Flexbox, Grid), and ES6+ JavaScript.
// 3. **Visual Aesthetics**: prioritizing premium, modern designs (gradients, shadows, rounded corners, good typography) unless requested otherwise.
// 4. **Safety**: Ensure the code is safe to run in a browser.
// 5. **Responsiveness**: Try to make designs responsive where applicable.
// 6. **Uniqueness**: The class name of the element must contain timestamp to prevent same class name collision on css

// BEHAVIOR:
// - If the user sends a new request, analyze their instruction and the current code.
// - Apply the requested changes intelligently.
// - If the user provides an image, try to replicate its design in the code.
// - Be creative but faithful to the user's intent.

// CRITICAL: Return ONLY valid JSON. Do not include markdown formatting or text outside the JSON object.`;

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

const IMAGE_TO_CODE_SYSTEM_PROMPT = `You are an expert Frontend Developer specializing in converting design mockups to production-ready code.

TASK: Convert the provided design image into pixel-perfect HTML and CSS that matches the design exactly.

RESPONSE FORMAT - You MUST respond with ONLY this JSON structure (no markdown, no explanations):
{
  "message": "Brief summary of what was created",
  "html": "HTML fragment content only (NO <!DOCTYPE>, <html>, <body> tags). Just the internal elements.",
  "css": "Complete CSS with exact colors, spacing, and typography from the image",
  "javascript": "JavaScript for any interactive elements (empty string if none needed)"
}

CRITICAL REQUIREMENTS:
1. COLOR ACCURACY: Extract exact colors from the image and use them precisely
2. LAYOUT FIDELITY: Match spacing, alignment, and proportions exactly
3. TYPOGRAPHY: Match font sizes, weights, and styles as closely as possible
4. RESPONSIVE: Make it mobile-friendly with breakpoints
5. MODERN CSS: Use Flexbox/Grid, CSS variables for colors
6. NO EXTERNAL LIBS: No Tailwind, Bootstrap, or CDN dependencies
7. PLACEHOLDER IMAGES: Use via.placeholder.com or similar for any images
8. FULL-WIDTH: Make layouts edge-to-edge unless it's clearly a centered component
9. PRODUCTION-READY: Clean, well-structured, commented code

IMPORTANT JSON FORMATTING:
- Escape all special characters: newlines as \\n, quotes as \\"
- Do NOT wrap response in markdown code blocks
- Return ONLY the raw JSON object

Example of proper escaping:
{
  "html": "<div class=\\"container\\">\\n  <h1>Title</h1>\\n</div>",
  "css": ".container {\\n  display: flex;\\n}"
}`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, html, css, javascript, image, model, conversationId, intent } = req.body;

    console.log(`\n📝 Request: conversationId=${conversationId}, intent=${JSON.stringify(intent)}`);

    // Map frontend model names to Anthropic model IDs
    const modelMap = {
      'sonnet': "claude-sonnet-4-5-20250929",
      'haiku': "claude-haiku-4-5-20251001",
      'opus': "claude-opus-4-5-20251101"
    };

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

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
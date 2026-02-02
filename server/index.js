import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const app = express();

// Initialize Anthropic client
// Defaults to process.env.ANTHROPIC_API_KEY
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files from the src directory
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../src')));

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

IMPORTANT: 
- HTML: RETURN THE BODY CONTENT. Do NOT return \`<!DOCTYPE html>\`, \`<html>\`, or \`<head>\` tags. You MAY include \`<style>\` and \`<script>\` tags within the HTML if needed for a standalone component structure.
- CSS: Do NOT include \`script\` or \`link\` tags in the CSS field. Do NOT use \`*\` or \`body\` selectors unless absolutely necessary.
- Design: Create full-width, modern layouts.
- Responsiveness: Ensure mobile-friendliness.
- Do NOT wrap response in markdown code blocks
- Return ONLY the raw JSON object
- html SHOULD start with a semantic container (div, section, main, etc.) that uses a unique classname contains timestamp if it's a new component.
- PRESERVE existing structures: If the user has a <section> or <picture> tag as the outer structure, DO NOT wrap it in an extra <div> or replace it with a <div> unless requested.
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
    const { message, html, css, javascript, image, model } = req.body;

    // Map frontend model names to Anthropic model IDs
    const modelMap = {
      'sonnet': "claude-sonnet-4-5-20250929",
      'haiku': "claude-haiku-4-5-20251001",
      'opus': "claude-opus-4-5-20251101"
    };

    const selectedModel = modelMap[model] || 'claude-sonnet-4-5-20250929';

    // Construct the user message
    const userContent = [];

    // Add image if present
    if (image) {
      // Assuming image is a base64 data URL
      const base64Image = image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      const mediaType = image.match(/^data:image\/(png|jpeg|webp);base64,/)?.[1] || "jpeg";

      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: `image/${mediaType}`,
          data: base64Image,
        },
      });
    }

    // Add text context
    let contextMessage = `User Request: ${message || "Create a web page based on my input."}\n\n`;

    if (html || css || javascript) {
      contextMessage += `CURRENT CODE STATE:\n`;
      if (html) contextMessage += `HTML:\n${html}\n\n`;
      if (css) contextMessage += `CSS:\n${css}\n\n`;
      if (javascript) contextMessage += `JavaScript:\n${javascript}\n\n`;
    }

    contextMessage += `\nPlease generate the updated full HTML, CSS, and JS code based on the request.`;

    userContent.push({
      type: "text",
      text: contextMessage,
    });

    const msg = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: 16000,
      temperature: 0.1, // Low temperature for code determinism
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    // Parse the response
    let responseText = msg.content[0].text;

    // Clean up markdown code blocks if present
    responseText = responseText.replace(/```json\n/g, "").replace(/```/g, "").trim();

    // Find the first '{' and the last '}' to extract the JSON object
    const startIndex = responseText.indexOf('{');
    const endIndex = responseText.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1) {
      responseText = responseText.substring(startIndex, endIndex + 1);
    }

    console.log("Raw AI Response:", responseText); // Debugging

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", e.message);
      console.error("Failed Response Text:", responseText);
      console.error("Context Message Length:", contextMessage.length); // Check context size
      // Fallback if JSON parsing fails - simple heuristic or error
      parsedResponse = {
        html: html || "",
        css: css || "",
        javascript: javascript || "",
        explanation: "Sorry, I had trouble generating the structured code. Please try again."
      };
    }

    // Normalize keys: if AI returned 'js' instead of 'javascript', move it
    if (parsedResponse.js && !parsedResponse.javascript) {
      parsedResponse.javascript = parsedResponse.js;
      delete parsedResponse.js;
    }

    // Add usage info
    parsedResponse.usage = msg.usage;

    res.json(parsedResponse);

  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Failed to process request with Claude API" });
  }
});

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
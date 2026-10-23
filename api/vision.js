/**
 * Vercel Serverless Function: /api/vision
 * Secure server-side gateway to NVIDIA NIM Multimodal Vision API
 * (meta/llama-3.2-11b-vision-instruct)
 *
 * Protects private API keys from client-side exposure.
 */

const fs = require('fs');
const path = require('path');

// Auto-load fallback .env locally if not in Vercel production environment
function loadLocalEnv() {
    if (process.env.NVIDIA_API_KEY) return;
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'Visual Explanation', 'Visual Explanation', '.env'),
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '..', 'Visual Explanation', 'Visual Explanation', '.env')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try {
                const lines = fs.readFileSync(p, 'utf-8').split('\n');
                for (const line of lines) {
                    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
                    if (match) {
                        const key = match[1];
                        let val = (match[2] || '').trim();
                        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            } catch (e) {
                // Ignore fallback read errors
            }
        }
    }
}

loadLocalEnv();

module.exports = async function handler(req, res) {
    // 1. Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method Not Allowed. Use POST.'
        });
    }

    // 2. Validate API Key
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        return res.status(503).json({
            success: false,
            error: 'NVIDIA API key not configured on server. Please set NVIDIA_API_KEY in Vercel Environment Variables.'
        });
    }

    // 3. Parse and Validate Request Payload
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid JSON body.'
            });
        }
    }

    const { image, mode = 'scene', customPrompt } = body || {};

    if (!image || typeof image !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'Missing required "image" field. Must be a base64 Data URL (e.g., data:image/jpeg;base64,...).'
        });
    }

    if (!image.startsWith('data:image/')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid image format. Must start with data:image/ (e.g. data:image/jpeg;base64,...).'
        });
    }

    // Payload size guard (~10MB max)
    if (image.length > 14 * 1024 * 1024) {
        return res.status(413).json({
            success: false,
            error: 'Image payload too large. Maximum supported size is 10MB.'
        });
    }

    // 4. Construct System & User Prompt based on Assistive Goal
    let promptText = "";
    if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim().length > 0) {
        promptText = `You are VisionAid AI, an assistive multimodal assistant for a blind individual. Answer the user's question strictly based on the visible evidence in the supplied image. If an object or detail is not visible or cannot be confirmed from the image, explicitly state that it is not visible or unclear. Do not guess or fabricate information.
User Question: "${customPrompt.trim()}"`;
    } else if (mode === 'medicine') {
        promptText = "You are VisionAid AI, an assistive medical vision assistant for a blind individual. Carefully read and explain this medicine packaging or bottle. State the exact brand or generic medication name, dosage strength, formulation (tablet, capsule, syrup), instructions, and expiration date if visible. If text or numbers are blurred, partially cut off, or illegible, explicitly warn the user that they cannot be confirmed.";
    } else if (mode === 'ocr' || mode === 'document') {
        promptText = "You are VisionAid AI. Transcribe all readable text from this document, label, or sign accurately and verbatim. Preserve numbers, dates, and paragraph order. If any section is blurry, obstructed, or unreadable, explicitly state that the text cannot be read clearly.";
    } else {
        // General scene & object understanding
        promptText = "You are VisionAid AI, an assistive vision guide helping a blind person understand their immediate environment. Describe this scene clearly and concisely in 2 to 3 spoken sentences. Identify prominent objects, their relative positions (left, center, right, foreground), and distinguish visually similar objects (for instance, distinguish an AC remote from a smartphone by checking for physical rubber buttons and temperature display vs. a glass touchscreen). Highlight any obstacles ahead.";
    }

    // 5. Query NVIDIA NIM Multimodal Vision API
    const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const payload = {
        model: 'meta/llama-3.2-11b-vision-instruct',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: promptText },
                    { type: 'image_url', image_url: { url: image } }
                ]
            }
        ],
        max_tokens: 384,
        temperature: 0.15
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000); // 35 second timeout

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();
            console.error('[NVIDIA NIM Error]', response.status, errText);
            return res.status(response.status).json({
                success: false,
                error: `Vision AI service responded with error status ${response.status}.`,
                details: errText.slice(0, 200)
            });
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (!content || content.trim() === '') {
            return res.status(502).json({
                success: false,
                error: 'Vision AI model returned an empty response. Please capture the frame again.'
            });
        }

        return res.status(200).json({
            success: true,
            description: content.trim(),
            model: 'meta/llama-3.2-11b-vision-instruct',
            mode
        });

    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                error: 'Vision AI request timed out. Please try capturing the scene again.'
            });
        }
        console.error('[Vision API Exception]', err);
        return res.status(500).json({
            success: false,
            error: 'Internal server error while processing image with Vision AI.',
            details: err.message
        });
    }
};

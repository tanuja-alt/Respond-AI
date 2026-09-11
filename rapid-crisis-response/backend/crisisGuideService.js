// backend/crisisGuideService.js
// AI Crisis Companion — multi-turn Gemini chat for panicked users
// Reuses the existing GEMINI_API_KEY and @google/generative-ai package.

require('dotenv').config();

let model = null;

try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
    console.log('[CrisisGuide] ✅ Gemini model ready');
} catch (err) {
    console.error('[CrisisGuide] ❌ Init failed:', err?.message || err);
}

// ── Language name map (for system prompt) ──────────────────────
const LANG_NAMES = {
    en: 'English',
    es: 'Spanish',
    hi: 'Hindi',
    fr: 'French',
    ar: 'Arabic',
    zh: 'Chinese (Simplified)',
    pt: 'Portuguese',
};

/**
 * Build the system instruction that shapes the AI's persona.
 * Context is injected so the AI knows the victim's situation.
 */
function buildSystemPrompt(context, language) {
    const langName = LANG_NAMES[language] || 'English';
    const ctx = context || {};

    return `You are a calm, empathetic emergency response coordinator working for RespondAI — a hotel emergency system.

YOUR ROLE:
- You are guiding a PANICKED victim through a live crisis.
- You must be reassuring, clear, and direct.
- Never use jargon. Use simple words anyone can understand.
- Keep every response SHORT: 2–3 bulleted action steps maximum.
- After giving steps, ask ONE follow-up question to assess the victim's safety.

CURRENT SITUATION:
- Disaster type: ${ctx.crisisType || 'unknown'}
- Urgency level: ${ctx.severity || 'unknown'}
- Floor: ${ctx.floor || 'unknown'}
- Room: ${ctx.room || 'unknown'}
- GPS coordinates: ${ctx.location ? `${ctx.location.lat}, ${ctx.location.lng}` : 'unavailable'}

CRITICAL RULES:
1. NEVER tell the user to call emergency services — RespondAI staff are already notified.
2. Focus on immediate survival actions the user can take RIGHT NOW.
3. If the user seems injured, prioritize first-aid guidance.
4. If the user is in danger, prioritize evacuation guidance.
5. Be conversational, not robotic. Use phrases like "You're doing great", "Stay with me".
6. You MUST respond entirely in ${langName}. Every word must be in ${langName}.
7. Use bullet points (•) for steps, not numbered lists.
8. Maximum 100 words per response.`;
}

/**
 * Chat with the crisis guide AI.
 *
 * @param {Array<{role: 'user'|'model', parts: [{text: string}]}>} history
 * @param {string} userMessage — the latest user message
 * @param {Object} context — { crisisType, floor, room, location, severity }
 * @param {string} language — ISO code (en, es, hi, fr, ar, zh, pt)
 * @returns {Promise<{reply: string, history: Array}>}
 */
async function chatCrisisGuide(history, userMessage, context, language) {
    if (!model) {
        throw new Error('Gemini model not initialized — check GEMINI_API_KEY');
    }

    const systemPrompt = buildSystemPrompt(context, language);

    // Start a chat with system instruction + existing history
    const chat = model.startChat({
        history: [
            // Inject system prompt as the first "user" turn + model acknowledgement
            {
                role: 'user',
                parts: [{ text: `[SYSTEM INSTRUCTION — do NOT repeat this to the user]\n\n${systemPrompt}` }],
            },
            {
                role: 'model',
                parts: [{ text: 'Understood. I will follow these instructions.' }],
            },
            // Then the real conversation history
            ...(history || []),
        ],
        generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 300,
        },
    });

    const result = await chat.sendMessage(userMessage);
    const reply = result.response.text().trim();

    // Build updated history (for the frontend to send back next turn)
    const updatedHistory = [
        ...(history || []),
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: reply }] },
    ];

    return { reply, history: updatedHistory };
}

module.exports = { chatCrisisGuide };

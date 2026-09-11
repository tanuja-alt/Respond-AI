require('dotenv').config();

let model = null;

try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
    console.log('[Gemini] ✅ Model initialized');
} catch (err) {
    console.error('[Gemini] ❌ Init failed (classify will be unavailable):', err?.message || err);
}

const classifyIncident = async (description, floor, type) => {
    if (!model) {
        throw new Error('Gemini model not initialized — check GEMINI_API_KEY');
    }
    const prompt = `
You are an emergency AI for a hotel in India.
Analyze this crisis and return ONLY valid JSON, nothing else.

Crisis: "${description}"
Floor: "${floor}"
Type: "${type}"

Return EXACTLY this JSON:
{
  "crisis_type": "fire|medical|security|flood|other",
  "severity": "RED|YELLOW|GREEN",
  "affected_zone": "which floors or areas",
  "sop": ["step 1","step 2","step 3","step 4","step 5","step 6"],
  "notify": ["fire_brigade|ambulance|police|manager"],
  "summary": "one plain English sentence for staff"
}
`;
    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (err) {
        console.error('[Gemini] ❌ Classification failed, returning default fallback:', err?.message || err);
        return {
            crisis_type: type || "other",
            severity: "YELLOW",
            affected_zone: floor || "unknown",
            sop: ["Evaluate the situation", "Ensure guest safety", "Contact manager"],
            notify: ["manager"],
            summary: "Incident logged. AI classification temporarily unavailable."
        };
    }
};

module.exports = { classifyIncident };
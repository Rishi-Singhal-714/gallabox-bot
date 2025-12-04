// PRE_INTENT_FILTER.js
const { OpenAI } = require("openai");

// Employee numbers allowed for internal mode
const EMPLOYEE_NUMBERS = [
  "918368127760",
  "919717350080",
  "918860924190"
];

module.exports = {
  async runPreIntentFilter(sessionId, userMessage, openai, getSheets, saveBillingToSheet) {
    // check if this phone is an employee number
    if (!EMPLOYEE_NUMBERS.includes(sessionId)) {
      return { handled: false }; // NOT employee → continue as normal
    }

    console.log("⚡ Employee mode active for:", sessionId);

    // GPT prompt for internal employee intent classification
    const empPrompt = `
Classify internal employee WhatsApp message into exactly one intent:
- "empgreeting" → hello / hi / casual small talk
- "billing" → invoice, GST, payment related queries

Respond ONLY JSON:
{ "intent": "billing", "reason": "short why" }
User message: "${userMessage}"
`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Internal employee intent classifier" },
          { role: "user", content: empPrompt }
        ],
        max_tokens: 200,
        temperature: 0
      });

      const parsed = JSON.parse(completion.choices[0].message.content.trim());
      const empIntent = parsed.intent || "empgreeting";

      // 1️⃣ Employee greeting path
      if (empIntent === "empgreeting") {
        return {
          handled: true,
          reply: "Hi Boss 👋 How can I help you?"
        };
      }

      // 2️⃣ Billing query path
      if (empIntent === "billing") {
        try {
          await saveBillingToSheet(sessionId, userMessage, getSheets);
        } catch (err) {
          console.error("❌ Failed saving billing to sheet:", err);
        }

        return {
          handled: true,
          reply: "📄 Billing noted boss! Which Order / Invoice should I check?"
        };
      }

      // fallback for unexpected parsing
      return {
        handled: true,
        reply: "Hi Boss 👋"
      };

    } catch (err) {
      console.error("❌ Employee GPT filter error:", err);
      return {
        handled: true,
        reply: "Hi Boss 👋"
      };
    }
  }
};

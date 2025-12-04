const { OpenAI } = require('openai');

// Default billing sheet name (can override via ENV)
const BILLING_SHEET_NAME = process.env.BILLING_SHEET_NAME || "Sheet3";

module.exports = async function preIntentFilter(
  openai,
  session,
  sessionId,
  userMessage,
  getSheets,
  createAgentTicket,
  appendUnderColumn
) {
  const empPrompt = `
  Classify internal employee WhatsApp message into exactly one intent:
  - "empgreeting"
  - "billing"
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

    session.lastDetectedIntent = empIntent;
    session.lastDetectedIntentTs = Date.now();

    // 🟢 If casual hello
    if (empIntent === "empgreeting") {
      return "Hi Boss 👋 How can I help you?";
    }

    // 🟡 If Billing Request
    if (empIntent === "billing") {
      try {
        const sheets = await getSheets();
        if (sheets) {
          const timestamp = new Date().toISOString();
          await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${BILLING_SHEET_NAME}!A:Z`,
            valueInputOption: "RAW",
            requestBody: {
              values: [[sessionId, userMessage, timestamp]]
            }
          });
        }
      } catch (err) {
        console.error("❌ Failed saving to Billing Sheet:", err);
      }

      return "📄 Billing noted boss! Which Order / Invoice should I check?";
    }

    return "Hi Boss 👋"; // fallback

  } catch (err) {
    console.error("❌ Employee GPT filter error:", err);
    return "Hi Boss 👋";
  }
};

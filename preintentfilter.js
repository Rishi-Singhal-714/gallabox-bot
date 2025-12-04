const { OpenAI } = require("openai");

// Fuzzy matcher
function matchProbability(str, keyword) {
  if (!str || !keyword) return 0;
  str = str.toLowerCase();
  keyword = keyword.toLowerCase();
  if (str.includes(keyword)) return 1.0;
  let m = [];
  for (let i = 0; i <= keyword.length; i++) m[i] = [i];
  for (let j = 0; j <= str.length; j++) m[0][j] = j;
  for (let i = 1; i <= keyword.length; i++) {
    for (let j = 1; j <= str.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (keyword[i - 1] === str[j - 1] ? 0 : 1)
      );
    }
  }
  const dist = m[keyword.length][str.length];
  const prob = 1 - dist / Math.max(keyword.length, str.length);
  return Math.max(0, Math.min(prob, 1));
}

const BILLING_MAIN = {
  operation: ["operation", "ops", "opration"],
  logistics: ["logistics", "logistic", "logi"],
  inventory: ["inventory", "invantory", "stock"],
  market: ["market", "marketing"],
  fixed: ["fixed", "fix", "fxd"],
  SALES: ["sales", "sale", "seles"],
  Lead: ["lead", "leeds", "leed"]
};

function detectIntent(text) {
  let best = { key: null, prob: 0 };
  for (const key in BILLING_MAIN) {
    for (const syn of BILLING_MAIN[key]) {
      const p = matchProbability(text, syn);
      if (p > best.prob) best = { key, prob: p };
    }
  }
  return best;
}

async function ensureSheet(sheets, sheetName, headers) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID
  });
  const exists = meta.data.sheets.some(s => s.properties.title === sheetName);

  if (!exists) {
    console.log(`📄 Creating sheet: ${sheetName}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: sheetName } } },
          {
            updateCells: {
              range: { sheetId: meta.data.sheets.length, startRowIndex: 0, endRowIndex: 1 },
              rows: [{ values: headers.map(h => ({ userEnteredValue: { stringValue: h } })) }],
              fields: "*"
            }
          }
        ]
      }
    });
  }
}

module.exports = async function preIntentFilter(
  openai,
  session,
  sessionId,
  userMessage,
  getSheets
) {
  const text = userMessage.toLowerCase();
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;
  const detect = detectIntent(text);

  if (detect.prob >= 0.55) {
    const category = detect.key;
    const isBilling = ["operation", "logistics", "inventory", "market", "fixed"].includes(category);

    // 1️⃣ Billing Logs Storage
    const logsSheet = `${phn}Billing_Logs`;
    await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logsSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[Date.now(), phn, userMessage, ts]]
      }
    });

    // 2️⃣ Billing Data storage
    if (isBilling) {
      const dataSheet = `${phn}Billing_Data`;
      const headers = ["operation", "logistics", "inventory", "market", "fixed"];
      await ensureSheet(sheets, dataSheet, headers);

      const colIndex = headers.indexOf(category) + 1;
      const range = `${dataSheet}!${String.fromCharCode(64 + colIndex)}2:${String.fromCharCode(64 + colIndex)}`;
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: range
      }).catch(() => ({ data: {} }));

      const old = existing.data.values ? existing.data.values.flat().join("\n") : "";
      const updated = old ? `${old}\n${userMessage} — ${ts}` : `${userMessage} — ${ts}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${dataSheet}!${String.fromCharCode(64 + colIndex)}2`,
        valueInputOption: "RAW",
        requestBody: { values: [[updated]] }
      });

      return `📌 Logged under **${category.toUpperCase()}**.  
What invoice should I check boss?`;
    }

    // 3️⃣ Sales Data
    if (category === "SALES") {
      const sheet = `${phn}Sales_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[phn, userMessage, ts]] }
      });
      return `📌 Saved under **SALES**. Provide order / invoice details boss.`;
    }

    // 4️⃣ Lead Data
    if (category === "Lead") {
      const sheet = `${phn}Lead_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[phn, userMessage, ts]] }
      });
      return `🎯 Lead noted boss. Shall I follow-up or alert admin?`;
    }
  }

  // Default greeting
  return "Hi Boss 👋 How can I assist?";
};

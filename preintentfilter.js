const { OpenAI } = require("openai");

/* -------------------- FUZZY MATCH HELPER -------------------- */
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

/* -------------------- INTENT KEYWORDS -------------------- */
const BILLING_MAIN = {
  operation: ["operation", "ops", "opration"],
  logistics: ["logistics", "logistic", "logi"],
  inventory: ["inventory", "invantory", "stock"],
  market: ["market", "marketing"],
  fixed: ["fixed", "fix", "fxd"],
  SALES: ["sales", "sale", "seles"],
  Lead: ["lead", "leeds", "leed"]
};

/* -------------------- CATEGORY CODES FOR BILLING IDS -------------------- */
const CODE_MAP = {
  operation: "OPS",
  logistics: "LOG",
  inventory: "INV",
  market: "MKT",
  fixed: "FIX",
  SALES: "SAL",
  Lead: "LED"
};

/* -------------------- BILLING ID GENERATOR -------------------- */
function generateBillingID(category) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `${CODE_MAP[category]}${dd}${mm}${yyyy}${hh}${min}${ss}`;
}

/* -------------------- INTENT DETECTOR -------------------- */
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

/* -------------------- ENSURE SHEET EXISTS -------------------- */
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId
  });

  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (sheet) return sheet.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });

  const newSheetId =
    addRes.data.replies[0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });

  return newSheetId;
}

/* ============================================================
   MAIN LOGIC
============================================================ */
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
  let detect = detectIntent(text);

  if (detect.prob >= 0.55) {
    const category = detect.key;
    const isBilling = ["operation", "logistics", "inventory", "market", "fixed"].includes(category);

    const id = generateBillingID(category);

    /* ---------- 1️⃣ Billing Logs: ALWAYS ---------- */
    const logsSheet = `${phn}Billing_Logs`;
    await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logsSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[id, phn, userMessage, ts]]
      }
    });

    /* ---------- 2️⃣ Billing_Data (category only) ---------- */
    if (isBilling) {
      const dataSheet = `${phn}Billing_Data`;
      const headers = ["operation", "logistics", "inventory", "market", "fixed"];
      await ensureSheet(sheets, dataSheet, headers);

      let cleanMsg = userMessage.replace(/^\w+\s*[-:]\s*/i, "").trim();
      const updateLine = `${id},${cleanMsg},${ts}`;

      const colIndex = headers.indexOf(category) + 1;
      const col = String.fromCharCode(64 + colIndex);
      const range = `${dataSheet}!${col}2:${col}`;

      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range
      }).catch(() => ({ data: {} }));

      const prev = existing?.data?.values?.flat().join("\n") || "";
      const finalData = prev ? `${prev}\n${updateLine}` : updateLine;

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${dataSheet}!${col}2`,
        valueInputOption: "RAW",
        requestBody: { values: [[finalData]] }
      });

      return `📌 Logged under **${category.toUpperCase()}** (ID: ${id}).  
What invoice should I check boss?`;
    }

    /* ---------- 3️⃣ SALES ---------- */
    if (category === "SALES") {
      const sheet = `${phn}Sales_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[phn, userMessage, ts]]
        }
      });

      return `📌 Saved under **SALES** ★  
Invoice number boss?`;
    }

    /* ---------- 4️⃣ LEAD ---------- */
    if (category === "Lead") {
      const sheet = `${phn}Lead_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[phn, userMessage, ts]]
        }
      });

      return `🎯 Lead captured (ID: ${id}) boss!`;
    }
  }

  /* ---------- NON-BILLING FALLBACK ---------- */
  return "Hi Boss 👋 How can I assist?";
};

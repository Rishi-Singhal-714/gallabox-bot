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

/* -------------------- ENSURE SHEET EXISTS WITH HEADERS -------------------- */
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (sheet) return sheet.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });

  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });

  return newSheetId;
}

/* -------------------- GLOBAL DAILY COUNTER (Billing_Counter sheet) -------------------- */
// Sheet structure:
// Billing_Counter!A1:B1 = ["date", "counter"]
// Billing_Counter!A2:B2 = ["DDMMYY", "123"]

async function getNextBillingId(category, sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const counterSheet = "Billing_Counter";

  // Ensure counter sheet exists
  await ensureSheet(sheets, counterSheet, ["date", "counter"]);

  // Read current stored date + counter
  const res = await sheets.spreadsheets.values
    .get({
      spreadsheetId,
      range: `${counterSheet}!A2:B2`
    })
    .catch(() => ({ data: {} }));

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayStr = `${dd}${mm}${yy}`;

  let lastDate = "";
  let lastCounter = 0;

  if (res.data && res.data.values && res.data.values[0]) {
    lastDate = res.data.values[0][0] || "";
    lastCounter = parseInt(res.data.values[0][1] || "0", 10) || 0;
  }

  let newCounter;
  if (lastDate === todayStr) {
    newCounter = lastCounter + 1;
  } else {
    newCounter = 1;
  }

  // Save updated date + counter
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:B2`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[todayStr, String(newCounter)]]
    }
  });

  const code = CODE_MAP[category] || "BIL";
  const counterStr = String(newCounter).padStart(6, "0");
  const id = `${code}${todayStr}${counterStr}`; // e.g. OPS041225000001
  return id;
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
  const detect = detectIntent(text);

  // Confidence threshold for billing detection
  if (detect.prob >= 0.55) {
    const category = detect.key;
    const isBilling = ["operation", "logistics", "inventory", "market", "fixed"].includes(
      category
    );

    // Generate global daily ID
    const id = await getNextBillingId(category, sheets);

    /* ---------- 1️⃣ Billing Logs: ALWAYS for any billing (incl SALES, Lead) ---------- */
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

    /* ---------- 2️⃣ Billing_Data (only for operation/logistics/inventory/market/fixed) ---------- */
    if (isBilling) {
      const dataSheet = `${phn}Billing_Data`;
      const headers = ["operation", "logistics", "inventory", "market", "fixed"];
      await ensureSheet(sheets, dataSheet, headers);

      // Clean message → remove leading "keyword -" or "keyword:" etc.
      let cleanMsg = userMessage.replace(/^\w+\s*[-:]\s*/i, "").trim();
      if (!cleanMsg) cleanMsg = userMessage.trim();

      // Cell line format: id,message,time
      const line = `${id},${cleanMsg},${ts}`;

      const colIndex = headers.indexOf(category) + 1; // 1-based
      const colLetter = String.fromCharCode(64 + colIndex);
      const range = `${dataSheet}!${colLetter}2:${colLetter}`;

      const existing = await sheets.spreadsheets.values
        .get({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range
        })
        .catch(() => ({ data: {} }));

      const prev = existing?.data?.values?.flat().join("\n") || "";
      const finalValue = prev ? `${prev}\n${line}` : line;

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${dataSheet}!${colLetter}2`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[finalValue]]
        }
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

      return `📌 Saved under **SALES** (ID: ${id}).  
Invoice number, boss?`;
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

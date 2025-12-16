const { OpenAI } = require("openai");
const { google } = require("googleapis");

/* ============================================================
   CONSTANT SHEET NAMES (COMMON FOR ALL USERS)
============================================================ */
const SHEETS = {
  BILLING_LOGS: "Billing_Logs",
  BILLING_DATA: "Billing_Data",
  SALES_DATA: "Sales_Data",
  LEAD_DATA: "Lead_Data",
  COUNTER: "Billing_Counter"
};

/* ============================================================
   FUZZY MATCH HELPER
============================================================ */
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
  return Math.max(0, Math.min(1 - dist / Math.max(keyword.length, str.length), 1));
}

/* ============================================================
   BILLING CATEGORIES
============================================================ */
const BILLING_MAIN = {
  operation: ["operation", "ops", "opration"],
  logistics: ["logistics", "logistic", "logi"],
  inventory: ["inventory", "invantory", "stock"],
  market: ["market", "marketing"],
  fixed: ["fixed", "fix", "fxd"],
  SALES: ["sales", "sale", "seles"],
  Lead: ["lead", "leeds", "leed"]
};

const CODE_MAP = {
  operation: "OPS",
  logistics: "LOG",
  inventory: "INV",
  market: "MKT",
  fixed: "FIX",
  SALES: "SAL",
  Lead: "LED",
  Unknown: "UNK"
};

/* ============================================================
   INTENT DETECTION
============================================================ */
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

/* ============================================================
   GREETING CHECK
============================================================ */
function isEmpGreeting(text) {
  if (!text) return false;
  text = text.toLowerCase().trim();
  return [
    "hi","hello","hey","gm","good morning",
    "good evening","good night","gn","good afternoon"
  ].some(g => text === g || text.startsWith(g + " "));
}

/* ============================================================
   ENSURE SHEET EXISTS
============================================================ */
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const found = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (found) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });
}

/* ============================================================
   DAILY BILLING ID GENERATOR
============================================================ */
async function getNextBillingId(category, sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const headers = ["date","OPS","LOG","INV","MKT","FIX","SAL","LED","UNK"];

  await ensureSheet(sheets, SHEETS.COUNTER, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEETS.COUNTER}!A2:I`
  }).catch(() => ({ data: {} }));

  const rows = res.data?.values || [];

  const now = new Date();
  const today =
    String(now.getDate()).padStart(2, "0") +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getFullYear()).slice(-2);

  let counters = Array(headers.length - 1).fill(0);

  if (rows.length && rows[0][0] === today) {
    counters = rows[0].slice(1).map(v => parseInt(v || "0", 10));
  } else {
    rows.unshift([today, ...counters]);
  }

  const prefix = CODE_MAP[category] || "UNK";
  const colIndex = headers.indexOf(prefix) - 1;
  counters[colIndex]++;
  rows[0] = [today, ...counters];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEETS.COUNTER}!A2:I`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

  return `${prefix}${today}${String(counters[colIndex]).padStart(6, "0")}`;
}

/* ============================================================
   NEXT EMPTY ROW (COLUMN)
============================================================ */
async function getNextEmptyRowInColumn(sheets, spreadsheetId, sheet, col) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheet}!${col}:${col}`
  }).catch(() => ({ data: {} }));
  return (res.data?.values?.length || 0) + 1;
}

/* ============================================================
   MAIN FILTER
============================================================ */
module.exports = async function preIntentFilter(
  openai, session, sessionId, userMessage, getSheets
) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  if (isEmpGreeting(userMessage)) {
    return "Hello boss! What would you like to do?";
  }

  const detect = detectIntent(userMessage.toLowerCase());
  let category = detect.prob >= 0.55 ? detect.key : "Unknown";

  const billingCats = ["operation","logistics","inventory","market","fixed"];
  const salesCats = ["SALES"];
  const leadCats = ["Lead"];

  if (![...billingCats, ...salesCats, ...leadCats].includes(category)) {
    category = "Unknown";
  }

  const id = await getNextBillingId(category, sheets);

  /* ---------------- LOGS ---------------- */
  await ensureSheet(
    sheets,
    SHEETS.BILLING_LOGS,
    ["id","phn_no","message","time"]
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEETS.BILLING_LOGS}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, userMessage, ts]] }
  });

  /* ---------------- BILLING DATA ---------------- */
  if (billingCats.includes(category)) {
    await ensureSheet(
      sheets,
      SHEETS.BILLING_DATA,
      ["phn_no", ...billingCats]
    );

    const colIndex = billingCats.indexOf(category) + 2;
    const colLetter = String.fromCharCode(64 + colIndex);

    const row = await getNextEmptyRowInColumn(
      sheets,
      process.env.GOOGLE_SHEET_ID,
      SHEETS.BILLING_DATA,
      colLetter
    );

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEETS.BILLING_DATA}!A${row}:${colLetter}${row}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[phn, `${id},${userMessage},${ts}`]]
      }
    });

    return `📌 Logged under ${category.toUpperCase()} (ID: ${id})`;
  }

  /* ---------------- SALES ---------------- */
  if (salesCats.includes(category)) {
    await ensureSheet(
      sheets,
      SHEETS.SALES_DATA,
      ["id","phn_no","message","time"]
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEETS.SALES_DATA}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, userMessage, ts]] }
    });

    return `📈 Sales saved (ID: ${id})`;
  }

  /* ---------------- LEADS ---------------- */
  if (leadCats.includes(category)) {
    await ensureSheet(
      sheets,
      SHEETS.LEAD_DATA,
      ["id","phn_no","message","time"]
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEETS.LEAD_DATA}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, userMessage, ts]] }
    });

    return `🎯 Lead captured (ID: ${id})`;
  }

  return `⚠️ Category not recognized (ID: ${id})`;
};

const { OpenAI } = require("openai");
const { google } = require("googleapis");
const { Readable } = require("stream");

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
  return Math.max(0, Math.min(1 - dist / Math.max(keyword.length, str.length), 1));
}

/* -------------------- MAIN BILLING CATEGORIES -------------------- */
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

/* -------------------- DETECT INTENT -------------------- */
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
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (meta.data.sheets.find(s => s.properties.title === sheetName)) return;

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

/* -------------------- NEXT EMPTY ROW -------------------- */
async function getNextEmptyRowInColumn(sheets, sheetName, colLetter) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!${colLetter}:${colLetter}`
  }).catch(() => ({ data: {} }));

  return (res.data?.values?.length || 0) + 1;
}

/* -------------------- DAILY ID COUNTER -------------------- */
async function getNextBillingId(category, sheets) {
  const counterSheet = "Billing_Counter";
  const headers = ["date", "OPS", "LOG", "INV", "MKT", "FIX", "SAL", "LED", "UNK"];

  await ensureSheet(sheets, counterSheet, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${counterSheet}!A2:I`
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
  const idx = headers.indexOf(prefix) - 1;
  counters[idx]++;
  rows[0] = [today, ...counters];

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${counterSheet}!A2:I`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

  return `${prefix}${today}${String(counters[idx]).padStart(6, "0")}`;
}

/* ============================================================
   MAIN
============================================================ */
module.exports = async function preIntentFilter(
  openai, session, sessionId, userMessage, getSheets
) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];

  /* -------- IMAGE -------- */
  if (session.lastMedia?.type === "imageUrl") {
    const imageUrl = session.lastMedia.data || "";
    const caption = session.lastMedia.caption || "";
    session.lastMedia = null;

    const detect = detectIntent(caption.toLowerCase());
    let category = detect.prob >= 0.55 ? detect.key : "Unknown";

    const id = await getNextBillingId(category, sheets);
    const msg = caption ? `${caption} | ${imageUrl}` : imageUrl;

    await ensureSheet(sheets, "Billing_Logs", ["id","phn_no","message","time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Billing_Logs!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, msg, ts]] }
    });

    if (billingCats.includes(category)) {
      await ensureSheet(sheets, "Billing_Data", billingCats);
      const col = String.fromCharCode(65 + billingCats.indexOf(category));
      const row = await getNextEmptyRowInColumn(sheets, "Billing_Data", col);
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `Billing_Data!${col}${row}`,
        valueInputOption: "RAW",
        requestBody: { values: [[`${id},${msg},${ts}`]] }
      });
    }
/* -------- SALES (TEXT) -------- */
if (category === "SALES") {
  await ensureSheet(sheets, "Sales_Data", ["id","phn_no","message","time"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Sales_Data!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, cleanMsg, ts]] }
  });
  return `📌 Saved under SALES (ID: ${id})`;
}

/* -------- LEAD (TEXT) -------- */
if (category === "Lead") {
  await ensureSheet(sheets, "Lead_Data", ["id","phn_no","message","time"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Lead_Data!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, cleanMsg, ts]] }
  });
  return `🎯 Lead captured (ID: ${id})`;
}

    
    return `🖼️ Image logged (ID: ${id})`;
  }

  /* -------- TEXT -------- */
  const detect = detectIntent(userMessage.toLowerCase());
  let category = detect.prob >= 0.55 ? detect.key : "Unknown";
  const id = await getNextBillingId(category, sheets);

  await ensureSheet(sheets, "Billing_Logs", ["id","phn_no","message","time"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Billing_Logs!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, userMessage, ts]] }
  });

  if (billingCats.includes(category)) {
    await ensureSheet(sheets, "Billing_Data", billingCats);
    const col = String.fromCharCode(65 + billingCats.indexOf(category));
    const row = await getNextEmptyRowInColumn(sheets, "Billing_Data", col);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Billing_Data!${col}${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [[`${id},${userMessage},${ts}`]] }
    });
    return `📌 Logged ${category.toUpperCase()} (${id})`;
  }

  return `⚠️ Logged as UNKNOWN (${id})`;
};

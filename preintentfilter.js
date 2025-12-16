const { google } = require("googleapis");

/* ================= SHEET NAMES ================= */
const SHEETS = {
  BILLING_LOGS: "Billing_Logs",
  BILLING_DATA: "Billing_Data",
  SALES_DATA: "Sales_Data",
  LEAD_DATA: "Lead_Data",
  COUNTER: "Billing_Counter"
};

/* ================= FUZZY MATCH ================= */
function matchProbability(str, keyword) {
  if (!str || !keyword) return 0;
  str = str.toLowerCase();
  keyword = keyword.toLowerCase();
  if (str.includes(keyword)) return 1;

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
  return Math.max(0, 1 - m[keyword.length][str.length] / Math.max(keyword.length, str.length));
}

/* ================= CATEGORIES ================= */
const BILLING_MAIN = {
  operation: ["operation", "ops"],
  logistics: ["logistics", "logi"],
  inventory: ["inventory", "stock"],
  market: ["market"],
  fixed: ["fixed"],
  SALES: ["sales"],
  Lead: ["lead"]
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

function detectIntent(text) {
  let best = { key: null, prob: 0 };
  for (const key in BILLING_MAIN) {
    for (const s of BILLING_MAIN[key]) {
      const p = matchProbability(text, s);
      if (p > best.prob) best = { key, prob: p };
    }
  }
  return best;
}

/* ================= SHEET UTILS ================= */
async function ensureSheet(sheets, name, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (meta.data.sheets.find(s => s.properties.title === name)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: name } } }] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${name}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });
}

async function getNextEmptyRowInColumn(sheets, sheet, col) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheet}!${col}:${col}`
  }).catch(() => ({ data: {} }));
  return (res.data?.values?.length || 0) + 1;
}

/* ================= DAILY ID ================= */
async function getNextBillingId(category, sheets) {
  const headers = ["date","OPS","LOG","INV","MKT","FIX","SAL","LED","UNK"];
  await ensureSheet(sheets, SHEETS.COUNTER, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEETS.COUNTER}!A2:I`
  }).catch(() => ({ data: {} }));

  const rows = res.data?.values || [];
  const now = new Date();
  const today =
    String(now.getDate()).padStart(2,"0") +
    String(now.getMonth()+1).padStart(2,"0") +
    String(now.getFullYear()).slice(-2);

  let counters = Array(8).fill(0);
  if (rows.length && rows[0][0] === today) {
    counters = rows[0].slice(1).map(v => parseInt(v || "0",10));
  } else {
    rows.unshift([today, ...counters]);
  }

  const prefix = CODE_MAP[category] || "UNK";
  const idx = headers.indexOf(prefix) - 1;
  counters[idx]++;
  rows[0] = [today, ...counters];

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEETS.COUNTER}!A2:I`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

  return `${prefix}${today}${String(counters[idx]).padStart(6,"0")}`;
}

/* ================= MAIN ================= */
module.exports = async function preIntentFilter(
  openai, session, sessionId, userMessage, getSheets
) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  const billingCols = ["operation","logistics","inventory","market","fixed"];

  /* -------- IMAGE -------- */
  if (session.lastMedia?.type === "imageUrl") {
    const imageUrl = session.lastMedia.data;
    const caption = session.lastMedia.caption || "";
    session.lastMedia = null;

    const detect = detectIntent(caption.toLowerCase());
    const category = detect.prob >= 0.55 ? detect.key : "Unknown";
    const id = await getNextBillingId(category, sheets);
    const msg = caption ? `${caption} | ${imageUrl}` : imageUrl;

    await ensureSheet(sheets, SHEETS.BILLING_LOGS, ["id","phn_no","message","time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEETS.BILLING_LOGS}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, msg, ts]] }
    });

    if (billingCols.includes(category)) {
      await ensureSheet(sheets, SHEETS.BILLING_DATA, billingCols);
      const col = String.fromCharCode(65 + billingCols.indexOf(category));
      const row = await getNextEmptyRowInColumn(sheets, SHEETS.BILLING_DATA, col);
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${SHEETS.BILLING_DATA}!${col}${row}`,
        valueInputOption: "RAW",
        requestBody: { values: [[`${id},${msg},${ts}`]] }
      });
    }

    if (category === "SALES") {
      await ensureSheet(sheets, SHEETS.SALES_DATA, ["id","phn_no","message","time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${SHEETS.SALES_DATA}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, phn, msg, ts]] }
      });
    }

    if (category === "Lead") {
      await ensureSheet(sheets, SHEETS.LEAD_DATA, ["id","phn_no","message","time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${SHEETS.LEAD_DATA}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, phn, msg, ts]] }
      });
    }

    return `🖼️ Image saved (${id})`;
  }

  /* -------- TEXT -------- */
  const detect = detectIntent(userMessage.toLowerCase());
  const category = detect.prob >= 0.55 ? detect.key : "Unknown";
  const id = await getNextBillingId(category, sheets);

  await ensureSheet(sheets, SHEETS.BILLING_LOGS, ["id","phn_no","message","time"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEETS.BILLING_LOGS}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, userMessage, ts]] }
  });

  if (billingCols.includes(category)) {
    await ensureSheet(sheets, SHEETS.BILLING_DATA, billingCols);
    const col = String.fromCharCode(65 + billingCols.indexOf(category));
    const row = await getNextEmptyRowInColumn(sheets, SHEETS.BILLING_DATA, col);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEETS.BILLING_DATA}!${col}${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [[`${id},${userMessage},${ts}`]] }
    });
    return `📌 Logged ${category.toUpperCase()} (${id})`;
  }

  return `⚠️ Logged as UNKNOWN (${id})`;
};

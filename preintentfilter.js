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

const CODE_MAP = {
  operation: "OPS",
  logistics: "LOG",
  inventory: "INV",
  market: "MKT",
  fixed: "FIX",
  SALES: "SAL",
  Lead: "LED"
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
  const found = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (found) return found.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });

  return true;
}

/* -------------------- CATEGORY-WISE GLOBAL DAILY COUNTER -------------------- */
async function getNextBillingId(category, sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const counterSheet = "Billing_Counter";

  const headers = ["date", "OPS", "LOG", "INV", "MKT", "FIX", "SAL", "LED", "UNK"];
  const colCount = headers.length;

  await ensureSheet(sheets, counterSheet, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${counterSheet}!A2:I2`
  }).catch(() => ({ data: {} }));

  let row = res.data?.values?.[0] || [];
  row = [...row, ...Array(colCount - row.length).fill("0")];

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayStr = `${dd}${mm}${yy}`;

  const lastDate = row[0] || "";
  let counters = row.slice(1).map(v => parseInt(v || "0", 10));

  if (lastDate !== todayStr) counters = counters.map(() => 0);

  const prefix = CODE_MAP[category] || "UNK";
  const idx = headers.indexOf(prefix) - 1;

  counters[idx]++;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:I2`,
    valueInputOption: "RAW",
    requestBody: { values: [[todayStr, ...counters]] }
  });

  const serial = String(counters[idx]).padStart(6, "0");
  return `${prefix}${todayStr}${serial}`;
}

/* ============================================================
   MAIN HANDLER
============================================================ */
module.exports = async function preIntentFilter(openai, session, sessionId, userMessage, getSheets) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  const detect = detectIntent(userMessage.toLowerCase());
  const category = detect.key;
  const isValid = category && detect.prob >= 0.55;

  /* Clean message */
  let cleanMsg = userMessage;
  if (category) {
    const rg = new RegExp(`^(${category})\\s*[-: ]+`, "i");
    cleanMsg = cleanMsg.replace(rg, "").trim();
    cleanMsg = cleanMsg.replace(/^\w+\s*[-:]\s*/i, "").trim();
  }
  if (!cleanMsg) cleanMsg = userMessage.trim();

  /* Always Logging Sheet */
  const logsSheet = `${phn}Billing_Logs`;
  await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);

  /* NOT VALID */
  if (!isValid) {
    const id = await getNextBillingId("UNK", sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logsSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, userMessage, ts]] }
    });

    return `⚠️ Unknown category boss.\nSend like 👇\noperation - msg\nlogistics - msg\ninventory - msg\nmarket - msg\nfixed - msg\nsales - msg\nlead - msg`;
  }

  /* VALID → GET Billing ID */
  const id = await getNextBillingId(category, sheets);

  /* Always store in LOGS */
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${logsSheet}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, cleanMsg, ts]] }
  });

  const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];

  /* Billing Data Sheet */
  if (billingCats.includes(category)) {
    const dataSheet = `${phn}Billing_Data`;
    const headers = ["operation", "logistics", "inventory", "market", "fixed"];
    await ensureSheet(sheets, dataSheet, headers);

    const idx = headers.indexOf(category) + 1;
    const column = String.fromCharCode(64 + idx);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${dataSheet}!${column}:${column}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[`${id},${cleanMsg},${ts}`]]
      }
    });

    return `📌 Saved in **${category.toUpperCase()}** ✓\n(ID: ${id})\nSend Invoice No.?`;
  }

  /* Sales */
  if (category === "SALES") {
    const sheet = `${phn}Sales_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheet}!A:A`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });
    return `📌 Saved in SALES ✓\n(ID: ${id})`;
  }

  /* Lead */
  if (category === "Lead") {
    const sheet = `${phn}Lead_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheet}!A:A`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });
    return `🎯 Lead captured ✓\n(ID: ${id})`;
  }

  return "Hi Boss 👋 How can I assist?";
};

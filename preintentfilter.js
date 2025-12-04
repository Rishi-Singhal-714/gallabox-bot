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

/* -------------------- PREFIXES FOR ID -------------------- */
const CODE_MAP = {
  operation: "OPS",
  logistics: "LOG",
  inventory: "INV",
  market: "MKT",
  fixed: "FIX",
  SALES: "SAL",
  Lead: "LED",
  UNK: "UNK" // UNKNOWN category
};

/* Detect Intent */
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

/* -------------------- GLOBAL DAILY COUNTER (CATEGORY-WISE) -------------------- */
/*
Billing_Counter Sheet:
A:DATE | B:OPS | C:LOG | D:INV | E:MKT | F:FIX | G:SAL | H:LED | I:UNK
*/
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
  let counters = row.slice(1).map(x => parseInt(x || "0"));

  if (lastDate !== todayStr) counters = counters.map(() => 0);

  const prefix = CODE_MAP[category];
  const counterIndex = headers.indexOf(prefix) - 1;

  counters[counterIndex]++;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:I2`,
    valueInputOption: "RAW",
    requestBody: { values: [[todayStr, ...counters]] }
  });

  const counterStr = String(counters[counterIndex]).padStart(6, "0");
  return `${prefix}${todayStr}${counterStr}`;
}

/* ============================================================
   MAIN LOGIC HANDLER
============================================================ */
module.exports = async function preIntentFilter(
  openai,
  session,
  sessionId,
  userMessage,
  getSheets
) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  const detect = detectIntent(userMessage.toLowerCase());
  const category = detect.key;
  const isValid = category && detect.prob >= 0.55;

  // Clean message
  let cleanMsg = userMessage;
  if (category) {
    const reg = new RegExp(`^(${category})\\s*[-: ]+`, "i");
    cleanMsg = cleanMsg.replace(reg, "").trim();
    cleanMsg = cleanMsg.replace(/^\w+\s*[-:]\s*/i, "").trim();
  }
  if (!cleanMsg) cleanMsg = userMessage.trim();

  const logSheet = `${phn}Billing_Logs`;
  await ensureSheet(sheets, logSheet, ["id", "phn_no", "message", "time"]);

  // Unknown Category
  if (!isValid) {
    const id = await getNextBillingId("UNK", sheets);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, cleanMsg, ts]] }
    });

    return `⚠️ Couldn’t identify category boss.\nPlease send like:\n\noperation - message\nlogistics - message\ninventory - message\nmarket - message\nfixed - message\nsales - message\nlead - message`;
  }

  // Valid Category
  const id = await getNextBillingId(category, sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${logSheet}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, cleanMsg, ts]] }
  });

  const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];

  if (billingCats.includes(category)) {
    const dataSheet = `${phn}Billing_Data`;
    const headers = ["operation", "logistics", "inventory", "market", "fixed"];
    await ensureSheet(sheets, dataSheet, headers);

    const colIndex = headers.indexOf(category) + 1;
    const colLetter = String.fromCharCode(64 + colIndex);

    const entry = `${id},${cleanMsg},${ts}`;

    const old = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${dataSheet}!${colLetter}2:${colLetter}`
    }).catch(() => ({ data: {} }));

    const prev = old.data?.values?.flat().join("\n") || "";
    const finalValue = prev ? `${prev}\n${entry}` : entry;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${dataSheet}!${colLetter}2`,
      valueInputOption: "RAW",
      requestBody: { values: [[finalValue]] }
    });

    return `📌 Logged under **${category.toUpperCase()}** (ID: ${id}).  
Provide invoice number boss?`;
  }

  if (category === "SALES") {
    const sheet = `${phn}Sales_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });
    return `📌 Saved under **SALES** (ID: ${id}).`;
  }

  if (category === "Lead") {
    const sheet = `${phn}Lead_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });
    return `🎯 Lead captured (ID: ${id}) boss!`;
  }

  return "Hi Boss 👋 How can I assist?";
};

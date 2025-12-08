const { OpenAI } = require("openai");

/* -------------------- SMALL BULK DELAY TO PREVENT OVERLOAD -------------------- */
let lastProcessTime = 0;
const MIN_DELAY = 600; // 0.6 sec gap between logs (adjust 400-1000ms if needed)

async function safeDelay() {
  const now = Date.now();
  const diff = now - lastProcessTime;
  if (diff < MIN_DELAY) {
    await new Promise(res => setTimeout(res, MIN_DELAY - diff));
  }
  lastProcessTime = Date.now();
}

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

/* -------------------- EMPLOYEE GREETING CHECK -------------------- */
function isEmpGreeting(text) {
  if (!text) return false;
  text = text.toLowerCase().trim();

  const greetWords = [
    "hi",
    "hello",
    "hey",
    "gm",
    "good morning",
    "good evening",
    "good night",
    "gn",
    "good afternoon"
  ];

  return greetWords.some(g =>
    text === g || text.startsWith(g + " ")
  );
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
      requests: [{ addSheet: { properties: { title: sheetName } } } ]
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

/* -------------------- DAILY ID COUNTER -------------------- */
async function getNextBillingId(category, sheets) {
  await safeDelay(); // ⭐ Important fix: avoid sheet write conflict

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const counterSheet = "Billing_Counter";
  const headers = ["date", "OPS", "LOG", "INV", "MKT", "FIX", "SAL", "LED", "UNK"];

  await ensureSheet(sheets, counterSheet, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${counterSheet}!A2:I2`
  }).catch(() => ({ data: {} }));

  let row = res.data?.values?.[0] || [];
  row = [...row, ...Array(9 - row.length).fill("0")];

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayStr = `${dd}${mm}${yy}`;

  const lastDate = row[0] || "";
  let counters = row.slice(1).map(n => parseInt(n || "0", 10));
  if (lastDate !== todayStr) counters = counters.map(() => 0);

  const prefix = CODE_MAP[category];
  const colIndex = headers.indexOf(prefix) - 1;

  counters[colIndex]++;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:I2`,
    valueInputOption: "RAW",
    requestBody: { values: [[todayStr, ...counters]] }
  });

  const num = String(counters[colIndex]).padStart(6, "0");
  return `${prefix}${todayStr}${num}`;
}

/* ============================================================
   MAIN: EMPLOYEE MESSAGE FILTER
============================================================ */
module.exports = async function preIntentFilter(openai, session, sessionId, userMessage, getSheets) {

  await safeDelay(); // ⭐ Rate limit bulk bursts

  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;

  if (isEmpGreeting(userMessage)) {
    return `Hello boss! What would you like to do?`;
  }

  const detect = detectIntent(userMessage.toLowerCase());
  let category = detect.prob >= 0.55 ? detect.key : "Unknown";

  const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];
  const salesCats = ["SALES"];
  const leadCats = ["Lead"];

  if (!billingCats.includes(category) && !salesCats.includes(category) && !leadCats.includes(category)) {
    category = "Unknown";
  }

  const id = await getNextBillingId(category, sheets);

  let cleanMsg = userMessage.trim();
  const allKeywords = Object.values(BILLING_MAIN).flat();
  for (const kw of allKeywords) {
    const regex = new RegExp(`^${kw}\\b[\\s:,-]*`, "i");
    cleanMsg = cleanMsg.replace(regex, "").trim();
  }
  if (!cleanMsg) cleanMsg = userMessage.trim();

  const logsSheet = `${phn}Billing_Logs`;
  await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${logsSheet}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [[id, phn, cleanMsg, ts]] }
  });

  if (billingCats.includes(category)) {
    const dataSheet = `${phn}Billing_Data`;
    await ensureSheet(sheets, dataSheet, billingCats);

    const colIndex = billingCats.indexOf(category) + 1;
    const colLetter = String.fromCharCode(64 + colIndex);
    const rowNumber = parseInt(id.slice(-6), 10) + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${dataSheet}!${colLetter}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[`${id},${cleanMsg},${ts}`]] }
    });

    return `📌 Logged under **${category.toUpperCase()}** (ID: ${id}).`;
  }

  if (salesCats.includes(category)) {
    const sheet = `${phn}Sales_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });

    return `📌 Saved under **SALES** (ID: ${id}).`;
  }

  if (leadCats.includes(category)) {
    const sheet = `${phn}Lead_Data`;
    await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[phn, cleanMsg, ts]] }
    });

    return `🎯 Lead captured (ID: ${id}).`;
  }

  return `⚠️ Category not recognized boss!
📝 Logged as Unknown (ID: ${id})`;
};

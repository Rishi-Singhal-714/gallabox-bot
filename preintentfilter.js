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
}

/* -------------------- CATEGORY-WISE GLOBAL DAILY COUNTER -------------------- */
async function getNextBillingId(category, sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const counterSheet = "Billing_Counter";
  const headers = ["date", "OPS", "LOG", "INV", "MKT", "FIX", "SAL", "LED"];

  await ensureSheet(sheets, counterSheet, headers);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${counterSheet}!A2:H2`
  }).catch(() => ({ data: {} }));

  let row = (res.data && res.data.values && res.data.values[0]) ? res.data.values[0] : [];
  row = [...row, ...Array(8 - row.length).fill("0")];

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayStr = `${dd}${mm}${yy}`;

  const lastDate = row[0] || "";
  let counters = row.slice(1).map(n => parseInt(n || "0", 10));

  if (lastDate !== todayStr) {
    counters = counters.map(() => 0);
  }

  const prefix = CODE_MAP[category];
  const colIndex = headers.indexOf(prefix) - 1;
  counters[colIndex]++;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:H2`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[todayStr, ...counters]]
    }
  });

  const counterStr = String(counters[colIndex]).padStart(6, "0");
  return `${prefix}${todayStr}${counterStr}`;
}

/* ============================================================
   MAIN: EMPLOYEE MESSAGE FILTER + SMART ROW UPDATE
============================================================ */
module.exports = async function preIntentFilter(
  openai, session, sessionId, userMessage, getSheets
) {
  const sheets = await getSheets();
  const ts = new Date().toISOString();
  const phn = sessionId;
  const detect = detectIntent(userMessage.toLowerCase());

  if (detect.prob >= 0.55) {
    const category = detect.key;
    const id = await getNextBillingId(category, sheets);

    // 🔹 Clean Message
    const categoryRegex = new RegExp(`^(${category})\\s*[-: ]+`, "i");
    let cleanMsg = userMessage.replace(categoryRegex, "").trim();
    cleanMsg = cleanMsg.replace(/^\w+\s*[-:]\s*/i, "").trim();
    if (!cleanMsg) cleanMsg = userMessage.trim();

    // Log always
    const logsSheet = `${phn}Billing_Logs`;
    await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logsSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, cleanMsg, ts]] }
    });

    /* ---------------- SMART SAME ROW UPDATE ---------------- */
    const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];
    if (billingCats.includes(category)) {
      const dataSheet = `${phn}Billing_Data`;
      const headers = billingCats;
      await ensureSheet(sheets, dataSheet, headers);

      const colIndex = headers.indexOf(category);
      const range = `${dataSheet}!A2:E`;

      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range
      }).catch(() => ({data:{}}));

      const rows = existing?.data?.values || [];
      const line = `${id}, ${cleanMsg}, ${ts}`;
      let targetRow = rows.length - 1;

      if (targetRow < 0) targetRow = -1;

      if (targetRow >= 0) {
        const lastRow = rows[targetRow];
        const hasAny = lastRow.some(v => v && v.trim() !== "");
        if (!hasAny) targetRow = -1;
      }

      if (targetRow < 0) {
        const newRow = ["", "", "", "", ""];
        newRow[colIndex] = line;

        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${dataSheet}!A:Z`,
          valueInputOption: "RAW",
          requestBody: { values: [newRow] }
        });

      } else {
        const updateRange = `${dataSheet}!${String.fromCharCode(65 + colIndex)}${targetRow + 2}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: updateRange,
          valueInputOption: "RAW",
          requestBody: { values: [[line]] }
        });
      }

      return `📌 Logged under **${category.toUpperCase()}** (ID: ${id}).  
Provide invoice number boss?`;
    }

    if (category === "SALES") {
      const sheet = `${phn}Sales_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[phn, cleanMsg, ts]] }
      });
      return `📌 Saved under **SALES** (ID: ${id}) boss!`;
    }

    if (category === "Lead") {
      const sheet = `${phn}Lead_Data`;
      await ensureSheet(sheets, sheet, ["phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[phn, cleanMsg, ts]] }
      });
      return `🎯 Lead captured (ID: ${id}) boss!`;
    }
  }

  return "Hi Boss 👋 How can I assist?";
};

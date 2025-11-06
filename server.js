// --------------------------------------------
// ZULU CLUB - Strict CSV Matching Logic (no type2 fallback)
// --------------------------------------------
const express = require("express");
const axios = require("axios");
const { OpenAI } = require("openai");
const csv = require("csv-parser");
const { Readable } = require("stream");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- CONFIG --------------------
const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID,
  apiKey: process.env.GALLABOX_API_KEY,
  apiSecret: process.env.GALLABOX_API_SECRET,
  channelId: process.env.GALLABOX_CHANNEL_ID,
  baseUrl: "https://server.gallabox.com/devapi",
};
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// GitHub CSV URLs
const categoriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv";
const galleriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv";

// -------------------- DATA --------------------
let categories = [];
let galleries = [];

// Classifier IDs (fixed mapping)
const CLASSIFIERS = {
  men: 1869,
  women: 1870,
  kids: 1873,
  home: 1874,
  wellness: 2105,
  metals: 2119,
  food: 2130,
  electronics: 2132,
  gadgets: 2135,
  discover: 2136,
};

// -------------------- CSV LOADERS --------------------
async function fetchCSV(url) {
  const res = await axios.get(url, { responseType: "text" });
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(res.data)
      .pipe(csv())
      .on("data", (r) => rows.push(r))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function safeParseCat1(raw) {
  if (!raw) return [];
  let s = String(raw).trim();
  if (s === "null" || s === "" || s === "[]") return [];
  s = s.replace(/'/g, '"').replace(/,\s+/g, ",");
  if (!s.startsWith("[")) s = `[${s}]`;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr)
      ? arr.map((v) => Number(String(v).trim())).filter(Number.isFinite)
      : [];
  } catch {
    return [];
  }
}

async function loadCSVData() {
  const [catRows, galRows] = await Promise.all([
    fetchCSV(categoriesUrl),
    fetchCSV(galleriesUrl),
  ]);

  categories = catRows
    .filter((r) => r.id && r.name)
    .map((r) => ({ id: Number(r.id), name: String(r.name).trim() }));

  galleries = galRows
    .filter((r) => r.cat_id && r.type2 && r.cat1)
    .map((r) => ({
      cat_id: Number(r.cat_id),
      type2: String(r.type2).trim(),
      cat1: safeParseCat1(r.cat1),
    }));

  console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries`);
}

// -------------------- GPT INTERPRETER --------------------
async function interpretMessage(userMessage) {
  const sysPrompt = `
Classify the user's message for Zulu Club.

Return JSON with:
- intent: "product_search" | "greeting" | "company_info"
- product_term: e.g. "jeans", "t-shirt"
- classifier: e.g. "men", "women", "kids", "home", "electronics", "wellness", "metals", "food", "gadgets", "discover" | null
- need_classifier: true if classifier missing
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    return JSON.parse(res.choices[0].message.content.trim());
  } catch (err) {
    console.error("⚠️ GPT Parse Error:", err.message);
    return { intent: "product_search", product_term: userMessage, classifier: null, need_classifier: true };
  }
}

// -------------------- CATEGORY SEARCH LOGIC --------------------
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
}
function tokenize(str) {
  return normalize(str).split(" ").filter(Boolean);
}

function top3CategoriesForProduct(productTerm) {
  const tokens = tokenize(productTerm);
  const scored = categories.map((c) => {
    const name = normalize(c.name);
    const hits = tokens.filter((t) => name.includes(t)).length;
    return { id: c.id, name: c.name, score: hits };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).filter((x) => x.score > 0);
}

function filterGalleries(productTerm, classifier) {
  const classifierKey = Object.keys(CLASSIFIERS).find(
    (k) => normalize(k) === normalize(classifier)
  );
  const classifierId = CLASSIFIERS[classifierKey];

  if (!classifierId) return [];

  const topCats = top3CategoriesForProduct(productTerm);
  const topIds = topCats.map((x) => x.id);

  // Step 1: keep galleries with this classifier cat_id
  const step1 = galleries.filter((g) => g.cat_id === classifierId);

  // Step 2: filter by cat1 containing any of the top 3 product IDs
  const step2 = step1.filter((g) =>
    g.cat1.some((id) => topIds.includes(id))
  );

  return { rows: step2, topCats, classifierId };
}

function buildLinks(rows) {
  const unique = [...new Set(rows.map((r) => r.type2))];
  return unique.slice(0, 5).map((x) => `app.zulu.club/${encodeURIComponent(x)}`);
}

// -------------------- GALLABOX SENDER --------------------
async function sendMessage(to, name, message) {
  try {
    await axios.post(
      `${gallaboxConfig.baseUrl}/messages/whatsapp`,
      {
        channelId: gallaboxConfig.channelId,
        channelType: "whatsapp",
        recipient: { name, phone: to },
        whatsapp: { type: "text", text: { body: message } },
      },
      {
        headers: {
          apiKey: gallaboxConfig.apiKey,
          apiSecret: gallaboxConfig.apiSecret,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Sent to ${to}`);
  } catch (err) {
    console.error("❌ Send error:", err.message);
  }
}

// -------------------- MESSAGE HANDLER --------------------
async function handleMessage(userPhone, userName, userMessage) {
  const intent = await interpretMessage(userMessage);
  console.log("🤖 Interpretation:", intent);

  if (intent.intent === "greeting")
    return sendMessage(userPhone, userName, "Hey 👋 How can I help you shop today?");

  if (intent.intent === "company_info")
    return sendMessage(
      userPhone,
      userName,
      "Welcome to *Zulu Club*! 🛍️ Shop lifestyle products with *100-minute delivery*! Explore at zulu.club."
    );

  if (intent.intent === "product_search") {
    if (intent.need_classifier)
      return sendMessage(userPhone, userName, "Would you like it for *men, women,* or *kids*? 👕👗👶");

    const { rows, topCats } = filterGalleries(intent.product_term, intent.classifier);

    if (!rows.length) {
      return sendMessage(
        userPhone,
        userName,
        `Sorry, I couldn't find *${intent.product_term}* for *${intent.classifier}*. Try another keyword!`
      );
    }

    const links = buildLinks(rows);
    const response = `Here are *${intent.product_term}* options for *${intent.classifier}*:\n${links.join(
      "\n"
    )}\n\n🛒 More on app.zulu.club`;

    return sendMessage(userPhone, userName, response);
  }

  return sendMessage(userPhone, userName, "Hi there! What product are you looking for?");
}

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.whatsapp?.text?.body?.trim();
    const phone = req.body?.whatsapp?.from;
    const name = req.body?.contact?.name || "Customer";

    if (!msg || !phone)
      return res.status(400).json({ error: "Invalid webhook payload" });

    await handleMessage(phone, name, msg);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("💥 Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- HEALTH --------------------
app.get("/", (req, res) => {
  res.json({
    status: "✅ Zulu Club Product Assistant",
    version: "8.0 - Strict CSV Logic",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    timestamp: new Date().toISOString(),
  });
});

// -------------------- START --------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 Zulu Club Assistant running on port ${PORT}`)
  );
});

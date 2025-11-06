// --------------------------------------------
// ZULU CLUB - Classifier + Product Filtering Pipeline
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

// CSV URLs
const categoriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv";
const galleriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv";

// -------------------- DATA --------------------
let categories = [];
let galleries = [];

// Classifier IDs (you provided these)
const CLASSIFIERS = {
  Men: 1869,
  Women: 1870,
  Kids: 1873,
  Home: 1874,
  Wellness: 2105,
  Metals: 2119,
  Food: 2130,
  Electronics: 2132,
  Gadgets: 2135,
  Discover: 2136,
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
    .map((r) => ({ id: Number(r.id), name: r.name }));

  galleries = galRows
    .map((r) => {
      if (!r.cat_id || !r.type2 || !r.cat1) return null;
      return {
        cat_id: Number(r.cat_id),
        type2: r.type2.trim(),
        cat1: safeParseCat1(r.cat1),
      };
    })
    .filter(Boolean);

  console.log(
    `✅ Loaded ${categories.length} categories & ${galleries.length} galleries`
  );
}

// -------------------- GPT --------------------
async function interpretMessage(userMessage) {
  const sysPrompt = `
You are a message interpreter for Zulu Club.

Extract:
- intent: "product_search" | "greeting" | "company_info"
- product_term: e.g. "jeans", "t-shirt", "kurta"
- classifier: e.g. "men", "women", "kids", "home", "electronics", "wellness", "metals", "food", "gadgets", "discover"
If the classifier (gender/category type) is missing, respond with "need_classifier": true.

Example:
"I want a t-shirt" → { "intent": "product_search", "product_term": "t-shirt", "classifier": null, "need_classifier": true }
"I want a t-shirt for men" → { "intent": "product_search", "product_term": "t-shirt", "classifier": "men", "need_classifier": false }
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    return JSON.parse(response.choices[0].message.content.trim());
  } catch (err) {
    console.error("⚠️ GPT Parse Error:", err.message);
    return { intent: "product_search", product_term: userMessage, classifier: null, need_classifier: true };
  }
}

// -------------------- SEARCH LOGIC --------------------
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
}
function tokenize(str) {
  return normalize(str).split(" ").filter(Boolean);
}

function top3CategoriesForProduct(productTerm) {
  const tokens = tokenize(productTerm);
  const scored = categories.map((c) => {
    const n = normalize(c.name);
    const hits = tokens.filter((t) => n.includes(t)).length;
    return { id: c.id, name: c.name, score: hits };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).filter((x) => x.score > 0);
}

function filterGalleries(productTerm, classifier) {
  const classifierId = CLASSIFIERS[
    Object.keys(CLASSIFIERS).find(
      (k) => normalize(k) === normalize(classifier)
    )
  ];

  if (!classifierId) return [];

  const topCats = top3CategoriesForProduct(productTerm);
  const topIds = topCats.map((x) => x.id);

  // Step 1: filter by classifier cat_id
  const step1 = galleries.filter((g) => g.cat_id === classifierId);

  // Step 2: filter by cat1 containing product IDs
  const step2 = step1.filter((g) =>
    g.cat1.some((c1) => topIds.includes(c1))
  );

  return { rows: step2, topCats, classifierId };
}

function buildLinks(rows) {
  const uniq = [...new Set(rows.map((r) => r.type2))];
  return uniq.slice(0, 5).map((x) => `app.zulu.club/${encodeURIComponent(x)}`);
}

// -------------------- GALLABOX MESSAGE --------------------
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

// -------------------- MAIN HANDLER --------------------
async function handleMessage(userPhone, userName, userMessage) {
  const intentData = await interpretMessage(userMessage);
  console.log("🤖 Interpretation:", intentData);

  if (intentData.intent === "greeting") {
    return sendMessage(userPhone, userName, "Hey 👋 How can I help you shop today?");
  }

  if (intentData.intent === "company_info") {
    return sendMessage(
      userPhone,
      userName,
      "Welcome to *Zulu Club*! 🛍️ Premium lifestyle products delivered in *100 minutes*. Explore now at zulu.club."
    );
  }

  if (intentData.intent === "product_search") {
    if (intentData.need_classifier) {
      return sendMessage(
        userPhone,
        userName,
        "Would you like it for *men, women,* or *kids*? 👕👗👶"
      );
    }

    const { rows, topCats } = filterGalleries(
      intentData.product_term,
      intentData.classifier
    );

    if (!rows.length) {
      return sendMessage(
        userPhone,
        userName,
        `Sorry, I couldn't find *${intentData.product_term}* for *${intentData.classifier}*. Try another keyword!`
      );
    }

    const links = buildLinks(rows);
    const response = `Here are some *${intentData.product_term}* options for *${intentData.classifier}*:\n\n${links.join(
      "\n"
    )}\n\n🛒 Explore more on app.zulu.club`;

    return sendMessage(userPhone, userName, response);
  }

  return sendMessage(userPhone, userName, "Hi! How can I help you shop today?");
}

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const msg = body.whatsapp?.text?.body?.trim();
    const phone = body.whatsapp?.from;
    const name = body.contact?.name || "Customer";

    if (!msg || !phone) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    await handleMessage(phone, name, msg);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- HEALTH --------------------
app.get("/", (req, res) => {
  res.json({
    status: "✅ Zulu Club Product Assistant",
    version: "7.0 - Classifier Pipeline",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    timestamp: new Date().toISOString(),
  });
});

// -------------------- START --------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 Zulu Club Product Assistant running on port ${PORT}`)
  );
});

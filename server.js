// --------------------------------------------
// ZULU CLUB - Enhanced GPT Understanding + Strict CSV Matching
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

// -------------------- BUSINESS CONTEXT --------------------
const ZULU_BUSINESS_CONTEXT = `
ZULU CLUB BUSINESS CONTEXT:
We are a premium lifestyle e-commerce platform offering 100-minute delivery in Gurgaon.

OUR CATEGORIES & CLASSIFIERS:
• "women" - Women's Fashion: dresses, tops, co-ords, winterwear, loungewear & more
• "men" - Men's Fashion: shirts, tees, jackets, athleisure & more  
• "kids" - Kids: clothing, toys, learning kits & accessories
• "home" - Home Decor: showpieces, vases, lamps, aroma decor, premium home accessories, fountains
• "wellness" - Beauty & Self-Care: skincare, bodycare, fragrances & grooming essentials
• "metals" - Fashion Accessories: bags, jewelry, watches, sunglasses & belts
• "discover" - Lifestyle Gifting: curated gift sets & décor-based gifting
• "electronics" - Electronics
• "gadgets" - Gadgets
• "food" - Food

KEY FEATURES:
• 100-minute delivery in Gurgaon
• Try products at home, keep what you love
• Pop-up locations: AIPL Joy Street & AIPL Central
• Website: app.zulu.club

PRODUCT EXAMPLES:
• "I want jeans" → classifier: "men" or "women" (ask if needed)
• "Looking for skincare" → classifier: "wellness"
• "Home decoration items" → classifier: "home" 
• "Gift for friend" → classifier: "discover"
• "Kids toys" → classifier: "kids"
• "Watch" → classifier: "metals"
• "Perfume" → classifier: "wellness"
• "Sneakers" → classifier: "men"/"women"/"kids"
• "Smartphone" → classifier: "electronics"
`;

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

// -------------------- ENHANCED GPT INTERPRETER --------------------
async function interpretMessage(userMessage) {
  const sysPrompt = `
${ZULU_BUSINESS_CONTEXT}

YOUR ROLE: You are a shopping assistant for Zulu Club. Classify user messages to help them find products quickly.

CRITICAL RULES:
1. Always map products to our EXACT classifier names: "men", "women", "kids", "home", "wellness", "metals", "food", "electronics", "gadgets", "discover"
2. Be smart about category mapping - perfumes→wellness, watches→metals, gifts→discover, etc.
3. If classifier is ambiguous (like "shoes" without gender), set need_classifier: true

RESPONSE FORMAT (JSON only):
{
  "intent": "product_search" | "greeting" | "company_info" | "delivery_info",
  "product_term": "specific product mentioned",
  "classifier": "exact classifier from our list" | null,
  "need_classifier": true | false,
  "confidence": "high" | "medium" | "low"
}

INTENT GUIDELINES:
- "greeting": hi, hello, hey, good morning
- "company_info": "what is zulu club", "who are you", "tell me about your company"  
- "delivery_info": "delivery time", "100 minute delivery", "where do you deliver"
- "product_search": everything else about products

CLASSIFIER MAPPING EXAMPLES:
- "jeans", "shirt", "jacket" → "men" or "women" (ask if not specified)
- "skincare", "perfume", "makeup" → "wellness"
- "vase", "lamp", "home decor" → "home"
- "watch", "bag", "jewelry" → "metals"
- "gift", "present" → "discover"
- "toy", "kids clothes" → "kids"
- "phone", "laptop" → "electronics"
- "smartwatch", "earbuds" → "gadgets"
- "chocolate", "food" → "food"

User message: "${userMessage}"
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const interpretation = JSON.parse(res.choices[0].message.content.trim());
    
    // Validation
    if (!["product_search", "greeting", "company_info", "delivery_info"].includes(interpretation.intent)) {
      interpretation.intent = "product_search";
    }
    if (!interpretation.product_term && interpretation.intent === "product_search") {
      interpretation.product_term = userMessage;
    }
    
    console.log("🤖 Enhanced Interpretation:", interpretation);
    return interpretation;
    
  } catch (err) {
    console.error("⚠️ GPT Parse Error:", err.message);
    return { 
      intent: "product_search", 
      product_term: userMessage, 
      classifier: null, 
      need_classifier: true,
      confidence: "low"
    };
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

  if (!classifierId) return { rows: [], topCats: [], classifierId: null };

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

// -------------------- RESPONSE BUILDERS --------------------
function buildClassifierOptions() {
  const options = ["men", "women", "kids", "home", "wellness", "metals", "discover"];
  return `Would you like it for *${options.slice(0, -1).join("*, *")}*, or *${options[options.length - 1]}*? 🛍️`;
}

function buildDeliveryResponse() {
  return `🚚 *100-Minute Delivery Info:*\n\nWe deliver in *Gurgaon* within 100 minutes! ⚡\n\n• Try products at home\n• Keep what you love  \n• Return instantly\n• Pop-ups: AIPL Joy Street & AIPL Central\n\nShop now: app.zulu.club`;
}

function buildCompanyInfo() {
  return `🛍️ *Welcome to Zulu Club!*\n\nYour personalized lifestyle shopping experience with *100-minute delivery* in Gurgaon!\n\n*Categories:*\n• Women's & Men's Fashion\n• Kids, Home Decor, Wellness\n• Beauty, Accessories, Gifting\n• Electronics, Gadgets & more\n\n*Experience us:*\n📍 AIPL Joy Street & AIPL Central pop-ups\n🌐 app.zulu.club\n\nWhat would you like to explore today? 😊`;
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

// -------------------- ENHANCED MESSAGE HANDLER --------------------
async function handleMessage(userPhone, userName, userMessage) {
  const intent = await interpretMessage(userMessage);
  console.log("🤖 Enhanced Interpretation:", intent);

  switch (intent.intent) {
    case "greeting":
      return sendMessage(userPhone, userName, "Hey 👋 Welcome to Zulu Club! How can I help you shop today? 🛍️");

    case "company_info":
      return sendMessage(userPhone, userName, buildCompanyInfo());

    case "delivery_info":
      return sendMessage(userPhone, userName, buildDeliveryResponse());

    case "product_search":
      if (intent.need_classifier || !intent.classifier) {
        return sendMessage(userPhone, userName, buildClassifierOptions());
      }

      const { rows, topCats } = filterGalleries(intent.product_term, intent.classifier);

      if (!rows.length) {
        // Try to suggest alternatives
        const alternativeMsg = intent.confidence === "low" 
          ? `I'm not sure about *${intent.product_term}*. Try searching for specific items like "jeans", "perfume", "watch", or "home decor"?`
          : `Sorry, I couldn't find *${intent.product_term}* for *${intent.classifier}*. Try another keyword or check app.zulu.club for more options!`;
        
        return sendMessage(userPhone, userName, alternativeMsg);
      }

      const links = buildLinks(rows);
      const response = `Here are *${intent.product_term}* options for *${intent.classifier}*:\n${links.join(
        "\n"
      )}\n\n🛒 More on app.zulu.club\n🚚 100-min delivery in Gurgaon!`;

      return sendMessage(userPhone, userName, response);

    default:
      return sendMessage(userPhone, userName, "Hi! What product are you looking for? I can help you find fashion, home decor, wellness products, and more! 🛍️");
  }
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
    status: "✅ Zulu Club Enhanced Product Assistant",
    version: "9.0 - Enhanced GPT + Business Context",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    classifiers: Object.keys(CLASSIFIERS),
    timestamp: new Date().toISOString(),
  });
});

// -------------------- START --------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 Zulu Club Enhanced Assistant running on port ${PORT}`)
  );
});

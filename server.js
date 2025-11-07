// --------------------------------------------
// ZULU CLUB - Strict CSV Matching Logic (no type2 fallback) - DEBUG VERSION
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

// -------------------- DEBUG UTILS --------------------
function debugLog(module, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 [${timestamp}] ${module}: ${message}`);
  if (data) {
    console.log(`📊 Data:`, JSON.stringify(data, null, 2));
  }
  console.log('─'.repeat(50));
}

function debugError(module, error, context = null) {
  const timestamp = new Date().toISOString();
  console.error(`\n❌ [${timestamp}] ${module} ERROR:`, error.message);
  if (context) {
    console.error(`📝 Context:`, JSON.stringify(context, null, 2));
  }
  console.log('─'.repeat(50));
}

function debugWarn(module, warning, data = null) {
  const timestamp = new Date().toISOString();
  console.warn(`\n⚠️ [${timestamp}] ${module} WARNING: ${warning}`);
  if (data) console.warn(`📝 Details:`, data);
  console.log('─'.repeat(50));
}

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

  debugLog("DATA_LOADER", "CSV data loaded", {
    categories: categories.length,
    galleries: galleries.length,
    categoriesSample: categories.slice(0, 3),
    galleriesSample: galleries.slice(0, 3)
  });
  
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
    debugLog("GPT_INTERPRETER", "Analyzing user message", { userMessage });

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    const interpretation = JSON.parse(res.choices[0].message.content.trim());
    
    debugLog("GPT_INTERPRETER", "Analysis completed", {
      interpretation,
      usage: res.usage
    });

    return interpretation;
  } catch (err) {
    debugError("GPT_INTERPRETER", err, { userMessage });
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
  
  const results = scored.slice(0, 3).filter((x) => x.score > 0);
  
  debugLog("CATEGORY_MATCHER", "Top categories found", {
    productTerm,
    tokens,
    results: results.map(r => ({ name: r.name, score: r.score, id: r.id }))
  });
  
  return results;
}

function filterGalleries(productTerm, classifier) {
  const classifierKey = Object.keys(CLASSIFIERS).find(
    (k) => normalize(k) === normalize(classifier)
  );
  const classifierId = CLASSIFIERS[classifierKey];

  debugLog("GALLERY_FILTER", "Starting gallery filtering", {
    productTerm,
    classifier,
    classifierKey,
    classifierId
  });

  if (!classifierId) {
    debugWarn("GALLERY_FILTER", "Classifier not found", { 
      classifier, 
      availableClassifiers: Object.keys(CLASSIFIERS) 
    });
    return { rows: [], topCats: [], classifierId: null };
  }

  const topCats = top3CategoriesForProduct(productTerm);
  const topIds = topCats.map((x) => x.id);

  // Step 1: keep galleries with this classifier cat_id
  const step1 = galleries.filter((g) => g.cat_id === classifierId);
  
  debugLog("GALLERY_FILTER", "After classifier filter", {
    classifierId,
    step1Count: step1.length,
    step1Sample: step1.slice(0, 3)
  });

  // Step 2: filter by cat1 containing any of the top 3 product IDs
  const step2 = step1.filter((g) =>
    g.cat1.some((id) => topIds.includes(id))
  );

  debugLog("GALLERY_FILTER", "After category ID filter", {
    topIds,
    step2Count: step2.length,
    step2Sample: step2.slice(0, 3)
  });

  return { rows: step2, topCats, classifierId };
}

function buildLinks(rows) {
  const unique = [...new Set(rows.map((r) => r.type2))];
  const links = unique.slice(0, 5).map((x) => `app.zulu.club/${encodeURIComponent(x)}`);
  
  debugLog("LINK_BUILDER", "Generated links", {
    inputRows: rows.length,
    uniqueType2: unique.length,
    generatedLinks: links
  });
  
  return links;
}

// -------------------- GALLABOX SENDER --------------------
async function sendMessage(to, name, message) {
  try {
    debugLog("MESSAGE_SENDER", "Sending message", {
      to,
      name,
      messageLength: message.length,
      messagePreview: message.substring(0, 100) + "..."
    });

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
    
    debugLog("MESSAGE_SENDER", "Message sent successfully", { to });
    console.log(`✅ Sent to ${to}`);
  } catch (err) {
    debugError("MESSAGE_SENDER", err, { to, name });
    console.error("❌ Send error:", err.message);
  }
}

// -------------------- MESSAGE HANDLER --------------------
async function handleMessage(userPhone, userName, userMessage) {
  const sessionId = `${userPhone}-${Date.now()}`;
  
  debugLog("MESSAGE_HANDLER", "New message received", {
    sessionId,
    userPhone,
    userName,
    userMessage
  });

  const intent = await interpretMessage(userMessage);
  debugLog("MESSAGE_HANDLER", "Intent analysis completed", {
    sessionId,
    intent
  });

  if (intent.intent === "greeting") {
    debugLog("MESSAGE_HANDLER", "Processing greeting intent", { sessionId });
    return sendMessage(userPhone, userName, "Hey 👋 How can I help you shop today?");
  }

  if (intent.intent === "company_info") {
    debugLog("MESSAGE_HANDLER", "Processing company_info intent", { sessionId });
    return sendMessage(
      userPhone,
      userName,
      "We're building a new way to shop and discover lifestyle products online. We all love visiting a premium store — exploring new arrivals, discovering chic home pieces, finding stylish outfits, or picking adorable toys for kids. But we know making time for mall visits isn't always easy. Traffic, work, busy schedules… it happens. Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep. Browse and shop high-quality lifestyle products across categories you love: - Women's Fashion — dresses, tops, co-ords, winterwear, loungewear & more - Men's Fashion — shirts, tees, jackets, athleisure & more - Kids — clothing, toys, learning kits & accessories - Footwear — sneakers, heels, flats, sandals & kids shoes - Home Decor — showpieces, vases, lamps, aroma decor, premium home accessories - Beauty & Self-Care — skincare, bodycare, fragrances & grooming essentials - Fashion Accessories — bags, jewelry, watches, sunglasses & belts - Lifestyle Gifting — curated gift sets & décor-based gifting And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free. We're bringing the magic of premium in-store shopping to your home — curated, fast, and elevated. Now live in Gurgaon Experience us at our pop-ups: AIPL Joy Street & AIPL Central Explore & shop on zulu.club "
    );
  }

  if (intent.intent === "product_search") {
    debugLog("MESSAGE_HANDLER", "Processing product_search intent", { 
      sessionId,
      product_term: intent.product_term,
      classifier: intent.classifier,
      need_classifier: intent.need_classifier
    });

    if (intent.need_classifier) {
      debugLog("MESSAGE_HANDLER", "Classifier needed, asking user", { sessionId });
      return sendMessage(userPhone, userName, "Would you like it for *men, women,* or *kids*? 👕👗👶");
    }

    const { rows, topCats } = filterGalleries(intent.product_term, intent.classifier);

    debugLog("MESSAGE_HANDLER", "Product search results", {
      sessionId,
      productTerm: intent.product_term,
      classifier: intent.classifier,
      foundGalleries: rows.length,
      topCategories: topCats
    });

    if (!rows.length) {
      debugLog("MESSAGE_HANDLER", "No results found", { sessionId });
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

    debugLog("MESSAGE_HANDLER", "Sending results to user", {
      sessionId,
      responseLength: response.length,
      linksCount: links.length
    });

    return sendMessage(userPhone, userName, response);
  }

  debugLog("MESSAGE_HANDLER", "Fallback response", { sessionId });
  return sendMessage(userPhone, userName, "Hi there! What product are you looking for?");
}

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  const webhookId = `webhook-${Date.now()}`;
  
  debugLog("WEBHOOK", "Incoming webhook request", {
    webhookId,
    headers: req.headers,
    bodyKeys: Object.keys(req.body),
    fullBody: req.body
  });

  try {
    const msg = req.body?.whatsapp?.text?.body?.trim();
    const phone = req.body?.whatsapp?.from;
    const name = req.body?.contact?.name || "Customer";

    debugLog("WEBHOOK", "Parsed webhook data", {
      webhookId,
      msg,
      phone,
      name,
      whatsappKeys: req.body?.whatsapp ? Object.keys(req.body.whatsapp) : 'NO_WHATSAPP_KEY',
      contactKeys: req.body?.contact ? Object.keys(req.body.contact) : 'NO_CONTACT_KEY'
    });

    if (!msg || !phone) {
      debugWarn("WEBHOOK", "Invalid webhook payload - missing msg or phone", {
        webhookId,
        hasMsg: !!msg,
        hasPhone: !!phone,
        bodyStructure: {
          whatsapp: req.body?.whatsapp ? {
            text: req.body.whatsapp.text ? {
              body: req.body.whatsapp.text.body ? 'PRESENT' : 'MISSING'
            } : 'NO_TEXT',
            from: req.body.whatsapp.from ? 'PRESENT' : 'MISSING'
          } : 'NO_WHATSAPP',
          contact: req.body?.contact ? 'PRESENT' : 'NO_CONTACT'
        }
      });
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    debugLog("WEBHOOK", "Webhook payload validated", {
      webhookId,
      phone,
      name,
      messageLength: msg.length
    });

    await handleMessage(phone, name, msg);
    
    debugLog("WEBHOOK", "Webhook processing completed", { webhookId });
    res.status(200).json({ success: true });
  } catch (err) {
    debugError("WEBHOOK", err, { webhookId });
    console.error("💥 Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- HEALTH --------------------
app.get("/", (req, res) => {
  const healthInfo = {
    status: "✅ Zulu Club Product Assistant",
    version: "8.0 - Strict CSV Logic - DEBUG",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    classifiers: Object.keys(CLASSIFIERS),
    timestamp: new Date().toISOString(),
  };
  
  debugLog("HEALTH_CHECK", "Health check requested", healthInfo);
  
  res.json(healthInfo);
});

// -------------------- START --------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Zulu Club Assistant running on port ${PORT}`);
    console.log('═'.repeat(60));
    console.log('🔍 DEBUG MODE: Enhanced logging enabled');
    console.log('📊 Endpoints:');
    console.log('   • POST /webhook - WhatsApp webhook');
    console.log('   • GET / - Health check');
    console.log('═'.repeat(60));
  });
});

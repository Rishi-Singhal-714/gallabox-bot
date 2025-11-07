// --------------------------------------------
// ZULU CLUB - Single CSV GPT Matching Logic
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

// GitHub CSV URL - Only one CSV now
const galleriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv";

// -------------------- DATA --------------------
let galleries = [];

// Category mapping
const CATEGORY_NAMES = {
  1869: "Men",
  1870: "Women", 
  1873: "Kids",
  1874: "Home",
  2105: "Wellness",
  2119: "Metals",
  2130: "Food",
  2132: "Electronics",
  2135: "Gadgets",
  2136: "Discover"
};

// Company Information
const COMPANY_INFO = `We're building a new way to shop and discover lifestyle products online.

We all love visiting a premium store — exploring new arrivals, discovering chic home pieces, finding stylish outfits, or picking adorable toys for kids. But we know making time for mall visits isn't always easy. Traffic, work, busy schedules… it happens.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love:

- Women's Fashion — dresses, tops, co-ords, winterwear, loungewear & more
- Men's Fashion — shirts, tees, jackets, athleisure & more
- Kids — clothing, toys, learning kits & accessories
- Footwear — sneakers, heels, flats, sandals & kids shoes
- Home Decor — showpieces, vases, lamps, aroma decor, premium home accessories
- Beauty & Self-Care — skincare, bodycare, fragrances & grooming essentials
- Fashion Accessories — bags, jewelry, watches, sunglasses & belts
- Lifestyle Gifting — curated gift sets & décor-based gifting

And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.

We're bringing the magic of premium in-store shopping to your home — curated, fast, and elevated.

Now live in only Gurgaon india 
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on zulu.club`;

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

// -------------------- CSV LOADER --------------------
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
      ? arr.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function loadCSVData() {
  const galRows = await fetchCSV(galleriesUrl);

  galleries = galRows
    .filter((r) => r.cat_id && r.type2 && r.cat1)
    .map((r) => ({
      cat_id: Number(r.cat_id),
      type2: String(r.type2).trim(),
      cat1: safeParseCat1(r.cat1),
      original: r
    }));

  debugLog("DATA_LOADER", "Galleries CSV loaded", {
    galleries: galleries.length,
    sample: galleries.slice(0, 3),
    categoryCounts: Object.keys(CATEGORY_NAMES).reduce((acc, catId) => {
      acc[CATEGORY_NAMES[catId]] = galleries.filter(g => g.cat_id === Number(catId)).length;
      return acc;
    }, {})
  });
  
  console.log(`✅ Loaded ${galleries.length} galleries from single CSV`);
}

// -------------------- GPT PRODUCT MATCHER --------------------
async function findProductsWithGPT(userMessage) {
  // Prepare galleries data for GPT
  const galleriesData = galleries.map(g => ({
    category: CATEGORY_NAMES[g.cat_id] || `Category-${g.cat_id}`,
    type2: g.type2,
    product_keywords: g.cat1
  }));

  const sysPrompt = `
You are a shopping assistant for Zulu Club. Analyze the user's message and find matching products from our galleries.

GALLERIES DATA:
${JSON.stringify(galleriesData, null, 2)}

CATEGORIES:
- Men (cat_id: 1869)
- Women (cat_id: 1870) 
- Kids (cat_id: 1873)
- Home (cat_id: 1874)
- Wellness (cat_id: 2105)
- Metals (cat_id: 2119)
- Food (cat_id: 2130)
- Electronics (cat_id: 2132)
- Gadgets (cat_id: 2135)
- Discover (cat_id: 2136)

COMPANY INFO: 
${COMPANY_INFO}

INSTRUCTIONS:
1. First, determine if the user wants company info or product search
2. For product search, extract the product keyword (tshirt, jeans, sarees, etc.)
3. Find all galleries where product_keywords contain similar terms to the user's product
4. Group results by category (Men, Women, Kids, etc.)
5. Return type2 links for each category

Return JSON with:
- intent: "company_info" | "product_search"
- product_keyword: extracted product term (if product search)
- results: { 
    "Men": { found: boolean, links: string[] },
    "Women": { found: boolean, links: string[] },
    "Kids": { found: boolean, links: string[] },
    "Home": { found: boolean, links: string[] },
    "Wellness": { found: boolean, links: string[] },
    "Metals": { found: boolean, links: string[] },
    "Food": { found: boolean, links: string[] },
    "Electronics": { found: boolean, links: string[] },
    "Gadgets": { found: boolean, links: string[] },
    "Discover": { found: boolean, links: string[] }
  }
- reasoning: brief explanation of matching logic

Example response for "tshirt":
{
  "intent": "product_search",
  "product_keyword": "tshirt",
  "results": {
    "Men": { "found": true, "links": ["app.zulu.club/men-tshirt1", "app.zulu.club/men-tshirt2"] },
    "Women": { "found": true, "links": ["app.zulu.club/women-tshirt1"] },
    "Kids": { "found": false, "links": [] }
    ... other categories
  }
}
`;

  try {
    debugLog("GPT_MATCHER", "Finding products with GPT", { userMessage });

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(res.choices[0].message.content.trim());
    
    debugLog("GPT_MATCHER", "Product matching completed", {
      intent: result.intent,
      product_keyword: result.product_keyword,
      resultsSummary: Object.keys(result.results || {}).reduce((acc, category) => {
        acc[category] = `${result.results[category].links.length} links`;
        return acc;
      }, {}),
      reasoning: result.reasoning
    });

    return result;
  } catch (error) {
    debugError("GPT_MATCHER", error, { userMessage });
    return { 
      intent: "product_search", 
      product_keyword: userMessage,
      results: {},
      reasoning: "GPT matching failed"
    };
  }
}

// -------------------- RESPONSE BUILDER --------------------
function buildProductResponse(gptResult) {
  const { product_keyword, results } = gptResult;
  
  let response = `Here are your *${product_keyword}* search results:\n\n`;
  let hasAnyResults = false;

  // Add results for each category
  Object.keys(results).forEach(category => {
    const categoryData = results[category];
    
    if (categoryData.found && categoryData.links.length > 0) {
      hasAnyResults = true;
      response += `*${category} ${product_keyword} Galleries:*\n`;
      categoryData.links.forEach(link => {
        response += `• ${link}\n`;
      });
      response += `\n`;
    } else {
      response += `*${category} ${product_keyword} Galleries:*\n`;
      response += `No galleries found for ${category.toLowerCase()}\n\n`;
    }
  });

  if (!hasAnyResults) {
    return `Sorry, I couldn't find any *${product_keyword}* options across all categories. Try searching for something else! 🔍`;
  }

  response += `\n🛒 Explore more on app.zulu.club`;
  return response;
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

  try {
    const gptResult = await findProductsWithGPT(userMessage);
    
    debugLog("MESSAGE_HANDLER", "GPT processing completed", {
      sessionId,
      intent: gptResult.intent,
      product_keyword: gptResult.product_keyword
    });

    if (gptResult.intent === "company_info") {
      debugLog("MESSAGE_HANDLER", "Sending company info", { sessionId });
      return sendMessage(userPhone, userName, COMPANY_INFO);
    }

    if (gptResult.intent === "product_search") {
      debugLog("MESSAGE_HANDLER", "Building product response", {
        sessionId,
        product_keyword: gptResult.product_keyword,
        resultsCount: Object.keys(gptResult.results).length
      });

      const response = buildProductResponse(gptResult);
      return sendMessage(userPhone, userName, response);
    }

    // Fallback for any other intent
    debugLog("MESSAGE_HANDLER", "Fallback response", { sessionId });
    return sendMessage(userPhone, userName, "Hi there! What product are you looking for today? 👕👗🛍️");

  } catch (error) {
    debugError("MESSAGE_HANDLER", error, { sessionId, userMessage });
    return sendMessage(
      userPhone, 
      userName, 
      "Sorry, I'm having trouble right now. Please try again or visit app.zulu.club directly! 🛒"
    );
  }
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
    status: "✅ Zulu Club GPT Product Matcher",
    version: "1.0 - Single CSV GPT Logic",
    galleriesLoaded: galleries.length,
    categories: CATEGORY_NAMES,
    timestamp: new Date().toISOString(),
  };
  
  debugLog("HEALTH_CHECK", "Health check requested", healthInfo);
  
  res.json(healthInfo);
});

// -------------------- START --------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Zulu Club GPT Assistant running on port ${PORT}`);
    console.log('═'.repeat(60));
    console.log('🎯 NEW FEATURES:');
    console.log('   • Single CSV Processing');
    console.log('   • GPT-Powered Product Matching');
    console.log('   • Category-wise Results');
    console.log('   • Automatic Company Info Responses');
    console.log('📊 Endpoints:');
    console.log('   • POST /webhook - WhatsApp webhook');
    console.log('   • GET / - Health check');
    console.log('═'.repeat(60));
  });
});

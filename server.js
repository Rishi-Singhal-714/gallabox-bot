// --------------------------------------------
// ZULU CLUB - Single CSV GPT Product Matcher
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

// GitHub CSV URL
const galleriesUrl =
  "https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv";

// -------------------- DATA --------------------
let galleries = [];

// Category mapping by ID
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
  
  console.log(`✅ Loaded ${galleries.length} galleries from CSV`);
}

// -------------------- GPT PRODUCT MATCHER --------------------
async function analyzeUserMessage(userMessage) {
  // Prepare galleries data for GPT
  const galleriesData = galleries.map(g => ({
    category: CATEGORY_NAMES[g.cat_id] || `Category-${g.cat_id}`,
    type2: g.type2,
    product_keywords: g.cat1
  }));

  const sysPrompt = `
You are a shopping assistant for Zulu Club. Analyze the user's message and:

1. FIRST, check if the user is asking about the company - if yes, return "company_info" intent
2. If not, check if they are looking for products - if yes, extract the main product keyword
3. Use the galleries data to find matching products

GALLERIES DATA:
${JSON.stringify(galleriesData, null, 2)}

COMPANY INFO: 
${COMPANY_INFO}

INSTRUCTIONS:
- If user asks about company, team, what is zulu club, about us → return "company_info"
- If user asks for products → extract product keyword and return "product_search"
- For product search, find the main product term (tshirt, jeans, sarees, etc.)

Return ONLY JSON with:
{
  "intent": "company_info" | "product_search",
  "product_keyword": "extracted product term" (only for product_search),
  "reasoning": "brief explanation"
}

Examples:
User: "What is Zulu Club?" → {"intent": "company_info", "product_keyword": "", "reasoning": "User asked about company"}
User: "I need tshirt" → {"intent": "product_search", "product_keyword": "tshirt", "reasoning": "User looking for tshirt"}
User: "Show me jeans" → {"intent": "product_search", "product_keyword": "jeans", "reasoning": "User wants jeans"}
`;

  try {
    debugLog("GPT_ANALYZER", "Analyzing user message", { userMessage });

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(res.choices[0].message.content.trim());
    
    debugLog("GPT_ANALYZER", "Analysis completed", result);

    return result;
  } catch (error) {
    debugError("GPT_ANALYZER", error, { userMessage });
    return { 
      intent: "product_search", 
      product_keyword: userMessage,
      reasoning: "GPT analysis failed, defaulting to product search"
    };
  }
}

// -------------------- PRODUCT SEARCH LOGIC --------------------
function searchProducts(productKeyword) {
  debugLog("PRODUCT_SEARCH", "Starting product search", { productKeyword });
  
  const results = {};
  
  // Initialize all categories
  Object.values(CATEGORY_NAMES).forEach(category => {
    results[category] = { found: false, links: [] };
  });

  // Search through all galleries
  galleries.forEach(gallery => {
    const categoryName = CATEGORY_NAMES[gallery.cat_id];
    if (!categoryName) return;

    // Check if any keyword in cat1 matches the product keyword
    const hasMatch = gallery.cat1.some(keyword => 
      keyword.includes(productKeyword.toLowerCase()) || 
      productKeyword.toLowerCase().includes(keyword)
    );

    if (hasMatch) {
      results[categoryName].found = true;
      if (!results[categoryName].links.includes(gallery.type2)) {
        results[categoryName].links.push(gallery.type2);
      }
    }
  });

  debugLog("PRODUCT_SEARCH", "Search results", {
    productKeyword,
    results: Object.keys(results).reduce((acc, category) => {
      acc[category] = `${results[category].links.length} links`;
      return acc;
    }, {})
  });

  return results;
}

// -------------------- RESPONSE BUILDER --------------------
function buildProductResponse(productKeyword, searchResults) {
  debugLog("RESPONSE_BUILDER", "Building product response", {
    productKeyword,
    results: searchResults
  });

  let response = `Here are your *${productKeyword}* search results:\n\n`;
  let hasAnyResults = false;

  // Add results for each category
  Object.keys(searchResults).forEach(category => {
    const categoryData = searchResults[category];
    
    response += `*${category} ${productKeyword} Galleries*\n`;
    
    if (categoryData.found && categoryData.links.length > 0) {
      hasAnyResults = true;
      categoryData.links.forEach(link => {
        response += `• ${link}\n`;
      });
    } else {
      response += `No galleries found for ${category.toLowerCase()}\n`;
    }
    response += `\n`;
  });

  if (!hasAnyResults) {
    return `Sorry, I couldn't find any *${productKeyword}* options across all categories. Try searching for something else! 🔍`;
  }

  response += `🛒 Explore more on app.zulu.club`;
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
    // Step 1: Analyze user message with GPT
    const analysis = await analyzeUserMessage(userMessage);
    
    debugLog("MESSAGE_HANDLER", "Message analysis completed", {
      sessionId,
      intent: analysis.intent,
      product_keyword: analysis.product_keyword
    });

    // Step 2: Handle based on intent
    if (analysis.intent === "company_info") {
      debugLog("MESSAGE_HANDLER", "Sending company info", { sessionId });
      return sendMessage(userPhone, userName, COMPANY_INFO);
    }

    if (analysis.intent === "product_search" && analysis.product_keyword) {
      debugLog("MESSAGE_HANDLER", "Processing product search", {
        sessionId,
        product_keyword: analysis.product_keyword
      });

      // Step 3: Search for products in galleries
      const searchResults = searchProducts(analysis.product_keyword);
      
      // Step 4: Build and send response
      const response = buildProductResponse(analysis.product_keyword, searchResults);
      return sendMessage(userPhone, userName, response);
    }

    // Fallback for unclear product search
    debugLog("MESSAGE_HANDLER", "Unclear product search", { sessionId });
    return sendMessage(
      userPhone, 
      userName, 
      "I'd love to help you find products! Could you tell me what specific item you're looking for? For example: 'tshirt', 'jeans', 'sarees', etc. 👕👗🛍️"
    );

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
    status: "✅ Zulu Club Product Matcher",
    version: "1.0 - Single CSV Logic",
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
    console.log(`\n🚀 Zulu Club Assistant running on port ${PORT}`);
    console.log('═'.repeat(60));
    console.log('🎯 LOGIC FLOW:');
    console.log('   1. User message → GPT analyzes intent');
    console.log('   2. If company_info → Send COMPANY_INFO');
    console.log('   3. If product_search → Search galleries CSV');
    console.log('   4. Show results by category (Men/Women/Kids/etc)');
    console.log('   5. Format: "Category Product Galleries" + links');
    console.log('📊 Endpoints:');
    console.log('   • POST /webhook - WhatsApp webhook');
    console.log('   • GET / - Health check');
    console.log('═'.repeat(60));
  });
});

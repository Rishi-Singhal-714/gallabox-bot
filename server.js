// --------------------------------------------
// ZULU CLUB - Enhanced AI Response System
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

// -------------------- DEBUG LOGGER --------------------
class DebugLogger {
  static log(module, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`\n🔍 [${timestamp}] ${module}: ${message}`);
    if (data) {
      console.log(`📊 Data:`, JSON.stringify(data, null, 2));
    }
    console.log('─'.repeat(50));
  }

  static error(module, error, context = null) {
    const timestamp = new Date().toISOString();
    console.error(`\n❌ [${timestamp}] ${module} ERROR:`, error.message);
    if (context) {
      console.error(`📝 Context:`, JSON.stringify(context, null, 2));
    }
    if (error.stack) {
      console.error(`🔦 Stack:`, error.stack);
    }
    console.log('─'.repeat(50));
  }

  static warn(module, warning, data = null) {
    const timestamp = new Date().toISOString();
    console.warn(`\n⚠️ [${timestamp}] ${module} WARNING: ${warning}`);
    if (data) console.warn(`📝 Details:`, data);
    console.log('─'.repeat(50));
  }
}

// -------------------- ENHANCED CSV LOADERS --------------------
async function fetchCSV(url) {
  try {
    DebugLogger.log("CSV_LOADER", `Fetching CSV from: ${url}`);
    const res = await axios.get(url, { 
      responseType: "text",
      timeout: 10000 
    });
    
    DebugLogger.log("CSV_LOADER", `CSV fetched successfully`, {
      size: res.data.length,
      firstLines: res.data.split('\n').slice(0, 3)
    });
    
    return new Promise((resolve, reject) => {
      const rows = [];
      Readable.from(res.data)
        .pipe(csv())
        .on("data", (r) => rows.push(r))
        .on("end", () => {
          DebugLogger.log("CSV_LOADER", `Parsed ${rows.length} rows`);
          resolve(rows);
        })
        .on("error", (error) => {
          DebugLogger.error("CSV_LOADER", error, { url });
          reject(error);
        });
    });
  } catch (error) {
    DebugLogger.error("CSV_LOADER", error, { url });
    throw error;
  }
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
  } catch (error) {
    DebugLogger.warn("CSV_PARSER", `Failed to parse cat1: ${raw}`, { error: error.message });
    return [];
  }
}

async function loadCSVData() {
  try {
    DebugLogger.log("DATA_LOADER", "Starting CSV data loading...");
    
    const [catRows, galRows] = await Promise.all([
      fetchCSV(categoriesUrl),
      fetchCSV(galleriesUrl),
    ]);

    // Enhanced category processing
    categories = catRows
      .filter((r) => r.id && r.name)
      .map((r) => ({ 
        id: Number(r.id), 
        name: String(r.name).trim(),
        original: r 
      }));

    // Enhanced gallery processing
    galleries = galRows
      .filter((r) => r.cat_id && r.type2 && r.cat1)
      .map((r) => ({
        cat_id: Number(r.cat_id),
        type2: String(r.type2).trim(),
        cat1: safeParseCat1(r.cat1),
        original: r
      }));

    DebugLogger.log("DATA_LOADER", "Data loading completed", {
      categories: {
        total: categories.length,
        sample: categories.slice(0, 3)
      },
      galleries: {
        total: galleries.length,
        sample: galleries.slice(0, 3)
      },
      classifiers: CLASSIFIERS
    });

    console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries`);
  } catch (error) {
    DebugLogger.error("DATA_LOADER", error);
    throw error;
  }
}

// -------------------- ENHANCED GPT INTERPRETER --------------------
async function interpretMessage(userMessage) {
  const sysPrompt = `
You are a shopping assistant classifier for Zulu Club. Analyze the user's message and extract:

CRITICAL RULES:
- classifier MUST be one of: men, women, kids, home, wellness, metals, food, electronics, gadgets, discover
- product_term should be specific (e.g., "jeans", "t-shirt", "home decor")
- be precise with category matching

Return JSON with:
- intent: "product_search" | "greeting" | "company_info" | "help" | "fallback"
- product_term: specific product being searched for
- classifier: exact category from the list above
- need_classifier: true if classifier is missing but required
- confidence: 0.0 to 1.0 (how confident you are in the classification)
- reasoning: brief explanation of your classification

Examples:
User: "I want jeans for men" → {"intent":"product_search","product_term":"jeans","classifier":"men","need_classifier":false,"confidence":0.95,"reasoning":"Clear product and category"}
User: "Hello" → {"intent":"greeting","product_term":null,"classifier":null,"need_classifier":false,"confidence":0.98,"reasoning":"Simple greeting"}
User: "What is Zulu Club?" → {"intent":"company_info","product_term":null,"classifier":null,"need_classifier":false,"confidence":0.99,"reasoning":"Asking about company"}
`;

  try {
    DebugLogger.log("GPT_INTERPRETER", "Analyzing user message", { userMessage });

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
    
    DebugLogger.log("GPT_INTERPRETER", "Analysis completed", {
      interpretation,
      usage: res.usage
    });

    return interpretation;
  } catch (error) {
    DebugLogger.error("GPT_INTERPRETER", error, { userMessage });
    return { 
      intent: "fallback", 
      product_term: userMessage, 
      classifier: null, 
      need_classifier: true,
      confidence: 0.1,
      reasoning: "GPT parsing failed, using fallback"
    };
  }
}

// -------------------- ENHANCED CATEGORY SEARCH LOGIC --------------------
function normalize(str) {
  return String(str).toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(str) {
  return normalize(str).split(" ").filter(Boolean);
}

function calculateMatchScore(productTokens, categoryName) {
  const categoryTokens = tokenize(categoryName);
  let score = 0;
  
  // Exact matches get highest score
  productTokens.forEach(token => {
    categoryTokens.forEach(catToken => {
      if (catToken === token) score += 3;
      else if (catToken.includes(token) || token.includes(catToken)) score += 1;
      else if (catToken.startsWith(token) || token.startsWith(catToken)) score += 2;
    });
  });

  // Bonus for longer matches and exact phrase matches
  const productPhrase = productTokens.join(' ');
  const categoryPhrase = categoryTokens.join(' ');
  
  if (categoryPhrase.includes(productPhrase)) score += 5;
  if (productPhrase.includes(categoryPhrase)) score += 3;

  return score;
}

function top3CategoriesForProduct(productTerm) {
  const tokens = tokenize(productTerm);
  
  const scored = categories.map((c) => {
    const score = calculateMatchScore(tokens, c.name);
    return { 
      id: c.id, 
      name: c.name, 
      score: score,
      tokens: tokens,
      categoryTokens: tokenize(c.name)
    };
  });

  scored.sort((a, b) => b.score - a.score);
  
  const topResults = scored.slice(0, 5).filter((x) => x.score > 0);
  
  DebugLogger.log("CATEGORY_MATCHER", "Category matching results", {
    productTerm,
    tokens,
    topResults: topResults.map(r => ({ name: r.name, score: r.score, id: r.id })),
    allScores: scored.filter(s => s.score > 0).map(s => ({ name: s.name, score: s.score }))
  });

  return topResults.slice(0, 3);
}

function filterGalleries(productTerm, classifier) {
  const classifierKey = Object.keys(CLASSIFIERS).find(
    (k) => normalize(k) === normalize(classifier)
  );
  const classifierId = CLASSIFIERS[classifierKey];

  DebugLogger.log("GALLERY_FILTER", "Starting gallery filtering", {
    productTerm,
    classifier,
    classifierKey,
    classifierId
  });

  if (!classifierId) {
    DebugLogger.warn("GALLERY_FILTER", "Classifier not found", { classifier, available: Object.keys(CLASSIFIERS) });
    return { rows: [], topCats: [], classifierId: null };
  }

  const topCats = top3CategoriesForProduct(productTerm);
  const topIds = topCats.map((x) => x.id);

  // Step 1: keep galleries with this classifier cat_id
  const step1 = galleries.filter((g) => g.cat_id === classifierId);
  
  DebugLogger.log("GALLERY_FILTER", "After classifier filter", {
    classifierId,
    step1Count: step1.length,
    step1Sample: step1.slice(0, 3)
  });

  // Step 2: filter by cat1 containing any of the top product category IDs
  const step2 = step1.filter((g) =>
    g.cat1.some((id) => topIds.includes(id))
  );

  DebugLogger.log("GALLERY_FILTER", "After category ID filter", {
    topIds,
    step2Count: step2.length,
    step2Sample: step2.slice(0, 3),
    matchingCombinations: step2.map(g => ({
      type2: g.type2,
      matchingCat1: g.cat1.filter(id => topIds.includes(id))
    }))
  });

  return { rows: step2, topCats, classifierId };
}

function buildLinks(rows) {
  const unique = [...new Set(rows.map((r) => r.type2))];
  const links = unique.slice(0, 5).map((x) => `app.zulu.club/${encodeURIComponent(x)}`);
  
  DebugLogger.log("LINK_BUILDER", "Generated links", {
    inputRows: rows.length,
    uniqueType2: unique.length,
    generatedLinks: links
  });
  
  return links;
}

// -------------------- AI RESPONSE GENERATOR --------------------
async function generateAIResponse(intent, context = {}) {
  const responseTemplates = {
    greeting: `Hey 👋 Welcome to Zulu Club! I'm your personal shopping assistant. I can help you discover amazing products across fashion, home decor, electronics, and more. What are you looking for today?`,

    help: `I can help you shop for various products! Here's what I can do:

🔍 *Product Search* - Tell me what you're looking for (e.g., "jeans for men", "home decor items")
🏪 *Company Info* - Learn about Zulu Club
🎯 *Categories* - men, women, kids, home, wellness, electronics, gadgets, food, metals, discover

Just tell me what product you're interested in and who it's for!`,

    no_results: `I searched for *${context.productTerm}* in *${context.classifier}* category, but couldn't find exact matches. 😔

Try these tips:
• Use simpler terms (e.g., "shirt" instead of "formal office shirt")
• Check other categories
• Browse directly: app.zulu.club

What else can I help you find?`,

    results_found: `Great! I found ${context.resultCount} options for *${context.productTerm}* in *${context.classifier}* category 🎉

${context.links.join('\n')}

🛒 *More options:* app.zulu.club
💡 *Need help?* Just ask!`,

    fallback: `I'm not sure I understand. I'm here to help you shop for:
• 👕 Fashion (men, women, kids)
• 🏠 Home & Decor
• 📱 Electronics & Gadgets
• 🍔 Food & Wellness
• 💎 Metals & More

What specific product are you looking for?`
  };

  // Use AI to generate dynamic responses for complex cases
  if (intent === 'product_search' && context.hasResults) {
    try {
      const dynamicPrompt = `
Generate a friendly, engaging WhatsApp message for a shopping assistant. Context:
- Product: ${context.productTerm}
- Category: ${context.classifier}
- Results found: ${context.resultCount}
- Links: ${context.links.join(', ')}

Make it:
- Friendly and emoji-rich
- Encouraging but not pushy
- Include the product and category
- Mention the results count
- Keep it under 2 sentences plus links
- No markdown, just WhatsApp formatting`;

      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: dynamicPrompt }],
        max_tokens: 100,
        temperature: 0.7
      });

      return res.choices[0].message.content.trim();
    } catch (error) {
      DebugLogger.warn("AI_RESPONSE", "Failed to generate dynamic response, using template", error);
      return responseTemplates.results_found
        .replace('${context.productTerm}', context.productTerm)
        .replace('${context.classifier}', context.classifier)
        .replace('${context.resultCount}', context.resultCount)
        .replace('${context.links.join(\'\\n\')}', context.links.join('\n'));
    }
  }

  return responseTemplates[intent] || responseTemplates.fallback;
}

// -------------------- ENHANCED GALLABOX SENDER --------------------
async function sendMessage(to, name, message, context = {}) {
  try {
    DebugLogger.log("MESSAGE_SENDER", "Sending message", {
      to,
      name,
      messageLength: message.length,
      context
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
        timeout: 10000
      }
    );
    
    DebugLogger.log("MESSAGE_SENDER", "Message sent successfully", { to });
    return true;
  } catch (error) {
    DebugLogger.error("MESSAGE_SENDER", error, { to, name, messageLength: message.length });
    return false;
  }
}

// -------------------- ENHANCED MESSAGE HANDLER --------------------
async function handleMessage(userPhone, userName, userMessage) {
  const sessionId = `${userPhone}-${Date.now()}`;
  
  DebugLogger.log("MESSAGE_HANDLER", "New message received", {
    sessionId,
    userPhone,
    userName,
    userMessage
  });

  try {
    const intent = await interpretMessage(userMessage);
    
    DebugLogger.log("MESSAGE_HANDLER", "Intent analysis completed", {
      sessionId,
      intent
    });

    switch (intent.intent) {
      case "greeting":
        const greetingMsg = await generateAIResponse('greeting');
        await sendMessage(userPhone, userName, greetingMsg, { sessionId, intent });
        break;

      case "company_info":
        const companyMsg = await generateAIResponse('company_info');
        await sendMessage(userPhone, userName, companyMsg, { sessionId, intent });
        break;

      case "help":
        const helpMsg = await generateAIResponse('help');
        await sendMessage(userPhone, userName, helpMsg, { sessionId, intent });
        break;

      case "product_search":
        if (intent.need_classifier || !intent.classifier) {
          const classifierMsg = "Would you like it for *men, women, kids, home, electronics, gadgets, wellness, food, metals,* or *discover*? 👕👗👶🏠📱";
          await sendMessage(userPhone, userName, classifierMsg, { sessionId, intent });
          break;
        }

        const { rows, topCats } = filterGalleries(intent.product_term, intent.classifier);
        
        DebugLogger.log("MESSAGE_HANDLER", "Product search results", {
          sessionId,
          productTerm: intent.product_term,
          classifier: intent.classifier,
          foundGalleries: rows.length,
          topCategories: topCats
        });

        if (!rows.length) {
          const noResultsMsg = await generateAIResponse('no_results', {
            productTerm: intent.product_term,
            classifier: intent.classifier
          });
          await sendMessage(userPhone, userName, noResultsMsg, { 
            sessionId, 
            intent,
            searchResults: { found: 0, topCats }
          });
        } else {
          const links = buildLinks(rows);
          const resultsMsg = await generateAIResponse('product_search', {
            productTerm: intent.product_term,
            classifier: intent.classifier,
            resultCount: rows.length,
            links: links,
            hasResults: true
          });
          await sendMessage(userPhone, userName, resultsMsg, { 
            sessionId, 
            intent,
            searchResults: { found: rows.length, links, topCats }
          });
        }
        break;

      default:
        const fallbackMsg = await generateAIResponse('fallback');
        await sendMessage(userPhone, userName, fallbackMsg, { sessionId, intent });
    }

    DebugLogger.log("MESSAGE_HANDLER", "Message processing completed", { sessionId });

  } catch (error) {
    DebugLogger.error("MESSAGE_HANDLER", error, { sessionId, userPhone, userMessage });
    
    const errorMsg = "Sorry, I'm having trouble right now. Please try again in a moment or visit app.zulu.club directly! 🛒";
    await sendMessage(userPhone, userName, errorMsg, { 
      sessionId, 
      error: true 
    });
  }
}

// -------------------- ENHANCED WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  const webhookId = `webhook-${Date.now()}`;
  
  DebugLogger.log("WEBHOOK", "Incoming webhook", {
    webhookId,
    body: req.body
  });

  try {
    const msg = req.body?.whatsapp?.text?.body?.trim();
    const phone = req.body?.whatsapp?.from;
    const name = req.body?.contact?.name || "Customer";

    if (!msg || !phone) {
      DebugLogger.warn("WEBHOOK", "Invalid webhook payload", { msg, phone });
      return res.status(400).json({ error: "Invalid webhook payload", webhookId });
    }

    // Immediate response to webhook
    res.status(200).json({ 
      success: true, 
      webhookId,
      message: "Processing started"
    });

    // Process message asynchronously
    await handleMessage(phone, name, msg);

  } catch (error) {
    DebugLogger.error("WEBHOOK", error, { webhookId });
    res.status(500).json({ 
      error: "Internal server error", 
      webhookId,
      message: error.message 
    });
  }
});

// -------------------- ENHANCED HEALTH ENDPOINT --------------------
app.get("/", (req, res) => {
  const healthInfo = {
    status: "✅ Zulu Club AI Shopping Assistant",
    version: "9.0 - Enhanced AI Response System",
    data: {
      categoriesLoaded: categories.length,
      galleriesLoaded: galleries.length,
      classifiers: Object.keys(CLASSIFIERS).length
    },
    system: {
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    },
    timestamp: new Date().toISOString()
  };

  DebugLogger.log("HEALTH_CHECK", "Health check requested", healthInfo);
  
  res.json(healthInfo);
});

// -------------------- DATA REFRESH ENDPOINT --------------------
app.post("/refresh-data", async (req, res) => {
  try {
    DebugLogger.log("DATA_REFRESH", "Manual data refresh requested");
    await loadCSVData();
    res.json({ 
      success: true, 
      message: "Data refreshed successfully",
      stats: {
        categories: categories.length,
        galleries: galleries.length
      }
    });
  } catch (error) {
    DebugLogger.error("DATA_REFRESH", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// -------------------- START SERVER --------------------
async function startServer() {
  try {
    DebugLogger.log("SERVER", "Starting Zulu Club Assistant...");
    
    await loadCSVData();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`\n🎉 🚀 Zulu Club AI Assistant running on port ${PORT}`);
      console.log('═'.repeat(60));
      console.log('✅ Enhanced Features:');
      console.log('   • AI-Powered Response Generation');
      console.log('   • Advanced Debugging System');
      console.log('   • Enhanced Category Matching');
      console.log('   • Real-time Session Tracking');
      console.log('   • Dynamic Link Generation');
      console.log('═'.repeat(60));
    });
  } catch (error) {
    DebugLogger.error("SERVER", error, { message: "Failed to start server" });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  DebugLogger.log("SERVER", "Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on('SIGINT', () => {
  DebugLogger.log("SERVER", "Received SIGINT, shutting down gracefully");
  process.exit(0);
});

startServer();

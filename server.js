// ------------------------------
// ZULU CLUB AI Assistant - GitHub CSV Integrated Version
// ------------------------------
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------------
// CONFIGURATION
// ------------------------------
const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID,
  apiKey: process.env.GALLABOX_API_KEY,
  apiSecret: process.env.GALLABOX_API_SECRET,
  channelId: process.env.GALLABOX_CHANNEL_ID,
  baseUrl: 'https://server.gallabox.com/devapi'
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// ------------------------------
// GITHUB CSV URLs (convert to raw)
// ------------------------------
const categoriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
const galleriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';

// ------------------------------
// GLOBAL DATA
// ------------------------------
let categories = [];
let galleries = [];

// ------------------------------
// LOAD CSV FROM GITHUB
// ------------------------------
async function fetchCSVFromGitHub(url) {
  const response = await axios.get(url);
  const csvText = response.data;

  return new Promise((resolve, reject) => {
    const results = [];
    Readable.from(csvText)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

async function loadCSVData() {
  try {
    console.log('⬇️ Fetching CSVs from GitHub...');
    const [catRows, galRows] = await Promise.all([
      fetchCSVFromGitHub(categoriesUrl),
      fetchCSVFromGitHub(galleriesUrl)
    ]);

    categories = catRows
      .filter(r => r.id && r.name)
      .map(r => ({ id: Number(r.id), name: r.name }));

    galleries = galRows
      .filter(r => r.cat_id && r.type2 && r.cat1)
      .map(r => {
        try {
          const parsedCat1 = JSON.parse(r.cat1.replace(/'/g, '"'));
          return {
            cat_id: Number(r.cat_id),
            type2: r.type2,
            cat1: Array.isArray(parsedCat1)
              ? parsedCat1.map(Number)
              : [Number(parsedCat1)]
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries from GitHub`);
  } catch (err) {
    console.error('❌ Failed to fetch CSV data:', err.message);
  }
}

// ------------------------------
// GALLABOX MESSAGE SENDER
// ------------------------------
async function sendMessage(to, name, message) {
  try {
    const payload = {
      channelId: gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: { name, phone: to },
      whatsapp: { type: "text", text: { body: message } }
    };
    await axios.post(`${gallaboxConfig.baseUrl}/messages/whatsapp`, payload, {
      headers: {
        'apiKey': gallaboxConfig.apiKey,
        'apiSecret': gallaboxConfig.apiSecret,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Sent message to ${to}`);
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
  }
}

// ------------------------------
// GALLERY LINK GENERATOR
// ------------------------------
function getGalleryLinksByCategoryIds(catIds) {
  const filtered = galleries.filter(
    g => catIds.includes(g.cat_id) || g.cat1.some(c1 => catIds.includes(c1))
  );
  const uniqueType2 = [...new Set(filtered.map(g => g.type2))];
  return uniqueType2.slice(0, 3).map(t => `app.zulu.club/${encodeURIComponent(t)}`);
}

// ------------------------------
// GPT ANALYZER
// ------------------------------
async function getAIResponse(userMessage) {
  const basePrompt = `
You are Zulu Club’s intelligent assistant.

You have access to:
1. categories1.csv: {id, name}
2. galleries1.csv: {cat_id, type2, cat1}

Your tasks:
- Detect intent: greeting, company_info, product_search.
- For product queries, detect gender ("men", "women", "kids").
- If unclear gender, ask for it.
- Reformulate like: "I want a <product> for <gender>".
- Match 3 closest category names from categories1.csv (not hardcoded).
- Return JSON only.

Output format example:
{
  "intent": "product_search",
  "gender": "men",
  "query": "T-shirt for men"
}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: basePrompt },
      { role: "user", content: userMessage }
    ],
    max_tokens: 300
  });

  try {
    return JSON.parse(completion.choices[0].message.content.trim());
  } catch {
    console.error("⚠️ GPT output parse error:", completion.choices[0].message.content);
    return { intent: "conversation", query: userMessage };
  }
}

// ------------------------------
// MAIN HANDLER
// ------------------------------
async function handleMessage(userPhone, userName, userMessage) {
  const ai = await getAIResponse(userMessage);
  console.log("🤖 AI interpretation:", ai);

  if (ai.intent === "greeting") {
    await sendMessage(userPhone, userName, "Hey there 👋! How can I help you shop today?");
    return;
  }

  if (ai.intent === "company_info") {
    const info = `
Welcome to *Zulu Club*! 🛍️  
A smarter way to shop — get lifestyle products in *100 minutes!*  
Available in *Gurgaon* 🏙️  
Explore now 👉 zulu.club`;
    await sendMessage(userPhone, userName, info);
    return;
  }

  if (ai.intent === "product_search") {
    if (!ai.gender) {
      await sendMessage(userPhone, userName, `Would you like it for *men, women,* or *kids*? 👕👗👶`);
      return;
    }

    const query = ai.query.toLowerCase();
    const matchedCats = categories
      .filter(c => c.name.toLowerCase().includes(query))
      .slice(0, 3);

    if (matchedCats.length === 0) {
      await sendMessage(userPhone, userName, "Sorry, I couldn’t find related categories 😔");
      return;
    }

    const catIds = matchedCats.map(c => c.id);
    const links = getGalleryLinksByCategoryIds(catIds);

    if (links.length === 0) {
      await sendMessage(userPhone, userName, "No products found right now — please try a different category.");
      return;
    }

    const response = `Here are some *${ai.query}* picks for *${ai.gender}*:\n\n${links.join('\n')}\n\n🛒 Explore more on app.zulu.club`;
    await sendMessage(userPhone, userName, response);
    return;
  }

  await sendMessage(userPhone, userName, "Hi! Welcome to Zulu Club 🛍️ — what are you looking for today?");
}

// ------------------------------
// WEBHOOK
// ------------------------------
app.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';

    if (userMessage && userPhone) {
      await handleMessage(userPhone, userName, userMessage);
      res.status(200).json({ success: true });
    } else {
      res.status(400).json({ error: "Invalid webhook payload" });
    }
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// HEALTH CHECK
// ------------------------------
app.get('/', (req, res) => {
  res.json({
    status: "✅ Zulu Club AI Assistant running",
    version: "4.1",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    source: "GitHub CSVs",
    timestamp: new Date().toISOString()
  });
});

// ------------------------------
// START SERVER
// ------------------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Zulu Club AI Assistant running on port ${PORT}`));
});

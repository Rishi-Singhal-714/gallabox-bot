// ------------------------------
// ZULU CLUB AI Assistant - Full Integrated Version
// ------------------------------
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const fs = require('fs');
const csv = require('csv-parser');

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
// DATA LOADERS
// ------------------------------
let categories = [];
let galleries = [];

function loadCSVData() {
  return new Promise((resolve, reject) => {
    let loadedCats = [];
    let loadedGals = [];

    // Load categories1.csv
    fs.createReadStream('categories1.csv')
      .pipe(csv())
      .on('data', row => {
        if (row.id && row.name) loadedCats.push({ id: Number(row.id), name: row.name });
      })
      .on('end', () => {
        // Load galleries1.csv
        fs.createReadStream('galleries1.csv')
          .pipe(csv())
          .on('data', row => {
            if (row.cat_id && row.type2 && row.cat1) {
              try {
                const parsedCat1 = JSON.parse(row.cat1.replace(/'/g, '"'));
                row.cat1 = Array.isArray(parsedCat1)
                  ? parsedCat1.map(Number)
                  : [Number(parsedCat1)];
                row.cat_id = Number(row.cat_id);
                loadedGals.push(row);
              } catch {
                console.warn('⚠️ Skipped invalid cat1 format:', row.cat1);
              }
            }
          })
          .on('end', () => {
            categories = loadedCats;
            galleries = loadedGals;
            console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries`);
            resolve();
          })
          .on('error', reject);
      })
      .on('error', reject);
  });
}

// ------------------------------
// HELPER FUNCTIONS
// ------------------------------
async function sendMessage(to, name, message) {
  try {
    const payload = {
      channelId: gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: { name: name, phone: to },
      whatsapp: { type: "text", text: { body: message } }
    };
    await axios.post(
      `${gallaboxConfig.baseUrl}/messages/whatsapp`,
      payload,
      {
        headers: {
          'apiKey': gallaboxConfig.apiKey,
          'apiSecret': gallaboxConfig.apiSecret,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
  }
}

function getGalleryLinksByCategoryIds(catIds) {
  const filtered = galleries.filter(
    g => catIds.includes(g.cat_id) || g.cat1.some(c1 => catIds.includes(c1))
  );
  const uniqueType2 = [...new Set(filtered.map(g => g.type2))];
  return uniqueType2.slice(0, 3).map(t => `app.zulu.club/${encodeURIComponent(t)}`);
}

// ------------------------------
// GPT MESSAGE PROCESSOR
// ------------------------------
async function getAIResponse(userMessage) {
  const basePrompt = `
You are Zulu Club’s intelligent assistant.

You have access to two datasets:
1. categories1.csv: contains {id, name}
2. galleries1.csv: contains {cat_id, type2, cat1}

You should:
- Determine user intent: greeting, company info, or product inquiry.
- If product inquiry: determine gender (ask if not clear).
- Reformulate as: "I want a <product> for <gender>".
- Find top 3 category names matching the query from categories1.csv (use semantic match, not exact string).
- Get their {id} values, then filter galleries1.csv where {cat_id} or {cat1} contains those ids.
- Extract {type2} from matches and form links as app.zulu.club/{type2} (replace spaces with %20).
- Respond conversationally with these 3 links.

Now, analyze this message: "${userMessage}"
Output a JSON object like:
{
  "intent": "product_search" | "greeting" | "company_info",
  "gender": "men" | "women" | "kids" | null,
  "query": "<user’s refined query>"
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
    const text = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    console.error("⚠️ Failed to parse GPT response:", completion.choices[0].message.content);
    return { intent: "conversation", query: userMessage };
  }
}

// ------------------------------
// MAIN MESSAGE HANDLER
// ------------------------------
async function handleMessage(userPhone, userName, userMessage) {
  const ai = await getAIResponse(userMessage);
  console.log("🤖 AI interpretation:", ai);

  // 1. Casual conversation
  if (ai.intent === "greeting") {
    await sendMessage(userPhone, userName, "Hey there 👋! How can I help you shop today?");
    return;
  }

  // 2. Company info
  if (ai.intent === "company_info") {
    const info = `
Welcome to *Zulu Club*! 🛍️  
We bring a new way to shop — premium lifestyle products delivered in *100 minutes!*  
Shop fashion, home decor, wellness, beauty & more.  
Now live in *Gurgaon*!  
Explore at 👉 zulu.club`;
    await sendMessage(userPhone, userName, info);
    return;
  }

  // 3. Product query
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

  // Default fallback
  await sendMessage(userPhone, userName, "Hi! Welcome to Zulu Club 🛍️ — what are you looking for today?");
}

// ------------------------------
// WEBHOOK ENDPOINT
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
    version: "4.0",
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
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

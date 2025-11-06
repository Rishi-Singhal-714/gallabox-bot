// ------------------------------
// ZULU CLUB AI Assistant - Robust Matching + GitHub CSVs
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
// CONFIG
// ------------------------------
const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID,
  apiKey: process.env.GALLABOX_API_KEY,
  apiSecret: process.env.GALLABOX_API_SECRET,
  channelId: process.env.GALLABOX_CHANNEL_ID,
  baseUrl: 'https://server.gallabox.com/devapi'
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

// GitHub RAW URLs
const categoriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
const galleriesUrl  = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';

// ------------------------------
// DATA
// ------------------------------
let categories = []; // [{id:Number, name:String}]
let galleries  = []; // [{cat_id:Number, type2:String, cat1:Number[] }]

// ------------------------------
// UTIL: CSV LOADING
// ------------------------------
async function fetchCSV(url) {
  const res = await axios.get(url, { responseType: 'text' });
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(res.data)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function safeParseCat1(raw) {
  if (!raw) return [];
  let s = String(raw).trim();

  // treat literal null/empty as empty list
  if (s === 'null' || s === '' || s === '[]') return [];

  // normalize quotes and strip spaces after commas
  s = s.replace(/'/g, '"').replace(/,\s+/g, ',');
  // If it looks like a bare number (e.g. 1908), wrap into array
  if (!s.startsWith('[')) s = `[${s}]`;

  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map(n => Number(String(n).trim())).filter(n => Number.isFinite(n));
  } catch (_) {}
  return [];
}

async function loadCSVData() {
  console.log('⬇️ Fetching CSVs from GitHub...');
  const [catRows, galRows] = await Promise.all([fetchCSV(categoriesUrl), fetchCSV(galleriesUrl)]);

  categories = catRows
    .filter(r => r.id != null && r.name != null && String(r.id).trim() !== '' && String(r.name).trim() !== '')
    .map(r => ({ id: Number(String(r.id).trim()), name: String(r.name).trim() }))
    .filter(r => Number.isFinite(r.id));

  galleries = galRows
    .map(r => {
      const cat_id = Number(String(r.cat_id ?? '').trim());
      const type2  = (r.type2 ?? '').toString().trim();
      const cat1   = safeParseCat1(r.cat1);

      // strict null/empty skip
      const hasNull = (
        !Number.isFinite(cat_id) ||
        type2 === '' ||
        r.cat1 == null || String(r.cat1).trim() === '' // note: we still parsed into cat1 above
      );
      if (hasNull) return null;

      return { cat_id, type2, cat1 };
    })
    .filter(Boolean);

  console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries`);
}

// ------------------------------
// UTIL: TEXT + MATCHING
// ------------------------------
const STOP = new Set(['for','a','an','the','and','or','of','in','on','to','with','&']);
const SYNONYMS = {
  't-shirt': ['tshirt','tee','tee-shirt','t shirt','tees'],
  'tshirt':  ['t-shirt','tee','tee-shirt','t shirt','tees'],
  'tee':     ['t-shirt','tshirt','tee-shirt','t shirt','tees'],
  'shirt':   ['shirts'],
  'kurta':   ['kurtas'],
  'lehenga': ['ghagra','lengha','lehngha'],
  'pant':    ['pants','trouser','trousers'],
  'jean':    ['jeans','denim','denims'],
};

function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  const norm = normalize(str);
  return norm.split(' ').filter(t => t && !STOP.has(t));
}

function expandTokens(tokens) {
  const set = new Set(tokens);
  for (const t of tokens) {
    for (const [k, arr] of Object.entries(SYNONYMS)) {
      if (t === k || (SYNONYMS[k] || []).includes(t)) {
        set.add(k);
        (arr || []).forEach(x => set.add(x));
      }
    }
    // singular/plural quick pass
    if (t.endsWith('s')) set.add(t.slice(0, -1));
    else set.add(`${t}s`);
  }
  return Array.from(set);
}

function scoreCategory(name, queryTokens, gender) {
  const nameTokens = new Set(tokenize(name));
  let hits = 0;
  for (const qt of queryTokens) if (nameTokens.has(qt)) hits++;

  // Jaccard-like + boosts
  const base = hits / Math.max(1, nameTokens.size);
  let score = base;

  // gender boost if category name contains gender
  if (gender && nameTokens.has(gender)) score += 0.2;

  // if the exact product token (e.g., 't-shirt' or synonyms) appears, boost
  const productHits = queryTokens.filter(q => nameTokens.has(q)).length;
  score += Math.min(0.3, productHits * 0.05);

  return score;
}

function topCategoriesForQuery(query, gender, limit = 3) {
  const qTokens = expandTokens(tokenize(query));
  // also include gender token in query tokens so we bias toward gendered categories
  if (gender) qTokens.push(gender);

  const scored = categories.map(c => ({
    id: c.id,
    name: c.name,
    score: scoreCategory(c.name, qTokens, gender)
  }));

  scored.sort((a, b) => b.score - a.score);
  // keep those with meaningful score
  const filtered = scored.filter(x => x.score >= 0.05).slice(0, limit);
  return filtered;
}

function reverseSearchCategoriesViaGalleries(query, gender, limit = 3) {
  const qTokens = expandTokens(tokenize(query));
  if (gender) qTokens.push(gender);

  // score galleries by presence of query tokens in type2
  const galScores = new Map(); // key cat_id => score
  for (const g of galleries) {
    const t2Tokens = new Set(tokenize(g.type2));
    const overlap = qTokens.reduce((acc, t) => acc + (t2Tokens.has(t) ? 1 : 0), 0);
    if (overlap > 0) {
      const ids = [g.cat_id, ...(g.cat1 || [])].filter(Number.isFinite);
      for (const id of ids) {
        galScores.set(id, (galScores.get(id) || 0) + overlap);
      }
    }
  }
  const ranked = Array.from(galScores.entries())
    .map(([id, score]) => {
      const found = categories.find(c => c.id === id);
      const name = found ? found.name : `Category ${id}`;
      // small gender boost if category name contains gender string
      const gboost = found && gender && normalize(name).includes(gender) ? 0.2 : 0;
      return { id, name, score: score + gboost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

// ------------------------------
// LINKS
// ------------------------------
function linksForCategoryIds(catIds, limit = 3) {
  const filtered = galleries.filter(
    g => catIds.includes(g.cat_id) || (g.cat1 || []).some(c1 => catIds.includes(c1))
  );
  const uniqueType2 = [...new Set(filtered.map(g => g.type2).filter(Boolean))];
  return uniqueType2.slice(0, limit).map(t => `app.zulu.club/${encodeURIComponent(t)}`);
}

// ------------------------------
// GALLABOX SENDER
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
        apiKey: gallaboxConfig.apiKey,
        apiSecret: gallaboxConfig.apiSecret,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Sent message to ${to}`);
  } catch (e) {
    console.error('❌ Gallabox send error:', e.response?.data || e.message);
  }
}

// ------------------------------
// GPT INTENT
// ------------------------------
async function getAIIntent(userMessage) {
  const sys = `
You are Zulu Club's router.
- Detect: "greeting" | "company_info" | "product_search".
- If product_search, detect gender: "men" | "women" | "kids" | null.
- Reformulate query with gender if provided.
Return ONLY JSON: {"intent": "...", "gender": "... or null", "query": "..."}
Examples:
{"intent":"product_search","gender":"men","query":"t-shirt for men"}
{"intent":"greeting","gender":null,"query":"hi"}
{"intent":"company_info","gender":null,"query":"what is Zulu?"}
  `;
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 150,
    temperature: 0
  });
  let parsed = { intent: 'conversation', gender: null, query: userMessage };
  try {
    parsed = JSON.parse(resp.choices[0].message.content.trim());
  } catch (e) {
    console.warn('⚠️ Could not parse AI intent:', resp.choices[0].message.content);
  }
  return parsed;
}

// ------------------------------
// MAIN HANDLER
// ------------------------------
async function handleMessage(userPhone, userName, userMessage) {
  const ai = await getAIIntent(userMessage);
  console.log('🤖 AI interpretation:', ai);

  if (ai.intent === 'greeting') {
    return sendMessage(userPhone, userName, 'Hey there 👋 How can I help you shop today?');
  }

  if (ai.intent === 'company_info') {
    return sendMessage(
      userPhone,
      userName,
      `Welcome to *Zulu Club*! 🛍️ Premium lifestyle products delivered in *100 minutes*. Now live in *Gurgaon*. Explore: zulu.club`
    );
  }

  if (ai.intent === 'product_search') {
    if (!ai.gender) {
      return sendMessage(userPhone, userName, 'For *men, women,* or *kids*? 👕👗👶');
    }

    // 1) Try fuzzy category match
    const topCats = topCategoriesForQuery(ai.query, ai.gender, 3);
    console.log('🔎 Category candidates:', topCats);

    let catIds = topCats.map(c => c.id);
    let links  = linksForCategoryIds(catIds, 3);

    // 2) If nothing, reverse search via galleries' type2
    if (links.length === 0) {
      console.log('ℹ️ No links from category match. Trying reverse search via galleries...');
      const revCats = reverseSearchCategoriesViaGalleries(ai.query, ai.gender, 3);
      console.log('🔁 Reverse candidates:', revCats);
      catIds = revCats.map(c => c.id);
      links  = linksForCategoryIds(catIds, 3);
    }

    // 3) If still nothing, broaden using just product keyword (drop gender)
    if (links.length === 0) {
      console.log('↗️ Broadening search without gender token...');
      const broadCats = topCategoriesForQuery(ai.query.replace(/\b(men|women|kids)\b/gi, '').trim(), null, 3);
      console.log('🧭 Broad candidates:', broadCats);
      catIds = broadCats.map(c => c.id);
      links  = linksForCategoryIds(catIds, 3);
    }

    if (links.length > 0) {
      return sendMessage(
        userPhone,
        userName,
        `Here are *${ai.query}* picks for *${ai.gender}*:\n${links.join('\n')}\n\n🛒 More on app.zulu.club`
      );
    }

    // Debug help in logs if all failed
    console.warn('❌ No results after all strategies. Query:', ai.query, 'Gender:', ai.gender);
    return sendMessage(
      userPhone,
      userName,
      "Sorry, I couldn't find matching products right now. Try a different keyword (e.g., 'graphic tee', 'casual t-shirt')."
    );
  }

  // Default
  return sendMessage(userPhone, userName, 'Hi! Welcome to Zulu Club 🛍️ — what are you looking for today?');
}

// ------------------------------
// WEBHOOK
// ------------------------------
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const userMessage = body.whatsapp?.text?.body?.trim();
    const userPhone   = body.whatsapp?.from;
    const userName    = body.contact?.name || 'Customer';

    if (!userMessage || !userPhone) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    await handleMessage(userPhone, userName, userMessage);
    res.status(200).json({ success: true });
  } catch (e) {
    console.error('💥 Webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------
// HEALTH
// ------------------------------
app.get('/', (req, res) => {
  res.json({
    status: '✅ Zulu Club AI Assistant running',
    version: '5.0-robust',
    categoriesLoaded: categories.length,
    galleriesLoaded: galleries.length,
    timestamp: new Date().toISOString()
  });
});

// ------------------------------
// START
// ------------------------------
loadCSVData().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Zulu Club AI Assistant on ${PORT}`));
});

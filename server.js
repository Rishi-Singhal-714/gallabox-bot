// ------------------------------
// ZULU CLUB Product Router - Product-Only CSV Logic
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
// ENV / CONFIG
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

// GitHub RAW CSVs
const categoriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
const galleriesUrl  = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';

// ------------------------------
// DATA
// ------------------------------
let categories = []; // [{id:Number, name:String}]
let galleries  = []; // [{cat_id:Number, type2:String, cat1:Number[] }]

// ------------------------------
// CSV LOADING
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
  if (raw == null) return [];
  let s = String(raw).trim();
  if (!s || s.toLowerCase() === 'null') return [];
  // Normalize to JSON list
  s = s.replace(/'/g, '"').replace(/,\s+/g, ',');
  if (!s.startsWith('[')) s = `[${s}]`;
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map(v => Number(String(v).trim())).filter(Number.isFinite);
  } catch (_) {}
  return [];
}

async function loadCSVData() {
  console.log('⬇️ Loading CSVs from GitHub...');
  const [catRows, galRows] = await Promise.all([fetchCSV(categoriesUrl), fetchCSV(galleriesUrl)]);

  categories = catRows
    .filter(r => r.id != null && r.name != null && String(r.id).trim() && String(r.name).trim())
    .map(r => ({ id: Number(String(r.id).trim()), name: String(r.name).trim() }))
    .filter(r => Number.isFinite(r.id));

  galleries = galRows
    .map(r => {
      const cat_id = Number(String(r.cat_id ?? '').trim());
      const type2  = (r.type2 ?? '').toString().trim();
      const rawCat1 = r.cat1;
      // Skip rows with null/empty in any of the three columns
      if (!Number.isFinite(cat_id) || !type2 || rawCat1 == null || String(rawCat1).trim() === '') return null;
      const cat1 = safeParseCat1(rawCat1);
      return { cat_id, type2, cat1 };
    })
    .filter(Boolean);

  console.log(`✅ Loaded ${categories.length} categories & ${galleries.length} galleries`);
}

// ------------------------------
// TEXT UTILS
// ------------------------------
const STOP = new Set(['for','a','an','the','and','or','of','in','on','to','with','&']);
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenize(str) {
  return normalize(str).split(' ').filter(t => t && !STOP.has(t));
}
function uniq(arr) { return Array.from(new Set(arr)); }

// Product synonyms to help token matching
const SYN = {
  't-shirt': ['tshirt','tee','tee-shirt','t shirt','tees'],
  'tshirt':  ['t-shirt','tee','tee-shirt','t shirt','tees'],
  'tee':     ['t-shirt','tshirt','tee-shirt','t shirt','tees'],
  'jean':    ['jeans','denim','denims'],
  'pant':    ['pants','trouser','trousers'],
  'shirt':   ['shirts'],
  'kurta':   ['kurtas'],
  'lehenga': ['ghagra','lengha','lehngha'],
  'shoe':    ['shoes','sneaker','sneakers','footwear'],
};
function expandTokens(tokens) {
  const set = new Set(tokens);
  for (const t of tokens) {
    for (const [k, arr] of Object.entries(SYN)) {
      if (t === k || (arr || []).includes(t)) {
        set.add(k);
        (arr || []).forEach(x => set.add(x));
      }
    }
    if (t.endsWith('s')) set.add(t.slice(0, -1)); else set.add(`${t}s`);
  }
  return Array.from(set);
}

// ------------------------------
// CORE CATEGORY FILTER (dynamic IDs from CSV names)
// ------------------------------
const CORE_CATEGORY_NAMES = [
  'men','women','kids','home','electronics','ethnicwear','wellness','metals','food','gadgets','discover'
];

function findCoreCategoryIds() {
  const ids = new Set();
  const names = categories.map(c => ({ id: c.id, name: normalize(c.name) }));
  for (const term of CORE_CATEGORY_NAMES) {
    for (const c of names) {
      if (c.name.includes(term)) ids.add(categories.find(x => x.id === c.id).id);
    }
  }
  return Array.from(ids);
}

// ------------------------------
// CATEGORY MATCHING (Top 3 relevant to user text)
// ------------------------------
function scoreCategoryByTokens(catName, queryTokens) {
  const nameTokens = new Set(tokenize(catName));
  let hits = 0;
  for (const q of queryTokens) if (nameTokens.has(q)) hits++;
  // Jaccard-ish
  return hits / Math.max(1, nameTokens.size);
}

function top3RelevantCategories(userText) {
  const qTokens = expandTokens(tokenize(userText));
  const scored = categories.map(c => ({
    id: c.id,
    name: c.name,
    score: scoreCategoryByTokens(c.name, qTokens)
  }));
  scored.sort((a,b) => b.score - a.score);
  // Keep non-zeroish matches; if none score >0, still return top 3 by score
  const top = scored.filter(x => x.score > 0).slice(0,3);
  return (top.length ? top : scored.slice(0,3));
}

// ------------------------------
// PRODUCT KEYWORD → CATEGORY IDS (for cat1 filtering)
// ------------------------------
function productKeywordCategoryIds(userText) {
  const tokens = expandTokens(tokenize(userText));
  const matched = [];
  for (const c of categories) {
    const name = normalize(c.name);
    for (const t of tokens) {
      if (name.includes(t)) { matched.push(c.id); break; }
    }
  }
  return uniq(matched);
}

// ------------------------------
// GALLERIES FILTER PIPELINE (as per your spec)
// 1) Start with galleries where cat_id ∈ coreCategoryIds
// 2) From those, keep rows where cat1 intersects productKeywordCategoryIds
// ------------------------------
function filterGalleriesBySpec(userText) {
  const coreIds = findCoreCategoryIds();
  const step1 = galleries.filter(g => coreIds.includes(g.cat_id));
  if (step1.length === 0) return []; // No data under core categories

  const prodIds = productKeywordCategoryIds(userText);
  if (prodIds.length === 0) return []; // No product ids matched

  const step2 = step1.filter(g =>
    (g.cat1 || []).some(cid => prodIds.includes(cid))
  );

  return step2;
}

// Fallbacks (if strict pipeline returns nothing)
function fallbackByCat1Top3(userText) {
  const top = top3RelevantCategories(userText).map(c => c.id);
  return galleries.filter(g => (g.cat1 || []).some(cid => top.includes(cid)));
}
function fallbackByType2Contains(userText) {
  const tokens = expandTokens(tokenize(userText));
  return galleries.filter(g => {
    const t2 = normalize(g.type2);
    return tokens.some(t => t2.includes(t));
  });
}

// ------------------------------
// LINK BUILDER
// ------------------------------
function linksFromGalleries(rows, limit = 6) {
  const uniqueType2 = uniq(rows.map(r => r.type2).filter(Boolean));
  return uniqueType2.slice(0, limit).map(t => `app.zulu.club/${encodeURIComponent(t)}`);
}

// ------------------------------
// GALLABOX SEND
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
// GPT: PRODUCT vs COMPANY vs CASUAL
// (We only need GPT to decide "product query" or not. All CSV logic is in code.)
// ------------------------------
async function getIntent(userMessage) {
  const sys = `
You are a router. Classify the user's message into:
- "product_search"
- "company_info"
- "greeting"

Return ONLY JSON: {"intent":"..."}.

Examples:
User: "hi" -> {"intent":"greeting"}
User: "what is zulu" -> {"intent":"company_info"}
User: "need a casual tee" -> {"intent":"product_search"}
`;
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMessage }
      ],
      temperature: 0,
      max_tokens: 60
    });
    const parsed = JSON.parse(resp.choices[0].message.content.trim());
    return parsed?.intent || 'product_search';
  } catch (e) {
    // If GPT fails, assume product query (as you requested: product logic only)
    return 'product_search';
  }
}

// ------------------------------
// MAIN HANDLER
// ------------------------------
async function handleMessage(userPhone, userName, userMessage) {
  const intent = await getIntent(userMessage);
  console.log('🤖 Intent:', intent);

  if (intent === 'greeting') {
    return sendMessage(userPhone, userName, 'Hey there 👋 How can I help you shop today?');
  }
  if (intent === 'company_info') {
    return sendMessage(userPhone, userName, `Welcome to *Zulu Club*! 🛍️ Premium lifestyle products delivered in *100 minutes*. Now live in *Gurgaon*. Explore: zulu.club`);
  }

  // PRODUCT QUERY LOGIC (the pipeline you asked for)
  let rows = filterGalleriesBySpec(userMessage);

  // Fallback 1: if nothing, try cat1 contains any of top3 relevant category ids
  if (rows.length === 0) {
    rows = fallbackByCat1Top3(userMessage);
  }

  // Fallback 2: if still nothing, try type2 contains keywords
  if (rows.length === 0) {
    rows = fallbackByType2Contains(userMessage);
  }

  const links = linksFromGalleries(rows, 6);

  if (links.length > 0) {
    const reply = `Here you go 👇\n${links.join('\n')}\n\n🛒 More on app.zulu.club`;
    return sendMessage(userPhone, userName, reply);
  }

  return sendMessage(userPhone, userName, "Sorry, I couldn't find an exact match. Try a different keyword like 'graphic tee', 'jeans', or 'kurta'.");
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
    status: '✅ Zulu Club Product Router running',
    version: '6.0-product-pipeline',
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
  app.listen(PORT, () => console.log(`🚀 Zulu Club Product Router on ${PORT}`));
});

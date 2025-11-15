// server.js - GPT-first intent + category matcher (AI is the boss)
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gallabox API configuration - use environment variables
const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID,
  apiKey: process.env.GALLABOX_API_KEY,
  apiSecret: process.env.GALLABOX_API_SECRET,
  channelId: process.env.GALLABOX_CHANNEL_ID,
  baseUrl: 'https://server.gallabox.com/devapi'
};

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// Store conversations and CSV data
let conversations = {};
let galleriesData = [];
let sellersData = []; // sellers CSV data

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

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

Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on zulu.club
`;

// INVESTORS paragraph placeholder (edit as required)
const INVESTORS_PARAGRAPH = `
Thanks for your interest in investing in Zulu Club. Please share your pitch deck or contact investor-relations@zulu.club and our team will get back to you. (Edit this paragraph to include your funding history, pitch-deck link, and IR contact.)
`;

/* -------------------------
   CSV loaders: galleries + sellers
--------------------------*/
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv', {
      timeout: 60000 
    });
    
    return new Promise((resolve, reject) => {
      const results = [];
      
      if (!response.data || response.data.trim().length === 0) {
        console.log('❌ Empty CSV data received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          const mappedData = {
            type2: data.type2 || data.Type2 || data.TYPE2 || '',
            cat_id: data.cat_id || data.cat_id || data.CAT_ID || '',
            cat1: data.cat1 || data.Cat1 || data.CAT1 || '',
            seller_id: data.seller_id || data.SELLER_ID || data.Seller_ID || data.SellerId || data.sellerId || ''
          };
          
          if (mappedData.type2 && mappedData.cat1) {
            results.push(mappedData);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} product categories from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ Error parsing CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading CSV data:', error.message);
    return [];
  }
}

async function loadSellersData() {
  try {
    console.log('📥 Loading sellers CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv', {
      timeout: 60000
    });

    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('❌ Empty sellers CSV received');
        resolve([]);
        return;
      }
      const stream = Readable.from(response.data);
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Keep seller_id, but read user_id explicitly for link generation
          const mapped = {
            seller_id: data.seller_id || data.SELLER_ID || data.id || data.ID || '',
            user_id: data.user_id || data.USER_ID || data.userId || data.userID || '',
            store_name: data.store_name || data.StoreName || data.store || data.Store || '',
            category_ids: data.category_ids || data.CATEGORY_IDS || data.categories || data.Categories || '',
            raw: data
          };
          if (mapped.seller_id || mapped.store_name) {
            mapped.category_ids_array = (mapped.category_ids || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            results.push(mapped);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} sellers from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ Error parsing sellers CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading sellers CSV:', error.message);
    return [];
  }
}

// initialize both CSVs
(async () => {
  try {
    galleriesData = await loadGalleriesData();
  } catch (e) {
    console.error('Failed loading galleries:', e);
    galleriesData = [];
  }
  try {
    sellersData = await loadSellersData();
  } catch (e) {
    console.error('Failed loading sellers:', e);
    sellersData = [];
  }
})();

/* -------------------------
   sendMessage (unchanged)
--------------------------*/
async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Attempting to send message to ${to} (${name}): ${message}`);
    
    const payload = {
      channelId: gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: {
        name: name,
        phone: to
      },
      whatsapp: {
        type: "text",
        text: {
          body: message
        }
      }
    };
    
    const response = await axios.post(
      `${gallaboxConfig.baseUrl}/messages/whatsapp`,
      payload,
      {
        headers: {
          'apiKey': gallaboxConfig.apiKey,
          'apiSecret': gallaboxConfig.apiSecret,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    console.log('✅ Message sent successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
}

/* -------------------------
   Matching helpers (kept)
--------------------------*/
function normalizeToken(t) {
  if (!t) return '';
  return String(t)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(word) {
  if (!word) return '';
  if (word.endsWith('ies') && word.length > 3) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
}

function editDistance(a, b) {
  const s = a || '', t = b || '';
  const m = s.length, n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  if (longer.includes(shorter)) return 0.95;
  const commonChars = [...shorter].filter(char => longer.includes(char)).length;
  return commonChars / longer.length;
}

function smartSimilarity(a, b) {
  const A = singularize(normalizeToken(a));
  const B = singularize(normalizeToken(b));
  if (!A || !B) return 0;
  if (A === B) return 1.0;
  if (A.includes(B) || B.includes(A)) return 0.95;
  const ed = editDistance(A, B);
  const maxLen = Math.max(A.length, B.length);
  const edScore = 1 - (ed / Math.max(1, maxLen));
  const charOverlap = calculateSimilarity(A, B);
  return Math.max(edScore, charOverlap);
}

function expandCategoryVariants(category) {
  const norm = normalizeToken(category);
  const variants = new Set();
  if (norm) variants.add(norm);
  const ampParts = norm.split(/\band\b/).map(s => normalizeToken(s));
  for (const p of ampParts) {
    if (p && p.length > 1) variants.add(p.trim());
  }
  return Array.from(variants);
}

const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);

function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men', 'women', 'kids', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
  const message = (userMessage || '').toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

/* -------------------------
   Gallery keyword matching (kept)
--------------------------*/
function findKeywordMatchesInCat1(userMessage) {
  if (!userMessage || !galleriesData.length) return [];
  
  const rawTerms = userMessage
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOPWORDS.has(term));

  const searchTerms = rawTerms
    .map(t => singularize(normalizeToken(t)))
    .filter(t => t.length > 1);

  const matches = [];
  const clothingKeywords = ['clothing', 'apparel', 'wear', 'shirt', 'pant', 'dress', 'top', 'bottom', 'jacket', 'sweater'];
  
  galleriesData.forEach(item => {
    if (!item.cat1) return;
    const cat1Categories = item.cat1.split(',').map(cat => cat.trim()).filter(Boolean);
    const expanded = [];
    for (const category of cat1Categories) {
      const variants = expandCategoryVariants(category);
      expanded.push(...variants);
    }

    for (const searchTerm of searchTerms) {
      for (const variant of expanded) {
        const isClothing = clothingKeywords.some(clothing => variant.includes(clothing));
        if (isClothing) continue;
        const sim = smartSimilarity(variant, searchTerm);
        if (sim >= 0.9 || (sim >= 0.82 && Math.abs(variant.length - searchTerm.length) <= 3)) {
          if (!matches.some(m => m.type2 === item.type2)) {
            matches.push({
              ...item,
              matchType: sim === 1.0 ? 'exact' : 'similar',
              matchedTerm: searchTerm,
              score: sim
            });
          }
        }
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

/* -------------------------
   Seller matching (kept)
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;
const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];

function stripClothingFromType2(type2) {
  if (!type2) return type2;
  let tokens = type2.split(/\s+/);
  while (tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g, ''))) {
    tokens.shift();
  }
  return tokens.join(' ').trim();
}

function matchSellersByStoreName(type2Value) {
  if (!type2Value || !sellersData.length) return [];
  const stripped = stripClothingFromType2(type2Value);
  const norm = normalizeToken(stripped);
  if (!norm) return [];

  const matches = [];
  sellersData.forEach(seller => {
    const store = seller.store_name || '';
    const sim = smartSimilarity(store, norm);
    if (sim >= 0.82) {
      matches.push({ seller, score: sim });
    }
  });
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0, 10);
}

function matchSellersByCategoryIds(userMessage) {
  if (!userMessage || !sellersData.length) return [];
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matches = [];
  sellersData.forEach(seller => {
    const categories = seller.category_ids_array || [];
    const common = categories.filter(c => terms.some(t => t.includes(c) || c.includes(t)));
    if (common.length > 0) {
      matches.push({ seller, matches: common.length });
    }
  });
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0, 10);
}

// New minimal GPT helper: only decide "is this a home query?" and return score (0..1)
async function isQueryHome(userMessage) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  const prompt = `
You are a classifier that decides whether a user search query is about HOME / HOME DECOR items (vases, lamps, clocks, showpieces, cushions, etc.) or NOT.

USER QUERY: "${userMessage}"

Answer ONLY with JSON:
{ "is_home_score": 0.0 }

Where is_home_score is a number 0.0 - 1.0 representing how strongly this query is home/home-decor related.

Do not include any text, only the JSON.
  `;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a concise classifier that returns only JSON with is_home_score." },
        { role: "user", content: prompt }
      ],
      max_tokens: 50,
      temperature: 0.0
    });
    const raw = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(raw);
      const score = Number(parsed.is_home_score) || 0;
      return { isHome: score >= GPT_HOME_THRESHOLD, score };
    } catch (e) {
      console.error('Error parsing isQueryHome JSON:', e, 'raw:', raw);
      return { isHome: false, score: 0 };
    }
  } catch (err) {
    console.error('GPT error in isQueryHome:', err);
    return { isHome: false, score: 0 };
  }
}

async function gptCheckSellerMaySell(userMessage, seller) {
  if (!openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured' };

  const prompt = `
You are an assistant that rates how likely a seller sells a product a user asks for.

USER MESSAGE: "${userMessage}"

SELLER INFORMATION:
Store name: "${seller.store_name || ''}"
Seller id: "${seller.seller_id || ''}"
Seller categories: "${(seller.category_ids_array || []).join(', ')}"
Other info (raw CSV row): ${JSON.stringify(seller.raw || {})}

Question: Based on the above, how likely (0.0 - 1.0) is it that this seller sells the product the user is asking for? Provide ONLY valid JSON in the following format:

{ "score": 0.0, "reason": "one-sentence reason" }

Do not return anything else.
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a concise classifier that returns only JSON {score, reason}." },
        { role: "user", content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.0
    });

    const content = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return { score: Number(parsed.score) || 0, reason: parsed.reason || '' };
    } catch (parseError) {
      console.error('Error parsing GPT seller-check response:', parseError, 'raw:', content);
      return { score: 0, reason: 'GPT response could not be parsed' };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error' };
  }
}

// helper: given a galleries.csv seller_id, try to find sellers.csv entry and return user_id or fallback to seller_id
function getUserIdForSellerId(sellerId) {
  if (!sellerId) return '';
  const s = sellersData.find(x => (x.seller_id && String(x.seller_id) === String(sellerId)));
  if (s && s.user_id && String(s.user_id).trim().length > 0) return String(s.user_id).trim();
  return String(sellerId).trim();
}

// master function to find sellers for a user query (combines three methods)
// Now integrates minimal home-only GPT check
async function findSellersForQuery(userMessage, galleryMatches = []) {
  // 0) minimal GPT: is this a home query?
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome; // boolean

  // 1) If we already have gallery type2 matches, use those type2 -> store_name mapping as first source
  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }

  // 2) category_ids-based matches (based on raw userMessage)
  const catMatches = matchSellersByCategoryIds(userMessage);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));

  // If home filter should be applied, remove sellers that don't have home-related categories
  if (applyHomeFilter) {
    const homeSyns = ['home','decor','home decor','home-decor','home_decor','furniture','homeaccessories','home-accessories','home_accessories','decoratives','showpiece','showpieces','lamp','lamps','vase','vases','clock','clocks','cushion','cushions'];
    const keepIfHome = (s) => {
      const arr = s.category_ids_array || [];
      return arr.some(c => {
        const cc = c.toLowerCase();
        return homeSyns.some(h => cc.includes(h) || h.includes(cc));
      });
    };
    for (const [k, s] of Array.from(sellers_by_type2.entries())) {
      if (!keepIfHome(s)) sellers_by_type2.delete(k);
    }
    for (const [k, s] of Array.from(sellers_by_category.entries())) {
      if (!keepIfHome(s)) sellers_by_category.delete(k);
    }
  }

  // 3) GPT-based predictions: run GPT checks on a candidate pool
  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  if (candidateIds.size === 0) {
    // If home filter applied, prefer sellers that have home category first
    if (applyHomeFilter) {
      for (const s of sellersData) {
        const arr = s.category_ids_array || [];
        if (arr.some(c => c.includes('home') || c.includes('decor') || c.includes('furnit') || c.includes('vase') || c.includes('lamp') || c.includes('clock'))) {
          candidateList.push(s);
          if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        }
      }
    }
    // fill remaining from top sellers
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length) && candidateList.length < MAX_GPT_SELLER_CHECK; i++) {
      if (!candidateList.includes(sellersData[i])) candidateList.push(sellersData[i]);
    }
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name+'#') == id));
      if (s) candidateList.push(s);
    }
    if (candidateList.length < MAX_GPT_SELLER_CHECK) {
      for (const s of sellersData) {
        if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        if (!candidateList.includes(s)) candidateList.push(s);
      }
    }
  }

  const sellers_by_gpt = [];
  for (let i = 0; i < Math.min(candidateList.length, MAX_GPT_SELLER_CHECK); i++) {
    const seller = candidateList[i];
    // If home filter applied, skip sellers that don't have that home keyword
    if (applyHomeFilter) {
      const arr = seller.category_ids_array || [];
      if (!arr.some(c => c.includes('home') || c.includes('decor') || c.includes('vase') || c.includes('lamp') || c.includes('clock') || c.includes('furnit'))) {
        continue;
      }
    }
    const result = await gptCheckSellerMaySell(userMessage, seller);
    if (result.score > GPT_THRESHOLD) {
      sellers_by_gpt.push({ seller, score: result.score, reason: result.reason });
    }
  }

  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);

  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt,
    homeCheck // include for debugging if needed { isHome, score }
  };
}

/* -------------------------
   Small/concise response builder
--------------------------*/
function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(t.trim().replace(/\s+/g, ' ')).replace(/%20/g, '%20');
}

function buildConciseResponse(userMessage, galleryMatches = [], sellersObj = {}) {
  const galleries = (galleryMatches && galleryMatches.length) ? galleryMatches.slice(0,5) : galleriesData.slice(0,5);
  const sellersList = [];
  const addSeller = (s) => {
    if (!s) return;
    const id = s.user_id || s.seller_id || '';
    if (!id) return;
    if (!sellersList.some(x => (x.user_id || x.seller_id) === id)) sellersList.push(s);
  };
  (sellersObj.by_type2 || []).forEach(addSeller);
  (sellersObj.by_category || []).forEach(addSeller);
  (sellersObj.by_gpt || []).forEach(item => addSeller(item.seller));
  const sellersToShow = sellersList.slice(0,5);

  let msg = `Based on your interest in "${userMessage}":\n`;

  if (galleries.length) {
    msg += `\nGalleries:\n`;
    galleries.slice(0,5).forEach((g, i) => {
      const t = g.type2 || '';
      const link = `app.zulu.club/${urlEncodeType2(t)}`;
      msg += `${i+1}. ${t} — ${link}\n`;
    });
  } else {
    msg += `\nGalleries:\nNone\n`;
  }

  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  return msg.trim();
}

/* -------------------------
   GPT-first classifier + category matcher (single call)
   Returns: { intent, confidence, reason, matches }
   - intent: one of 'company','product','seller','investors'
   - matches: array of { type2, reason, score } when intent === 'product'
--------------------------*/
/* -------------------------
   GPT-only classifier + category matcher (single call)
   No deterministic phrase checks — GPT decides intent completely.
   Returns: { intent, confidence, reason, matches }
--------------------------*/
async function classifyAndMatchWithGPT(userMessage) {
  const text = (userMessage || '').trim();
  if (!text) {
    return { intent: 'company', confidence: 1.0, reason: 'empty message', matches: [] };
  }

  if (!openai || !process.env.OPENAI_API_KEY) {
    return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [] };
  }

  // Prepare compact categories list for GPT
  const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));

  const prompt = `
You are an assistant for Zulu Club (a lifestyle shopping service).

Task:
1) Decide the user's intent. Choose exactly one of: "company", "product", "seller", "investors".
   - "company": general questions, greetings, store info, pop-ups, support, availability.
   - "product": the user is asking to browse or buy items, asking what we have, searching for products/categories.
   - "seller": queries about selling on the platform, onboarding merchants.
   - "investors": questions about business model, revenue, funding, pitch, investment.

2) If the intent is "product", pick up to 5 best-matching categories from the AVAILABLE CATEGORIES list provided (match using the "type2" field). For each match return a short reason and a relevance score between 0.0 and 1.0.

3) Return ONLY valid JSON in this exact format (no extra text):

{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "matches": [
    { "type2": "exact-type2-from-csv", "reason": "why it matches", "score": 0.85 }
  ]
}

If intent is not "product", return "matches": [].

AVAILABLE CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE:
"""${String(userMessage).replace(/"/g, '\\"')}
"""
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a JSON-only classifier & category matcher. Return only the requested JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.15
    });

    const raw = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) ? completion.choices[0].message.content.trim() : '';
    try {
      const parsed = JSON.parse(raw);
      const intent = (parsed.intent && ['company','product','seller','investors'].includes(parsed.intent)) ? parsed.intent : 'company';
      const confidence = Number(parsed.confidence) || 0.0;
      const reason = parsed.reason || '';
      const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ type2: m.type2, reason: m.reason, score: Number(m.score) || 0 })) : [];
      return { intent, confidence, reason, matches };
    } catch (e) {
      console.error('Error parsing classifyAndMatchWithGPT JSON:', e, 'raw:', raw);
      // best-effort fallback: return company intent so user sees company response rather than wrong product/seller
      return { intent: 'company', confidence: 0.0, reason: 'parse error from GPT', matches: [] };
    }
  } catch (err) {
    console.error('Error calling OpenAI classifyAndMatchWithGPT:', err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [] };
  }
}


/* -------------------------
   Company Response Generator (kept)
--------------------------*/
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  const messages = [];
  
  const systemMessage = {
    role: "system",
    content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
    
    ZULU CLUB INFORMATION:
    ${companyInfo}

    IMPORTANT RESPONSE GUIDELINES:
    1. **Keep responses conversational** and helpful
    2. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
    3. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
    4. **Use emojis** to make it engaging but professional
    5. **Keep responses under 200 characters** for WhatsApp compatibility
    6. **Be enthusiastic and helpful**
    7. **Direct users to our website** zulu.club for more information and shopping
    `
  };
  
  messages.push(systemMessage);
  
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => {
      if (msg.role && msg.content) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });
  }
  
  messages.push({
    role: "user",
    content: userMessage
  });
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 300,
      temperature: 0.6
    });
    return completion.choices[0].message.content.trim();
  } catch (e) {
    console.error('Error in generateCompanyResponse:', e);
    return `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.`;
  }
}

/* -------------------------
   Seller onboarding helper
--------------------------*/
function isSellerOnboardQuery(userMessage) {
  if (!userMessage) return false;
  const m = userMessage.toLowerCase();
  const triggers = [
    'sell on', 'sell with', 'become a seller', 'become seller', 'be a seller', 'how to join', 'how to onboard',
    'onboard', 'onboarding', 'register as seller', 'register as a seller', 'join as seller', 'become a merchant',
    'how to sell', 'partner with', 'partner with zulu', 'seller signup', 'seller sign up', 'how to become a seller',
    'how to register', 'apply as seller', 'apply to sell', 'sell on zulu', 'seller onboarding'
  ];
  return triggers.some(t => m.includes(t));
}

function sellerOnboardMessage() {
  const link = 'https://app.zulu.club/brand';
  return `Want to sell on Zulu Club? Sign up here: ${link}\n\nQuick steps:\n• Fill the seller form at the link\n• Our team will review & reach out\n• Start listing products & reach Gurgaon customers`;
}

/* -------------------------
   Main product flow:
   - Use classifyAndMatchWithGPT (GPT is the boss)
   - For product: use returned matches to find sellers and build concise response
   - For seller: return onboarding message
   - For investors: return INVESTORS_PARAGRAPH
   - For company: run conversational company response
--------------------------*/
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    // Quick explicit onboarding check (still useful for very specific phrases)
    if (isSellerOnboardQuery(userMessage)) {
      return sellerOnboardMessage();
    }

    // 1) single GPT call to classify + match categories
    const classification = await classifyAndMatchWithGPT(userMessage);
    const intent = classification.intent || 'company';

    // Debug logs (comment out in production if noisy)
    console.log('🧠 GPT classification:', { intent: classification.intent, confidence: classification.confidence, reason: classification.reason });

    // 2) Intent handling
    if (intent === 'seller') {
      // If GPT says 'seller', give onboarding message
      return sellerOnboardMessage();
    }

    if (intent === 'investors') {
      // Return investors paragraph (editable)
      return INVESTORS_PARAGRAPH.trim();
    }

    if (intent === 'product' && galleriesData.length > 0) {
      // Map GPT returned matches (type2 strings) to actual gallery objects
      const matchedType2s = (classification.matches || []).map(m => m.type2).filter(Boolean);
      let matchedCategories = [];
      if (matchedType2s.length > 0) {
        matchedCategories = matchedType2s.map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim())).filter(Boolean).slice(0,5);
      }

      // If GPT didn't return matches, fallback to local keyword matcher
      if (matchedCategories.length === 0) {
        // clothing queries prefer GPT matching (we still use findGptMatchedCategories which uses GPT)
        if (containsClothingKeywords(userMessage)) {
          matchedCategories = await findGptMatchedCategories(userMessage);
        } else {
          const keywordMatches = findKeywordMatchesInCat1(userMessage);
          if (keywordMatches.length > 0) {
            matchedCategories = keywordMatches;
          } else {
            matchedCategories = await findGptMatchedCategories(userMessage);
          }
        }
      }

      // find sellers using matchedCategories
      const sellers = await findSellersForQuery(userMessage, matchedCategories);
      return buildConciseResponse(userMessage, matchedCategories, sellers);
    }

    // default: company conversational response
    return await generateCompanyResponse(userMessage, conversationHistory, companyInfo);

  } catch (error) {
    console.error('❌ getChatGPTResponse error:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Backwards-compatible helpers & endpoints (kept)
--------------------------*/
function generateProductResponseFromMatches(matches, userMessage) {
  if (matches.length === 0) return generateFallbackProductResponse();
  let response = `Perfect! Based on your search for "${userMessage}", I found these matching categories: 🛍️\n\n`;
  matches.forEach((match, index) => {
    const link = `app.zulu.club/${encodeURIComponent(match.type2).replace(/%20/g, '%20')}`;
    const displayCategories = match.type2.split(',').slice(0, 2).join(', ');
    const matchInfo = match.matchType === 'exact' ? '✅ Exact match' : '🔍 Similar match';
    response += `${index + 1}. ${displayCategories}\n   ${matchInfo}\n   🔗 ${link}\n`;
    if (match.seller_id && String(match.seller_id).trim().length > 0) {
      const userId = getUserIdForSellerId(match.seller_id);
      const sellerLink = `app.zulu.club/sellerassets/${String(userId).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  return response;
}

async function handleProductIntentWithGPT(userMessage) {
  const matchedCategories = await findGptMatchedCategories(userMessage);
  return generateProductResponseWithGPT(matchedCategories, userMessage);
}

function generateProductResponseWithGPT(matchedCategories, userMessage) {
  if (matchedCategories.length === 0) return generateFallbackProductResponse();
  let response = `Perfect! Based on your interest in "${userMessage}", I found these great categories for you: 🛍️\n\n`;
  matchedCategories.forEach((category, index) => {
    const link = `app.zulu.club/${encodeURIComponent(category.type2).replace(/%20/g, '%20')}`;
    const displayCategories = category.type2.split(',').slice(0, 2).join(', ');
    response += `${index + 1}. ${displayCategories}\n   🔗 ${link}\n`;
    if (category.seller_id && String(category.seller_id).trim().length > 0) {
      const userId = getUserIdForSellerId(category.seller_id);
      const sellerLink = `app.zulu.club/sellerassets/${String(userId).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  return response;
}

function generateFallbackProductResponse() {
  return `🎉 Zulu Club offers many categories — visit zulu.club to browse.`;
}

/* -------------------------
   Webhook + endpoints
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  try {
    if (!conversations[sessionId]) conversations[sessionId] = { history: [] };
    conversations[sessionId].history.push({ role: "user", content: userMessage });
    const aiResponse = await getChatGPTResponse(userMessage, conversations[sessionId].history);
    conversations[sessionId].history.push({ role: "assistant", content: aiResponse });
    if (conversations[sessionId].history.length > 10) conversations[sessionId].history = conversations[sessionId].history.slice(-10);
    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    console.log(`💬 Received message from ${userPhone} (${userName}): ${userMessage}`);
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage);
      await sendMessage(userPhone, userName, aiResponse);
      console.log(`✅ AI response sent to ${userPhone}`);
    } else {
      console.log('❓ No valid message or phone number found in webhook');
    }
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully', processed: true });
  } catch (error) {
    console.error('💥 Webhook error:', error.message);
    res.status(500).json({ status: 'error', message: error.message, processed: false });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '6.0 - GPT-first classifier & category matcher (AI is boss)',
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_conversations: Object.keys(conversations).length
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/refresh-csv', async (req, res) => {
  try {
    galleriesData = await loadGalleriesData();
    sellersData = await loadSellersData();
    res.json({ status: 'success', message: 'CSV data refreshed successfully', categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/test-keyword-matching', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const isClothing = containsClothingKeywords(query);
    const keywordMatches = findKeywordMatchesInCat1(query);
    const sellers = await findSellersForQuery(query, keywordMatches);
    const concise = buildConciseResponse(query, keywordMatches, sellers);
    res.json({ query, is_clothing_query: isClothing, keyword_matches: keywordMatches, sellers, homeCheck: sellers.homeCheck || {}, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const matched = await findGptMatchedCategories(query);
    res.json({ query, matched_categories: matched, categories_loaded: galleriesData.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-test-message', async (req, res) => {
  try {
    const { to, name, message } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing "to" in request body', example: { "to": "918368127760", "name": "Rishi", "message": "What products do you have?" } });
    const result = await sendMessage(to, name || 'Test User', message || 'Hello! This is a test message from Zulu Club AI Assistant. 🚀');
    res.json({ status: 'success', message: 'Test message sent successfully', data: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send test message', details: error.message });
  }
});

// Export for Vercel
module.exports = app;

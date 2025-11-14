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

// OpenAI configuration (model selectable via env)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});
const GPT_MODEL = process.env.OPENAI_INTENT_MODEL || 'gpt-4'; // default to gpt-4 per request

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

// Improved token-based overlap similarity (0..1)
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const a = str1.toLowerCase().trim();
  const b = str2.toLowerCase().trim();
  if (a === b) return 1.0;
  // fast containment boost
  if (a.includes(b) || b.includes(a)) {
    // length ratio: if one is much shorter, give a bit lower boost
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.85 + 0.15 * ratio; // 0.85..1.0
  }

  // build trigrams (or bigrams when short)
  function ngrams(s, n = 3) {
    const pad = `_${s}_`;
    const grams = [];
    for (let i = 0; i <= pad.length - n; i++) grams.push(pad.slice(i, i + n));
    return grams;
  }
  const n = Math.min(3, Math.max(2, Math.floor(Math.min(a.length, b.length) / 3) || 2));
  const gA = ngrams(a, n);
  const gB = ngrams(b, n);
  const setB = new Set(gB);
  const common = gA.filter(x => setB.has(x)).length;
  const denom = gA.length + gB.length;
  if (denom === 0) return 0;
  return (2 * common) / denom; // Dice coefficient (0..1)
}

// Better smartSimilarity combining edit-distance and token similarity
function smartSimilarity(a, b) {
  const A = singularize(normalizeToken(a || ''));
  const B = singularize(normalizeToken(b || ''));
  if (!A || !B) return 0;

  if (A === B) return 1.0;
  // if substring -> strong score
  if (A.includes(B) || B.includes(A)) {
    // slightly boost shorter substring matches
    const ratio = Math.min(A.length, B.length) / Math.max(A.length, B.length);
    return 0.9 + 0.1 * ratio; // 0.9..1.0
  }

  // Edit distance normalized
  const ed = editDistance(A, B);
  const maxLen = Math.max(A.length, B.length, 1);
  const edScore = 1 - (ed / maxLen); // 0..1 (higher = more similar)

  // ngram overlap
  const ngScore = calculateSimilarity(A, B); // 0..1

  // combine with weights — favor overlap for short tokens, edScore for longer tokens
  const lenFactor = Math.min(1, Math.max(A.length, B.length) / 8); // 0..1
  const combined = (0.6 * edScore * lenFactor) + (0.4 * ngScore * (1 - lenFactor)) + (0.2 * Math.max(edScore, ngScore) * (1 - lenFactor));
  // clamp 0..1
  return Math.max(0, Math.min(1, combined));
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
  const message = userMessage.toLowerCase();
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
    // expand variants once
    const expandedVariants = [];
    for (const category of cat1Categories) {
      const variants = expandCategoryVariants(category); // normalized pieces
      // include original normalized full phrase too
      const fullNorm = normalizeToken(category);
      if (fullNorm) variants.push(fullNorm);
      for (const v of variants) {
        if (v && v.length > 0) expandedVariants.push(v);
      }
    }

    // compute best score across all search terms and variants
    let best = null; // {score, term, variant}
    for (const searchTerm of searchTerms) {
      for (const variant of expandedVariants) {
        // skip clothing categories (you had earlier)
        const isClothing = clothingKeywords.some(clothing => variant.includes(clothing));
        if (isClothing) continue;

        const sim = smartSimilarity(variant, searchTerm);
        // normalize: boost short exact-ish matches (e.g., "clock" vs "clocks")
        const lenPenalty = Math.min(1, Math.max(1, Math.abs(variant.length - searchTerm.length)) / Math.max(variant.length, 1));
        const adjusted = sim * (1 - 0.15 * lenPenalty); // small penalty for length mismatch

        if (!best || adjusted > best.score) {
          best = { score: Number(adjusted.toFixed(3)), term: searchTerm, variant };
        }
      }
    }

    if (best && best.score >= 0.75) { // more permissive threshold
      matches.push({
        ...item,
        matchType: best.score >= 0.9 ? 'exact' : (best.score >= 0.85 ? 'strong' : 'similar'),
        matchedTerm: best.term,
        matchedVariant: best.variant,
        score: best.score
      });
    }
  });

  // sort by score & return top 5
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}


/* -------------------------
   Seller matching (three-step) + simplified home-only GPT check
   NOTE: GPT is the decision-maker now (we call GPT-4 for checks)
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6; // threshold for considering home strongly related
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

// New: Ask GPT-4 whether the query is home-related (returns score 0..1)
async function isQueryHome(userMessage) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  const prompt = `
You are a classifier that returns how strongly the user's query is about HOME / HOME DECOR (vases, lamps, clocks, showpieces, cushions, soft furnishings, decor, furniture, etc.) vs. other categories.

Return only JSON: { "is_home_score": 0.0 }
Where is_home_score is 0.0 - 1.0 (1.0 = definitely home decor). No extra text.
User query: "${userMessage}"
  `;
  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: "You are a concise classifier that returns only JSON with is_home_score." },
        { role: "user", content: prompt }
      ],
      max_tokens: 40,
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
      model: GPT_MODEL,
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
async function findSellersForQuery(userMessage, galleryMatches = []) {
  // 0) ask GPT if this is strongly home-related
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome;

  // 1) type2 -> store_name mapping
  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }

  // 2) category_ids-based matches
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

  // 3) GPT-based predictions on candidate pool
  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  if (candidateIds.size === 0) {
    if (applyHomeFilter) {
      for (const s of sellersData) {
        const arr = s.category_ids_array || [];
        if (arr.some(c => c.includes('home') || c.includes('decor') || c.includes('furnit') || c.includes('vase') || c.includes('lamp') || c.includes('clock'))) {
          candidateList.push(s);
          if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        }
      }
    }
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
    homeCheck // for debugging if needed
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
   Helper: GPT-powered gallery matching (uses GPT-4)
--------------------------*/
async function findGptMatchedCategories(userMessage) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id
    }));

    const prompt = `
USER MESSAGE: "${userMessage}"

AVAILABLE PRODUCT CATEGORIES (from CSV):
${JSON.stringify(csvDataForGPT, null, 2)}

TASK:
1. Understand what product the user is looking for (handle misspellings, abbreviations).
2. Find the BEST matching categories from the CSV data.
3. Return the top 5 most relevant matches in JSON format.

RESPONSE FORMAT:
{ "matches": [ { "type2": "exact-type2-value-from-csv", "reason": "brief explanation", "relevance_score": 0.9 } ] }

Only return JSON.
    `;

    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: "You are a product matching expert for Zulu Club. Return valid JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    let matches = [];
    try {
      matches = JSON.parse(responseText).matches || [];
    } catch (e) {
      console.error('Error parsing GPT product matches JSON:', e, 'raw:', responseText);
      matches = [];
    }

    // map to actual category objects and attach relevance_score; if no score, estimate via smartSimilarity
    const mapped = matches.map(m => {
      const item = galleriesData.find(x => x.type2 === m.type2);
      if (!item) return null;
      const score = (typeof m.relevance_score === 'number') ? Number(m.relevance_score) : null;
      return { item, score, reason: m.reason || '' };
    }).filter(Boolean);

    // if GPT returned nothing or low scores, fallback: run local matching and merge top local matches
    if (mapped.length === 0 || mapped.every(m => (m.score || 0) < 0.4)) {
      // fallback to local keyword search on the whole CSV: pick up to 5 best local matches
      const localMatches = [];
      for (const g of galleriesData) {
        const variants = expandCategoryVariants(g.cat1 || g.type2 || '');
        let best = 0;
        for (const v of variants) {
          const sim = smartSimilarity(v, userMessage); // userMessage normalized inside smartSimilarity
          if (sim > best) best = sim;
        }
        if (best > 0.5) localMatches.push({ item: g, score: Number(best.toFixed(3)) });
      }
      const sortedLocal = localMatches.sort((a,b)=>b.score-a.score).slice(0,5);
      return sortedLocal.map(x => x.item);
    }

    // sort by score descending and return up to 5 items
    const final = mapped.sort((a,b) => (b.score || 0) - (a.score || 0)).slice(0,5).map(x => x.item);
    return final;

  } catch (error) {
    console.error('Error in findGptMatchedCategories:', error);
    return [];
  }
}


/* -------------------------
   Company Response Generator (GPT-based; instructs model to include onboarding link if user asks)
--------------------------*/
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  // System prompt instructs model to produce concise responses under ~200 chars suitable for WhatsApp.
  const systemContent = `
You are a friendly customer service assistant for Zulu Club (a lifestyle shopping service).
Use the company info below to answer user questions conversationally and helpfully.
If the user asks about selling/joining/onboarding, include a concise seller onboarding instruction with this link: https://app.zulu.club/brand
Rules:
- Keep responses short (<= 200 characters) and WhatsApp-friendly.
- Use emojis sparingly to be friendly.
- If the user asks about products/categories/pop-ups/location/delivery/returns/onboarding, answer specifically and concisely.
- If the user asks general questions unrelated to shopping, give a short helpful answer and refer to zulu.club.
Company Info:
${companyInfo}
  `;

  const messages = [{ role: "system", content: systemContent }];

  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => {
      if (msg.role && msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    });
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.6
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error in generateCompanyResponse:', err);
    // fallback short
    return `Zulu Club: 100-minute delivery in Gurgaon. Visit zulu.club or ask what you'd like to shop.`;
  }
}

/* -------------------------
   Main: GPT-driven intent + flow
--------------------------*/
// GPT-only intent detection (drop-in replacement for detectIntent)
// Uses GPT-4 by default (set process.env.GPT_MODEL to override).
// Returns 'product' or 'company'.
async function detectIntent(userMessage) {
  try {
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return 'company';
    }

    const model = process.env.GPT_MODEL || 'gpt-4';
    const examples = [
      // COMPANY (explicit)
      { q: "What is Zulu Club?", intent: "company" },
      { q: "Which categories do you offer?", intent: "company" },
      { q: "Where are your pop-ups located?", intent: "company" },
      { q: "How do I become a seller?", intent: "company" },
      { q: "Do you deliver in Gurgaon?", intent: "company" },
      { q: "What is your return policy?", intent: "company" },
      { q: "Who are you?", intent: "company" },
      { q: "Contact support", intent: "company" },
      { q: "Tell me about Zulu Club", intent: "company" },

      // PRODUCT (explicit)
      { q: "Show me red dresses", intent: "product" },
      { q: "Do you have vases or showpieces?", intent: "product" },
      { q: "I want a black t-shirt", intent: "product" },
      { q: "kids toys available", intent: "product" },
      { q: "do you have lamps for living room?", intent: "product" },
      { q: "Looking for women's sandals", intent: "product" },

      // AMBIGUOUS / BORDERLINE — labelled to teach proper handling
      { q: "what categories do you sell", intent: "company" },               // company-level question
      { q: "categories in home decor", intent: "product" },                  // user asking about products in a category
      { q: "Do you have home decor like clocks?", intent: "product" },       // product intent
      { q: "Where can I find your pop-up schedule and categories?", intent: "company" },
      { q: "I need watches and belts", intent: "product" },
      { q: "Tell me about try-at-home and returns", intent: "company" }
    ];

    // Build messages: system instructions + few-shot pairs
    const messages = [
      {
        role: "system",
        content:
`You are a strict intent classifier for Zulu Club. Classify the user's message into exactly one of two intents: "company" or "product".

- "company" = user asks about the company, services, logistics, pop-ups, onboarding/selling, policies, contact, or general info (e.g., "What is Zulu Club?", "How to become a seller", "Where are your pop-ups?").
- "product" = user explicitly asks to browse, find, or buy items or asks about availability of items or categories as items (e.g., "Do you have vases?", "Show me red dresses", "I want lamps for living room").

Return output as only valid JSON, nothing else, in this exact format:

{ "intent": "company" | "product", "confidence": 0.00 }

Where confidence is a number between 0.00 and 1.00 representing how sure you are. Be concise and deterministic.
`
      }
    ];

    // Add few-shot examples
    for (const ex of examples) {
      messages.push({ role: "user", content: ex.q });
      messages.push({ role: "assistant", content: JSON.stringify({ intent: ex.intent, confidence: 0.95 }) });
    }

    // Add the actual user query and instruction to respond only with JSON
    messages.push({
      role: "user",
      content: `Classify this message and return ONLY JSON:\n\n"${userMessage}"`
    });

    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 140,   // allow room for reasoned confidence
      temperature: 0.0,  // deterministic
      top_p: 1.0
    });

    const raw = completion.choices[0].message.content.trim();

    // Extract JSON object from model output robustly
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      console.warn('detectIntent: no JSON found in model response:', raw);
      return 'company';
    }
    const jsonText = raw.slice(firstBrace, lastBrace + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error('detectIntent: JSON parse error:', parseErr, 'raw:', jsonText);
      return 'company';
    }

    const intent = String(parsed.intent || '').toLowerCase();
    const confidence = Number(parsed.confidence || 0);

    // Safety: normalize intent
    if (intent === 'product') return 'product';
    if (intent === 'company') return 'company';

    // fallback: use confidence threshold
    return confidence >= 0.5 ? 'product' : 'company';

  } catch (err) {
    console.error('detectIntent error:', err);
    return 'company';
  }
}


async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    // Let GPT decide intent
    const intent = await detectIntent(userMessage);
    console.log('🎯 GPT decided intent:', intent);

    if (intent === 'product' && galleriesData.length > 0) {
      const isClothingQuery = containsClothingKeywords(userMessage);

      if (isClothingQuery) {
        // GPT-match galleries (clothing -> use GPT)
        const matchedCategories = await findGptMatchedCategories(userMessage);
        const sellers = await findSellersForQuery(userMessage, matchedCategories);
        return buildConciseResponse(userMessage, matchedCategories, sellers);
      } else {
        // Try quick keyword matches first for speed, then GPT fallback
        const keywordMatches = findKeywordMatchesInCat1(userMessage);
        if (keywordMatches.length > 0) {
          const sellers = await findSellersForQuery(userMessage, keywordMatches);
          return buildConciseResponse(userMessage, keywordMatches, sellers);
        } else {
          const matchedCategories = await findGptMatchedCategories(userMessage);
          const sellers = await findSellersForQuery(userMessage, matchedCategories);
          return buildConciseResponse(userMessage, matchedCategories, sellers);
        }
      }
    }

    // company intent -> let GPT produce a helpful company response (including onboarding link if requested)
    return await generateCompanyResponse(userMessage, conversationHistory, companyInfo);

  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Existing endpoints + handlers
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
    version: '7.0 - GPT-4 is boss (intent, matching, seller checks)',
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
app.get('/debug-match', async (req, res) => {
  const q = req.query.query || req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query parameter `query`' });

  const keywordMatches = findKeywordMatchesInCat1(q);
  const gptMatches = await findGptMatchedCategories(q);
  const sellers = await findSellersForQuery(q, keywordMatches);

  res.json({ query: q, keywordMatches, gptMatches: gptMatches.map(g=>({type2:g.type2, cat1:g.cat1, cat_id:g.cat_id})), sellers, galleriesCount: galleriesData.length, sellersCount: sellersData.length, homeCheck: (await isQueryHome(q)) });
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

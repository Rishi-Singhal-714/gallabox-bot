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

/* -------------------------
   CSV loaders: galleries + sellers
   (sellers.csv assumed at the URL — change if needed)
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
          const mapped = {
            seller_id: data.seller_id || data.SELLER_ID || data.id || data.ID || '',
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
   Seller matching (three-step)
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
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

async function findSellersForQuery(userMessage, galleryMatches = []) {
  // sellers from gallery type2
  const sellers_by_type2_map = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2);
    found.forEach(s => sellers_by_type2_map.set(s.seller_id || (s.store_name+'#'), s));
  }

  // category-based
  const catMatches = matchSellersByCategoryIds(userMessage);
  const sellers_by_category_map = new Map();
  catMatches.forEach(s => sellers_by_category_map.set(s.seller_id || (s.store_name+'#'), s));

  // candidate pool for GPT checks
  const candidateIds = new Set([...sellers_by_type2_map.keys(), ...sellers_by_category_map.keys()]);
  const candidateList = [];
  if (candidateIds.size === 0) {
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length); i++) candidateList.push(sellersData[i]);
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
    const result = await gptCheckSellerMaySell(userMessage, seller);
    if (result.score > GPT_THRESHOLD) {
      sellers_by_gpt.push({ seller, score: result.score, reason: result.reason });
    }
  }

  const sellersType2Arr = Array.from(sellers_by_type2_map.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category_map.values()).slice(0, 10);

  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt
  };
}

/* -------------------------
   Small/concise response builder
   - Up to 5 galleries, up to 5 sellers total (unique)
   - No side talk; single intro line
--------------------------*/
function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(t.trim().replace(/\s+/g, ' ')).replace(/%20/g, '%20');
}

function buildConciseResponse(userMessage, galleryMatches = [], sellersObj = {}) {
  // galleries: up to 5 unique type2s from galleryMatches; if none, pick top 5 from galleriesData as fallback
  const galleries = (galleryMatches && galleryMatches.length) ? galleryMatches.slice(0,5) : galleriesData.slice(0,5);
  // sellers: combine by_type2, by_category, by_gpt in that order, dedupe and keep up to 5
  const sellersList = [];
  const addSeller = (s) => {
    if (!s) return;
    const id = s.seller_id || '';
    if (!id) return;
    if (!sellersList.some(x => x.seller_id === id)) sellersList.push(s);
  };
  (sellersObj.by_type2 || []).forEach(addSeller);
  (sellersObj.by_category || []).forEach(addSeller);
  (sellersObj.by_gpt || []).forEach(item => addSeller(item.seller));
  // ensure limit 5
  const sellersToShow = sellersList.slice(0,5);

  // Build message
  let msg = `Based on your interest in "${userMessage}":\n`;

  // Galleries
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

  // Sellers
  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  // final ensure message length is compact
  return msg.trim();
}

/* -------------------------
   Helper to get GPT-matched gallery categories as array (returns matchedCategories[])
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
1. Understand what product the user is looking for (even if misspelled or incomplete like "tshir" for "t-shirt")
2. Find the BEST matching categories from the CSV data
3. Return the top 5 most relevant matches in JSON format

RESPONSE FORMAT:
{
  "matches": [
    { "type2": "exact-type2-value-from-csv", "reason": "brief explanation", "relevance_score": 0.9 }
  ]
}

Only return JSON.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product matching expert for Zulu Club. Return valid JSON.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3,
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

    const matchedCategories = matches
      .map(match => galleriesData.find(item => item.type2 === match.type2))
      .filter(Boolean)
      .slice(0,5);

    return matchedCategories;
  } catch (error) {
    console.error('Error in findGptMatchedCategories:', error);
    return [];
  }
}

/* -------------------------
   Main product flow: detect intent, match galleries, find sellers, and respond concisely
--------------------------*/
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    const intent = await detectIntent(userMessage);
    
    if (intent === 'product' && galleriesData.length > 0) {
      const isClothingQuery = containsClothingKeywords(userMessage);
      
      if (isClothingQuery) {
        // Use GPT to find gallery matches (clothing -> GPT matching) and then sellers
        const matchedCategories = await findGptMatchedCategories(userMessage);
        const sellers = await findSellersForQuery(userMessage, matchedCategories);
        return buildConciseResponse(userMessage, matchedCategories, sellers);
      } else {
        // Try keyword matching first
        const keywordMatches = findKeywordMatchesInCat1(userMessage);
        if (keywordMatches.length > 0) {
          const sellers = await findSellersForQuery(userMessage, keywordMatches);
          return buildConciseResponse(userMessage, keywordMatches, sellers);
        } else {
          // fallback to GPT matching
          const matchedCategories = await findGptMatchedCategories(userMessage);
          const sellers = await findSellersForQuery(userMessage, matchedCategories);
          return buildConciseResponse(userMessage, matchedCategories, sellers);
        }
      }
    }

    // not a product intent -> keep company response (kept short for WhatsApp)
    return await generateCompanyResponseShort(userMessage, conversationHistory, companyInfo);
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    // concise fallback
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Short company response (kept short)
--------------------------*/
async function generateCompanyResponseShort(userMessage, conversationHistory, companyInfo) {
  // Keep it short for WhatsApp
  return `Hi! Zulu Club: 100-minute delivery in Gurgaon. Visit zulu.club or ask what you want to shop.`;
}

/* -------------------------
   Existing functions left intact for other endpoints/tests
   (generateProductResponseFromMatches, etc.)
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
      const sellerLink = `app.zulu.club/sellerassets/${String(match.seller_id).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  return response;
}

async function handleProductIntentWithGPT(userMessage) {
  // kept for backward compatibility: returns a textual response (not used for WhatsApp message brevity)
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
      const sellerLink = `app.zulu.club/sellerassets/${String(category.seller_id).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  return response;
}

function generateFallbackProductResponse() {
  return `🎉 Zulu Club offers many categories — visit zulu.club to browse.`;
}

/* -------------------------
   Intent detection (kept)
--------------------------*/
async function detectIntent(userMessage) {
  try {
    const prompt = `
    Analyze the following user message and determine if the intent is:
    - "company": Asking about Zulu Club as a company, services, delivery, returns, general information
    - "product": Asking about specific products, categories, items, shopping, browsing, what's available

    User Message: "${userMessage}"

    Respond with ONLY one word: either "company" or "product"
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are an intent classifier. Answer only 'company' or 'product'."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    });

    const intent = completion.choices[0].message.content.trim().toLowerCase();
    return intent === 'product' ? 'product' : 'company';
    
  } catch (error) {
    console.error('Error in intent detection:', error);
    return 'company';
  }
}

/* -------------------------
   Webhook + endpoints (kept, but messages will now be concise)
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
    version: '6.0 - Concise Messages (5 galleries, 5 sellers)',
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
    res.json({ query, is_clothing_query: isClothing, keyword_matches: keywordMatches, sellers, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
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

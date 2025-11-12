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
let sellersData = []; // NEW: sellers CSV data

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

/* -----------------------------------------
   Load galleries.csv (existing) & sellers.csv (new)
   - sellers CSV expected to have columns: seller_id, store_name, category_ids (comma-separated), other fields allowed
-------------------------------------------- */
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
    // CHANGE THIS URL if your sellers CSV is elsewhere
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
          // robust mapping of seller CSV headers
          const mapped = {
            seller_id: data.seller_id || data.SELLER_ID || data.id || data.ID || '',
            store_name: data.store_name || data.StoreName || data.store || data.Store || '',
            category_ids: data.category_ids || data.CATEGORY_IDS || data.categories || data.Categories || '',
            // store any other fields if present
            raw: data
          };
          if (mapped.seller_id || mapped.store_name) {
            // normalize category_ids to array
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

// Initialize CSV data on server start
(async () => {
  try {
    const g = await loadGalleriesData();
    galleriesData = g;
  } catch (e) {
    console.error('Failed to load galleries data:', e);
  }

  try {
    const s = await loadSellersData();
    sellersData = s;
  } catch (e) {
    console.error('Failed to load sellers data:', e);
  }
})();

/* -----------------------------------------
   Existing sendMessage function (unchanged)
-------------------------------------------- */
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

/* -----------------------------------------
   Matching Helpers (kept + improved)
-------------------------------------------- */

// Basic normalization
function normalizeToken(t) {
  if (!t) return '';
  return String(t)
    .toLowerCase()
    .replace(/&/g, ' and ')         // keep semantic split but preserve word boundaries
    .replace(/[^a-z0-9\s]/g, ' ')   // drop punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Very light singularization for common plural forms
function singularize(word) {
  if (!word) return '';
  if (word.endsWith('ies') && word.length > 3) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
}

// Compute Levenshtein distance
function editDistance(a, b) {
  const s = a || '', t = b || '';
  const m = s.length, n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// Wrap similarity: uses editDistance + char overlap
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

// Split a cat1 category into variants (full phrase + '&' parts)
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

/* -----------------------------------------
   Existing gallery matching (kept) - findKeywordMatchesInCat1
-------------------------------------------- */
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  if (longer.includes(shorter)) return 0.95;
  const commonChars = [...shorter].filter(char => longer.includes(char)).length;
  return commonChars / longer.length;
}

function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men', 'women', 'kids', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
  const message = userMessage.toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

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

  console.log(`🔍 Searching for keywords in cat1:`, searchTerms);
  
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
  
  console.log(`🎯 Found ${matches.length} keyword matches in cat1`);
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

/* -----------------------------------------
   NEW: Seller matching logic (three steps)
   1) type2 -> seller.store_name (ignore clothing words)
   2) seller.category_ids (category_ids column)
   3) GPT-based probability check (score > 0.7)
-------------------------------------------- */

const MAX_GPT_SELLER_CHECK = 20; // adjust to control API calls
const GPT_THRESHOLD = 0.7;
const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];

// helper: remove clothing prefixes from a type2 phrase (e.g., "men xyz brand" -> "xyz brand")
function stripClothingFromType2(type2) {
  if (!type2) return type2;
  let tokens = type2.split(/\s+/);
  // remove leading clothing tokens repeatedly
  while (tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g, ''))) {
    tokens.shift();
  }
  return tokens.join(' ').trim();
}

// match sellers by store_name using smartSimilarity
function matchSellersByStoreName(type2Value) {
  if (!type2Value || !sellersData.length) return [];
  const stripped = stripClothingFromType2(type2Value);
  const norm = normalizeToken(stripped);
  if (!norm) return [];

  const matches = [];
  sellersData.forEach(seller => {
    const store = seller.store_name || '';
    const sim = smartSimilarity(store, norm);
    if (sim >= 0.82) { // threshold for store-name match
      matches.push({ seller, score: sim });
    }
  });
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0, 10);
}

// match sellers by category_ids (if seller.category_ids contains any word present in userMessage)
function matchSellersByCategoryIds(userMessage) {
  if (!userMessage || !sellersData.length) return [];
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matches = [];
  sellersData.forEach(seller => {
    const categories = seller.category_ids_array || [];
    // check intersection
    const common = categories.filter(c => terms.some(t => t.includes(c) || c.includes(t)));
    if (common.length > 0) {
      matches.push({ seller, matches: common.length });
    }
  });
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0, 10);
}

// GPT-based check: ask model "Given seller info, how likely they sell X?" -> return score 0..1 and reason
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
      // fallback: if model didn't return JSON, be conservative
      return { score: 0, reason: 'GPT response could not be parsed' };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error' };
  }
}

// master function to find sellers for a user query (combines three methods)
async function findSellersForQuery(userMessage, galleryMatches = []) {
  // 1) If we already have gallery type2 matches, use those type2 -> store_name mapping as first source
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

  // 3) GPT-based predictions: run GPT checks on a candidate pool
  // Candidate pool: union of top sellers from previous two methods; if empty, take top N sellers from sellersData
  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  if (candidateIds.size === 0) {
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length); i++) candidateList.push(sellersData[i]);
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name+'#') == id));
      if (s) candidateList.push(s);
    }
    // ensure we have at most MAX_GPT_SELLER_CHECK
    if (candidateList.length < MAX_GPT_SELLER_CHECK) {
      // fill with more sellers if needed
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

  // Convert maps to arrays
  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);

  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt
  };
}

/* -----------------------------------------
   Existing product flow with seller matching integrated
-------------------------------------------- */

async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // First, detect intent
    const intent = await detectIntent(userMessage);
    console.log(`🎯 Detected intent: ${intent}`);
    
    // If product intent, use appropriate matching strategy
    if (intent === 'product' && galleriesData.length > 0) {
      // Check if user is looking for clothing items
      const isClothingQuery = containsClothingKeywords(userMessage);
      
      if (isClothingQuery) {
        console.log('👕 Clothing-related query detected, using GPT matching');
        const productResponse = await handleProductIntentWithGPT(userMessage);
        // For clothing queries, also try matching sellers by categories/store_name where relevant
        const sellers = await findSellersForQuery(userMessage, []); // no gallery matches
        return appendSellersToProductResponse(productResponse, sellers);
      } else {
        console.log('🛍️ Non-clothing query, trying keyword matching first');
        // First try keyword matching in cat1
        const keywordMatches = findKeywordMatchesInCat1(userMessage);
        
        if (keywordMatches.length > 0) {
          console.log(`✅ Found ${keywordMatches.length} keyword matches, using them`);
          const galleryResponse = generateProductResponseFromMatches(keywordMatches, userMessage);
          const sellers = await findSellersForQuery(userMessage, keywordMatches);
          return appendSellersToProductResponse(galleryResponse, sellers);
        } else {
          console.log('🔍 No keyword matches found, falling back to GPT matching');
          const productResponse = await handleProductIntentWithGPT(userMessage);
          const sellers = await findSellersForQuery(userMessage, []); // no gallery matches
          return appendSellersToProductResponse(productResponse, sellers);
        }
      }
    }
    
    // Otherwise, use company response logic
    return await generateCompanyResponse(userMessage, conversationHistory, companyInfo);
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! Visit zulu.club to explore our products or ask me anything! 🛍️";
  }
}

// Append sellers to the product response in the requested grouped format
function appendSellersToProductResponse(productResponseText, sellersObj) {
  // sellersObj: { by_type2: [...], by_category: [...], by_gpt: [{seller,score,reason}] }
  let response = productResponseText;

  response += `\n\nThese are galleries:\n`;
  // (we don't re-list galleries in detail here because original response contains gallery list)
  response += `1\nto if any\n5\n\n`; // preserving the odd format you provided while including sellers below

  response += `these seller something:\n`;

  // 1) by store name (type2 -> store_name)
  response += `1) By store-name match (if any):\n`;
  if (sellersObj.by_type2 && sellersObj.by_type2.length) {
    sellersObj.by_type2.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.seller_id || '';
      response += `${i+1}. ${name}${id ? ` — app.zulu.club/sellerassets/${id}` : ''}\n`;
    });
  } else {
    response += `None\n`;
  }

  // 2) by category_ids
  response += `2) By seller categories (if any):\n`;
  if (sellersObj.by_category && sellersObj.by_category.length) {
    sellersObj.by_category.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.seller_id || '';
      response += `${i+1}. ${name}${id ? ` — app.zulu.club/sellerassets/${id}` : ''}\n`;
    });
  } else {
    response += `None\n`;
  }

  // 3) GPT predicted sellers
  response += `3) GPT-predicted sellers (score > ${GPT_THRESHOLD}):\n`;
  if (sellersObj.by_gpt && sellersObj.by_gpt.length) {
    sellersObj.by_gpt.forEach((item, i) => {
      const s = item.seller;
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.seller_id || '';
      response += `${i+1}. ${name}${id ? ` — app.zulu.club/sellerassets/${id}` : ''} (score: ${Number(item.score).toFixed(2)})\n`;
      if (item.reason) response += `   Reason: ${item.reason}\n`;
    });
  } else {
    response += `None\n`;
  }

  return response;
}

/* -----------------------------------------
   Rest of the existing code (intents, GPT product handler, response generation)
   - I kept these functions but they are unchanged apart from minor wiring to attach seller info
-------------------------------------------- */

// NEW: Generate response from keyword matches (slightly updated to keep seller deep link intact)
function generateProductResponseFromMatches(matches, userMessage) {
  if (matches.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Perfect! Based on your search for "${userMessage}", I found these matching categories: 🛍️\n\n`;
  
  matches.forEach((match, index) => {
    const link = `app.zulu.club/${match.type2.replace(/ /g, '%20')}`;
    const displayCategories = match.type2.split(',').slice(0, 2).join(', ');
    const matchInfo = match.matchType === 'exact' ? '✅ Exact match' : '🔍 Similar match';
    
    response += `${index + 1}. ${displayCategories}\n   ${matchInfo}\n   🔗 ${link}\n`;

    if (match.seller_id && String(match.seller_id).trim().length > 0) {
      const sellerLink = `app.zulu.club/sellerassets/${String(match.seller_id).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  
  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;
  
  if (response.length > 1500) {
    response = response.substring(0, 1500) + '...\n\nVisit zulu.club for more categories!';
  }
  
  return response;
}

// Intent Detection Function (kept)
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
          content: "You are an intent classifier. Analyze the user's message and determine if they're asking about the company in general or about specific products. Respond with only one word: 'company' or 'product'."
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

// GPT-Powered Product Intent Handler (kept; attaches seller info later upstream)
async function handleProductIntentWithGPT(userMessage) {
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

    MATCHING RULES:
    - Be intelligent about matching: "tshir" → "T Shirts", "fountain" → "Home Decor", "makeup" → "Beauty"
    - Consider synonyms and related products
    - Look for any match in the cat1 field (which contains multiple categories separated by commas)
    - Prioritize closer matches

    RESPONSE FORMAT:
    {
      "matches": [
        {
          "type2": "exact-type2-value-from-csv",
          "reason": "brief explanation why this matches",
          "relevance_score": 0.9
        }
      ]
    }

    Only return JSON, no additional text.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product matching expert for Zulu Club. You match user queries to product categories intelligently. 
          You understand misspellings, abbreviations, and related terms. Always return valid JSON with matches array.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('🤖 GPT Product Matching Response:', responseText);
    
    let matches;
    try {
      matches = JSON.parse(responseText).matches;
    } catch (parseError) {
      console.error('Error parsing GPT response:', parseError);
      matches = [];
    }

    if (!matches || matches.length === 0) {
      return generateFallbackProductResponse();
    }

    const matchedCategories = matches
      .map(match => {
        const category = galleriesData.find(item => item.type2 === match.type2);
        return category ? { ...category, reason: match.reason } : null;
      })
      .filter(Boolean)
      .slice(0, 5);

    console.log(`🎯 Final matched categories:`, matchedCategories);
    return generateProductResponseWithGPT(matchedCategories, userMessage);
    
  } catch (error) {
    console.error('Error in GPT product matching:', error);
    return generateFallbackProductResponse();
  }
}

function generateProductResponseWithGPT(matchedCategories, userMessage) {
  if (matchedCategories.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Perfect! Based on your interest in "${userMessage}", I found these great categories for you: 🛍️\n\n`;
  
  matchedCategories.forEach((category, index) => {
    const link = `app.zulu.club/${category.type2.replace(/ /g, '%20')}`;
    const displayCategories = category.type2.split(',').slice(0, 2).join(', ');
    response += `${index + 1}. ${displayCategories}\n   🔗 ${link}\n`;

    if (category.seller_id && String(category.seller_id).trim().length > 0) {
      const sellerLink = `app.zulu.club/sellerassets/${String(category.seller_id).trim()}`;
      response += `   You can also shop directly from:\n   • Seller: ${sellerLink}\n`;
    }
  });
  
  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;
  
  if (response.length > 1500) {
    response = response.substring(0, 1500) + '...\n\nVisit zulu.club for more categories!';
  }
  
  return response;
}

function generateFallbackProductResponse() {
  return `🎉 Exciting news! Zulu Club offers amazing products across all categories:\n\n• 👗 Women's Fashion (Dresses, Jewellery, Handbags)\n• 👔 Men's Fashion (Shirts, T-Shirts, Kurtas)\n• 👶 Kids & Toys\n• 🏠 Home Decor\n• 💄 Beauty & Self-Care\n• 👠 Footwear & Sandals\n• 👜 Accessories\n• 🎁 Lifestyle Gifting\n\nExperience 100-minute delivery in Gurgaon! 🚀\n\nBrowse all categories at: zulu.club\nOr tell me what specific products you're looking for!`;
}

/* -----------------------------------------
   The rest of your server code (webhook, endpoints) is kept unchanged
-------------------------------------------- */

// Handle user message with AI
async function handleMessage(sessionId, userMessage) {
  try {
    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [] };
    }
    
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage
    });
    
    const aiResponse = await getChatGPTResponse(
      userMessage, 
      conversations[sessionId].history
    );
    
    conversations[sessionId].history.push({
      role: "assistant",
      content: aiResponse
    });
    
    if (conversations[sessionId].history.length > 10) {
      conversations[sessionId].history = conversations[sessionId].history.slice(-10);
    }
    
    return aiResponse;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our premium lifestyle products with 100-minute delivery in Gurgaon!";
  }
}

// Webhook endpoint to receive messages
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
    
    res.status(200).json({ 
      status: 'success', 
      message: 'Webhook processed successfully',
      processed: true 
    });
    
  } catch (error) {
    console.error('💥 Webhook error:', error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      processed: false 
    });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '6.0 - Enhanced Keyword + GPT Matching + Seller Matching',
    features: {
      keyword_matching: 'Exact/90% matches in cat1 column (non-clothing)',
      clothing_detection: 'Automatically detects men/women/kids queries',
      gpt_matching: 'GPT-powered intelligent product matching',
      dual_strategy: 'Keyword first, GPT fallback for non-clothing queries',
      intelligent_matching: 'Understands misspellings and related terms',
      seller_matching: 'type2->store_name, category_ids, GPT-predicted sellers',
      link_generation: 'Dynamic app.zulu.club link generation',
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      whatsapp_integration: 'Gallabox API integration'
    },
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_conversations: Object.keys(conversations).length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      refresh_csv: 'GET /refresh-csv',
      test_key_word_matching: '/test-keyword-matching',
      test_matching: 'GET /test-keyword-matching',
      test_gpt_matching: 'GET /test-gpt-matching'
    },
    timestamp: new Date().toISOString()
  });
});

// Endpoint to refresh CSV data
app.get('/refresh-csv', async (req, res) => {
  try {
    const newData = await loadGalleriesData();
    galleriesData = newData;
    const newSellers = await loadSellersData();
    sellersData = newSellers;
    
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully',
      categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: error.message
    });
  }
});

// NEW: Test keyword matching endpoint (unchanged)
app.get('/test-keyword-matching', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const isClothing = containsClothingKeywords(query);
    const keywordMatches = findKeywordMatchesInCat1(query);
    const sellers = await findSellersForQuery(query, keywordMatches);
    const response = generateProductResponseFromMatches(keywordMatches, query);
    const combined = appendSellersToProductResponse(response, sellers);
    res.json({
      query,
      is_clothing_query: isClothing,
      keyword_matches: keywordMatches,
      sellers,
      response_preview: combined,
      categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test GPT matching endpoint
app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const result = await handleProductIntentWithGPT(query);
    res.json({
      query,
      result: result,
      categories_loaded: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to send a message manually
app.post('/send-test-message', async (req, res) => {
  try {
    const { to, name, message } = req.body;
    
    if (!to) {
      return res.status(400).json({ 
        error: 'Missing "to" in request body',
        example: { 
          "to": "918368127760", 
          "name": "Rishi",
          "message": "What products do you have?" 
        }
      });
    }
    
    const result = await sendMessage(
      to, 
      name || 'Test User', 
      message || 'Hello! This is a test message from Zulu Club AI Assistant. 🚀'
    );
    
    res.json({ 
      status: 'success', 
      message: 'Test message sent successfully',
      data: result 
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to send test message',
      details: error.message
    });
  }
});

// Export for Vercel
module.exports = app;

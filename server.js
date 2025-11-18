// server.js - GPT-first intent + category matcher (AI is the boss)
// Adds session-based history (per phone number), 1-hour sessions, and passes history to GPT prompts.

const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
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
// conversations keyed by sessionId (phone number). Each entry: { history: [ {role, content, ts} ], lastActive: timestampMS }
let conversations = {};
let galleriesData = [];
let sellersData = [];

// Session configuration
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_CLEANUP_MS = 1000 * 60 * 5; // cleanup every 5 minutes
const MAX_HISTORY_MESSAGES = 50; // max messages to keep per session

// ZULU CLUB INFORMATION (kept)
const ZULU_CLUB_INFO = `...`; // keep your original content (omitted for brevity in this snippet) - replace as needed
const INVESTORS_PARAGRAPH = `...`;

/* -------------------------
   CSV loaders
--------------------------*/
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv', { timeout: 60000 });
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
            cat_id: data.cat_id || data.CAT_ID || '',
            cat1: data.cat1 || data.Cat1 || data.CAT1 || '',
            seller_id: data.seller_id || data.SELLER_ID || data.Seller_ID || data.SellerId || data.sellerId || ''
          };
          if (mappedData.type2 && mappedData.cat1) results.push(mappedData);
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
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv', { timeout: 60000 });
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

// initialize CSVs
(async () => {
  galleriesData = await loadGalleriesData().catch(e => { console.error(e); return []; });
  sellersData = await loadSellersData().catch(e => { console.error(e); return []; });
})();

/* -------------------------
   Session utilities
--------------------------*/
function nowMs() { return Date.now(); }

function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = { history: [], lastActive: nowMs() };
  } else {
    conversations[sessionId].lastActive = nowMs();
  }
  return conversations[sessionId];
}

function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  const entry = { role, content, ts: nowMs() };
  conversations[sessionId].history.push(entry);
  // keep history length bounded
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  conversations[sessionId].lastActive = nowMs();
}

function getSessionHistory(sessionId, options = { lastMinutes: 60 }) {
  const session = conversations[sessionId];
  if (!session || !session.history) return [];
  if (!options.lastMinutes) return session.history.slice();
  const cutoff = nowMs() - (options.lastMinutes * 60 * 1000);
  return session.history.filter(h => h.ts >= cutoff);
}

function purgeExpiredSessions() {
  const cutoff = nowMs() - SESSION_TTL_MS;
  const before = Object.keys(conversations).length;
  for (const id of Object.keys(conversations)) {
    if (!conversations[id].lastActive || conversations[id].lastActive < cutoff) {
      delete conversations[id];
    }
  }
  const after = Object.keys(conversations).length;
  if (before !== after) console.log(`🧹 Purged ${before - after} expired sessions`);
}
setInterval(purgeExpiredSessions, SESSION_CLEANUP_MS);

/* -------------------------
   Messaging helper (unchanged)
--------------------------*/
async function sendMessage(to, name, message) {
  try {
    const payload = {
      channelId: gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: { name: name, phone: to },
      whatsapp: { type: "text", text: { body: message } }
    };
    const response = await axios.post(`${gallaboxConfig.baseUrl}/messages/whatsapp`, payload, {
      headers: { 'apiKey': gallaboxConfig.apiKey, 'apiSecret': gallaboxConfig.apiSecret, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', { status: error.response?.status, data: error.response?.data, message: error.message });
    throw error;
  }
}

/* -------------------------
   Text normalization & matching helpers (kept)
--------------------------*/
function normalizeToken(t) {
  if (!t) return '';
  return String(t).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function singularize(word) { if (!word) return ''; if (word.endsWith('ies') && word.length>3) return word.slice(0,-3)+'y'; if (word.endsWith('ses') && word.length>3) return word.slice(0,-2); if (word.endsWith('es') && word.length>3) return word.slice(0,-2); if (word.endsWith('s') && word.length>2) return word.slice(0,-1); return word; }
function editDistance(a,b){ const s=a||'', t=b||''; const m=s.length,n=t.length; const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0)); for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j; for(let i=1;i<=m;i++){ for(let j=1;j<=n;j++){ const cost = s[i-1]===t[j-1]?0:1; dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost); } } return dp[m][n]; }
function calculateSimilarity(str1,str2){ const longer = str1.length>str2.length?str1:str2; const shorter = str1.length>str2.length?str2:str1; if (longer.length===0) return 1.0; if (longer.includes(shorter)) return 0.95; const commonChars=[...shorter].filter(c=>longer.includes(c)).length; return commonChars/longer.length; }
function smartSimilarity(a,b){ const A = singularize(normalizeToken(a)); const B = singularize(normalizeToken(b)); if(!A||!B) return 0; if(A===B) return 1.0; if(A.includes(B)||B.includes(A)) return 0.95; const ed=editDistance(A,B); const maxLen=Math.max(A.length,B.length); const edScore=1-(ed/Math.max(1,maxLen)); const charOverlap=calculateSimilarity(A,B); return Math.max(edScore,charOverlap); }
function expandCategoryVariants(category){ const norm = normalizeToken(category); const variants = new Set(); if (norm) variants.add(norm); const ampParts = norm.split(/\band\b/).map(s=>normalizeToken(s)); for(const p of ampParts){ if(p && p.length>1) variants.add(p.trim()); } return Array.from(variants); }
const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);
function containsClothingKeywords(userMessage){ const clothingTerms = ['men','women','kids','kid','child','children','man','woman','boy','girl']; const message = (userMessage||'').toLowerCase(); return clothingTerms.some(term=>message.includes(term)); }

/* -------------------------
   Gallery keyword matching (kept)
--------------------------*/
function findKeywordMatchesInCat1(userMessage) {
  if (!userMessage || !galleriesData.length) return [];
  const rawTerms = userMessage.toLowerCase().replace(/&/g,' and ').split(/\s+/).filter(term => term.length>1 && !STOPWORDS.has(term));
  const searchTerms = rawTerms.map(t => singularize(normalizeToken(t))).filter(t => t.length>1);
  const matches = [];
  const clothingKeywords = ['clothing','apparel','wear','shirt','pant','dress','top','bottom','jacket','sweater'];
  galleriesData.forEach(item=>{
    if(!item.cat1) return;
    const cat1Categories = item.cat1.split(',').map(c=>c.trim()).filter(Boolean);
    const expanded = [];
    for(const category of cat1Categories){
      const variants = expandCategoryVariants(category);
      expanded.push(...variants);
    }
    for(const searchTerm of searchTerms){
      for(const variant of expanded){
        const isClothing = clothingKeywords.some(clothing => variant.includes(clothing));
        if (isClothing) continue;
        const sim = smartSimilarity(variant, searchTerm);
        if (sim >= 0.9 || (sim >= 0.82 && Math.abs(variant.length - searchTerm.length) <= 3)) {
          if(!matches.some(m=>m.type2===item.type2)){
            matches.push({ ...item, matchType: sim===1.0 ? 'exact' : 'similar', matchedTerm: searchTerm, score: sim });
          }
        }
      }
    }
  });
  return matches.sort((a,b)=>b.score-a.score).slice(0,5);
}

/* -------------------------
   Seller matching functions (kept)
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;
const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];
function stripClothingFromType2(type2) { if(!type2) return type2; let tokens = type2.split(/\s+/); while(tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g,''))){ tokens.shift(); } return tokens.join(' ').trim(); }

function matchSellersByStoreName(type2Value, detectedGender = null) {
  if(!type2Value || !sellersData.length) return [];
  const stripped = stripClothingFromType2(type2Value);
  const norm = normalizeToken(stripped);
  if(!norm) return [];
  const matches = [];
  sellersData.forEach(seller=>{
    const store = seller.store_name || '';
    const sim = smartSimilarity(store, norm);
    if(sim < 0.82) return;
    if (detectedGender) {
      const sellerGenders = new Set();
      (seller.category_ids_array || []).forEach(c => {
        if (/\bmen\b|\bman\b|\bmens\b/.test(c)) sellerGenders.add('men');
        if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(c)) sellerGenders.add('women');
        if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c)) sellerGenders.add('kids');
      });
      if (sellerGenders.size > 0 && !sellerGenders.has(detectedGender)) return;
    }
    matches.push({ seller, score: sim });
  });
  return matches.sort((a,b)=>b.score-a.score).map(m=>({ ...m.seller, score: m.score })).slice(0,10);
}

function matchSellersByCategoryIds(userMessage, detectedGender = null) {
  if(!userMessage || !sellersData.length) return [];
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
  const matches = [];
  sellersData.forEach(seller=>{
    const categories = seller.category_ids_array || [];
    if (detectedGender) {
      const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
      if (sellerHasGender) {
        const sellerGenderMatch = categories.some(c => {
          if (detectedGender === 'men') return /\bmen\b|\bman\b|\bmens\b/.test(c);
          if (detectedGender === 'women') return /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c);
          if (detectedGender === 'kids') return /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c);
          return false;
        });
        if (!sellerGenderMatch) return;
      }
    }
    const common = categories.filter(c => terms.some(t => t.includes(c) || c.includes(t)));
    if (common.length > 0) matches.push({ seller, matches: common.length });
  });
  return matches.sort((a,b)=>b.matches-a.matches).map(m=>m.seller).slice(0,10);
}

function getUserIdForSellerId(sellerId) {
  if (!sellerId) return '';
  const s = sellersData.find(x => (x.seller_id && String(x.seller_id) === String(sellerId)));
  if (s && s.user_id && String(s.user_id).trim().length > 0) return String(s.user_id).trim();
  return String(sellerId).trim();
}

/* -------------------------
   Infer gender from categories
--------------------------*/
function inferGenderFromCategories(matchedCategories = []) {
  if (!Array.isArray(matchedCategories) || matchedCategories.length === 0) return null;
  const genderScores = { men: 0, women: 0, kids: 0 };
  for (const cat of matchedCategories) {
    const fields = [];
    if (cat.cat_id) fields.push(String(cat.cat_id).toLowerCase());
    if (cat.cat1) fields.push(String(cat.cat1).toLowerCase());
    const combined = fields.join(' ');
    if (/\bmen\b|\bman\b|\bmens\b/.test(combined)) genderScores.men += 1;
    if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(combined)) genderScores.women += 1;
    if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(combined)) genderScores.kids += 1;
  }
  const max = Math.max(genderScores.men, genderScores.women, genderScores.kids);
  if (max === 0) return null;
  const winners = Object.keys(genderScores).filter(k => genderScores[k] === max);
  if (winners.length === 1) return winners[0];
  return null;
}

/* -------------------------
   GPT helpers updated to include conversation history
   NOTE: Every GPT prompt now includes the recent session history (last N messages)
--------------------------*/

function buildHistoryContextForPrompt(sessionHistory) {
  // sessionHistory: array of {role, content, ts} ordered oldest->newest
  if (!sessionHistory || !sessionHistory.length) return '';
  // keep last 10 messages for context in prompt
  const last = sessionHistory.slice(-10);
  const lines = last.map(msg => {
    const role = msg.role === 'assistant' ? 'Assistant' : 'User';
    return `${role}: ${msg.content}`;
  });
  return lines.join('\n');
}

// isQueryHome (small GPT classifier) now accepts session history to provide better context
async function isQueryHome(userMessage, sessionHistory = []) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  const historyCtx = buildHistoryContextForPrompt(sessionHistory);
  const prompt = `
You are a classifier that decides whether a user search query is about HOME / HOME DECOR items (vases, lamps, clocks, showpieces, cushions, etc.) or NOT.
Include the recent conversation context below to improve accuracy.

RECENT CONVERSATION:
${historyCtx || '(none)'}

USER QUERY: "${userMessage}"

Answer ONLY with JSON:
{ "is_home_score": 0.0 }
  `;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a concise classifier that returns only JSON with is_home_score." },
        { role: "user", content: prompt }
      ],
      max_tokens: 60,
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

// gptCheckSellerMaySell accepts session history too
async function gptCheckSellerMaySell(userMessage, seller, sessionHistory = []) {
  if (!openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured' };
  const historyCtx = buildHistoryContextForPrompt(sessionHistory);
  const prompt = `
You are an assistant that rates how likely a seller sells a product a user asks for.
Include recent conversation context when it helps the decision.

RECENT CONVERSATION:
${historyCtx || '(none)'}

USER MESSAGE: "${userMessage}"

SELLER INFORMATION:
Store name: "${seller.store_name || ''}"
Seller id: "${seller.seller_id || ''}"
Seller categories: "${(seller.category_ids_array || []).join(', ')}"
Other info (raw CSV row): ${JSON.stringify(seller.raw || {})}

Question: Based on the above, how likely (0.0 - 1.0) is it that this seller sells the product the user is asking for? Provide ONLY valid JSON in the following format:

{ "score": 0.0, "reason": "one-sentence reason" }
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

// findGptMatchedCategories uses session history to help GPT disambiguate follow-ups
async function findGptMatchedCategories(userMessage, sessionHistory = []) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));
    const historyCtx = buildHistoryContextForPrompt(sessionHistory);

    const prompt = `
RECENT CONVERSATION:
${historyCtx || '(none)'}

USER MESSAGE: "${userMessage}"

AVAILABLE PRODUCT CATEGORIES (from CSV):
${JSON.stringify(csvDataForGPT, null, 2)}

TASK:
1. Understand what product the user is looking for (even if misspelled or incomplete).
2. Find the BEST matching categories from the CSV data (match using the "type2" field).
3. Return the top 5 most relevant matches in JSON.

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
        { role: "system", content: `You are a product matching expert for Zulu Club. Return valid JSON.` },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.3
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
   GPT-first classifier - now accepts session history and includes it in prompt
--------------------------*/
async function classifyAndMatchWithGPT(userMessage, sessionHistory = []) {
  const text = (userMessage || '').trim();
  if (!text) return { intent: 'company', confidence: 1.0, reason: 'empty message', matches: [] };
  if (!openai || !process.env.OPENAI_API_KEY) return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [] };

  const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));
  const historyCtx = buildHistoryContextForPrompt(sessionHistory);

  const prompt = `
You are an assistant for Zulu Club (a lifestyle shopping service).

RECENT CONVERSATION:
${historyCtx || '(none)'}

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
      return { intent: 'company', confidence: 0.0, reason: 'parse error from GPT', matches: [] };
    }
  } catch (err) {
    console.error('Error calling OpenAI classifyAndMatchWithGPT:', err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [] };
  }
}

/* -------------------------
   Product & seller finding pipeline (kept, but passes session history for GPT checks)
--------------------------*/
async function findSellersForQuery(userMessage, galleryMatches = [], detectedGender = null, sessionHistory = []) {
  const homeCheck = await isQueryHome(userMessage, sessionHistory);
  const applyHomeFilter = homeCheck.isHome;

  if (!detectedGender) detectedGender = inferGenderFromCategories(galleryMatches);

  // 1) sellers_by_type2
  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }

  // 2) category matches
  const catMatches = matchSellersByCategoryIds(userMessage, detectedGender);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));

  // apply home filter if needed
  if (applyHomeFilter) {
    const homeSyns = ['home','decor','home decor','furniture','vase','lamp','clock','showpiece','cushion'];
    const keepIfHome = (s) => {
      const arr = s.category_ids_array || [];
      return arr.some(c => {
        const cc = c.toLowerCase();
        return homeSyns.some(h => cc.includes(h) || h.includes(cc));
      });
    };
    for (const [k,s] of Array.from(sellers_by_type2.entries())) if (!keepIfHome(s)) sellers_by_type2.delete(k);
    for (const [k,s] of Array.from(sellers_by_category.entries())) if (!keepIfHome(s)) sellers_by_category.delete(k);
  }

  // 3) GPT-based scoring on candidate pool (now passes session history)
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
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length) && candidateList.length < MAX_GPT_SELLER_CHECK; i++){
      const s = sellersData[i];
      if (!s) continue;
      if (detectedGender) {
        const categories = s.category_ids_array || [];
        const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
        if (sellerHasGender) {
          const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                          : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                          : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
          if (!genderMatch) continue;
        }
      }
      if (!candidateList.includes(s)) candidateList.push(s);
    }
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name+'#') == id));
      if (s) candidateList.push(s);
    }
    if (candidateList.length < MAX_GPT_SELLER_CHECK) {
      for (const s of sellersData) {
        if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        if (!candidateList.includes(s)) {
          if (detectedGender) {
            const categories = s.category_ids_array || [];
            const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
            if (sellerHasGender) {
              const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                              : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                              : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
              if (!genderMatch) continue;
            }
          }
          candidateList.push(s);
        }
      }
    }
  }

  const sellers_by_gpt = [];
  for (let i = 0; i < Math.min(candidateList.length, MAX_GPT_SELLER_CHECK); i++) {
    const seller = candidateList[i];
    if (applyHomeFilter) {
      const arr = seller.category_ids_array || [];
      if (!arr.some(c => c.includes('home') || c.includes('decor') || c.includes('vase') || c.includes('lamp') || c.includes('clock') || c.includes('furnit'))) continue;
    }
    const result = await gptCheckSellerMaySell(userMessage, seller, sessionHistory);
    if (result.score > GPT_THRESHOLD) sellers_by_gpt.push({ seller, score: result.score, reason: result.reason });
  }

  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0,10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0,10);

  return { by_type2: sellersType2Arr, by_category: sellersCategoryArr, by_gpt: sellers_by_gpt, homeCheck };
}

/* -------------------------
   Concise response builder (kept)
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
   Company response generator (uses conversation history)
--------------------------*/
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  const messages = [];
  const systemMessage = {
    role: "system",
    content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
    
ZULU CLUB INFORMATION:
${companyInfo}

IMPORTANT RESPONSE GUIDELINES:
1. Keep responses conversational and helpful
2. Highlight key benefits: 100-minute delivery, try-at-home, easy returns
3. Mention availability: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
4. Use emojis to make it engaging but professional
5. Keep responses under 200 characters for WhatsApp compatibility
6. Be enthusiastic and helpful
7. Direct users to our website zulu.club for more information and shopping
`
  };
  messages.push(systemMessage);

  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => {
      messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    });
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
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
   Seller onboarding helper (kept)
--------------------------*/
function isSellerOnboardQuery(userMessage) {
  if (!userMessage) return false;
  const m = userMessage.toLowerCase();
  const triggers = ['sell on', 'sell with', 'become a seller', 'become seller', 'be a seller', 'how to join', 'how to onboard', 'onboard', 'onboarding', 'register as seller', 'register as a seller', 'join as seller', 'become a merchant', 'how to sell', 'partner with', 'partner with zulu', 'seller signup', 'seller sign up', 'how to become a seller', 'how to register', 'apply as seller', 'apply to sell', 'sell on zulu', 'seller onboarding'];
  return triggers.some(t=>m.includes(t));
}
function sellerOnboardMessage() {
  const link = 'https://app.zulu.club/brand';
  return `Want to sell on Zulu Club? Sign up here: ${link}\n\nQuick steps:\n• Fill the seller form at the link\n• Our team will review & reach out\n• Start listing products & reach Gurgaon customers`;
}

/* -------------------------
   Main product flow & GPT-first logic (now uses session history)
--------------------------*/
async function getChatGPTResponseForSession(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    // ensure session exists
    createOrTouchSession(sessionId);
    const sessionHistory = getSessionHistory(sessionId, { lastMinutes: 60 });

    // onboarding check
    if (isSellerOnboardQuery(userMessage)) return sellerOnboardMessage();

    // 1) single GPT call to classify + match categories (pass recent session history)
    const classification = await classifyAndMatchWithGPT(userMessage, sessionHistory);
    const intent = classification.intent || 'company';
    console.log('🧠 GPT classification:', { sessionId, intent: classification.intent, confidence: classification.confidence, reason: classification.reason });

    if (intent === 'seller') return sellerOnboardMessage();
    if (intent === 'investors') return INVESTORS_PARAGRAPH.trim();

    if (intent === 'product' && galleriesData.length > 0) {
      const matchedType2s = (classification.matches || []).map(m => m.type2).filter(Boolean);
      let matchedCategories = [];
      if (matchedType2s.length > 0) {
        matchedCategories = matchedType2s.map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim())).filter(Boolean).slice(0,5);
      }

      // fallback if GPT didn't return matches
      if (matchedCategories.length === 0) {
        if (containsClothingKeywords(userMessage)) {
          matchedCategories = await findGptMatchedCategories(userMessage, sessionHistory);
        } else {
          const keywordMatches = findKeywordMatchesInCat1(userMessage);
          if (keywordMatches.length > 0) {
            matchedCategories = keywordMatches;
          } else {
            matchedCategories = await findGptMatchedCategories(userMessage, sessionHistory);
          }
        }
      }

      const detectedGender = inferGenderFromCategories(matchedCategories);
      const sellers = await findSellersForQuery(userMessage, matchedCategories, detectedGender, sessionHistory);
      return buildConciseResponse(userMessage, matchedCategories, sellers);
    }

    // default company response with conversation history
    return await generateCompanyResponse(userMessage, sessionHistory, companyInfo);

  } catch (error) {
    console.error('❌ getChatGPTResponse error:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Handler that integrates with sessions
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  try {
    // Create/touch session and append user message
    createOrTouchSession(sessionId);
    appendToSessionHistory(sessionId, 'user', userMessage);

    // get GPT response (which will use session history)
    const aiResponse = await getChatGPTResponseForSession(sessionId, userMessage);

    // append assistant response to history and update lastActive
    appendToSessionHistory(sessionId, 'assistant', aiResponse);

    // trim history to keep only last hour's messages (we already limit length and consider ts when reading)
    conversations[sessionId].history = getSessionHistory(sessionId, { lastMinutes: 60 }).slice(-MAX_HISTORY_MESSAGES);
    conversations[sessionId].lastActive = nowMs();

    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Express endpoints (kept + minor adjustments)
--------------------------*/
app.post('/webhook', async (req, res) => {
  try {
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
    version: '6.1 - GPT-first classifier & category matcher (AI is boss) - session history enabled',
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_sessions: Object.keys(conversations).length
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
  const { query, session } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const isClothing = containsClothingKeywords(query);
    const keywordMatches = findKeywordMatchesInCat1(query);
    const detectedGender = inferGenderFromCategories(keywordMatches);
    const sellers = await findSellersForQuery(query, keywordMatches, detectedGender, getSessionHistory(session || '', { lastMinutes: 60 }));
    const concise = buildConciseResponse(query, keywordMatches, sellers);
    res.json({ query, is_clothing_query: isClothing, detected_gender: detectedGender, keyword_matches: keywordMatches, sellers, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-gpt-matching', async (req, res) => {
  const { query, session } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const matched = await findGptMatchedCategories(query, getSessionHistory(session || '', { lastMinutes: 60 }));
    const detectedGender = inferGenderFromCategories(matched);
    res.json({ query, matched_categories: matched, categories_loaded: galleriesData.length, detected_gender: detectedGender });
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

// optional endpoint to inspect session history (for debugging only; protect in prod)
app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session found' });
  res.json({ sessionId: id, lastActive: s.lastActive, history: s.history });
});

// Export for Vercel
module.exports = app;

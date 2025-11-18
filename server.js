// server.js - Unified GPT (gpt-4o-mini) handling everything
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------
   CONFIG
--------------------------*/
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

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

if (!GOOGLE_SHEET_ID) console.log('⚠️ GOOGLE_SHEET_ID not set — sheet logging disabled');
if (!SA_JSON_B64) console.log('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set — sheet logging disabled');

/* -------------------------
   Sheets helper
--------------------------*/
async function getSheets() {
  if (!GOOGLE_SHEET_ID || !SA_JSON_B64) return null;
  try {
    const keyJson = JSON.parse(Buffer.from(SA_JSON_B64, 'base64').toString('utf8'));
    const jwt = new google.auth.JWT(
      keyJson.client_email,
      null,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await jwt.authorize();
    return google.sheets({ version: 'v4', auth: jwt });
  } catch (e) {
    console.error('❌ Error initializing Google Sheets client:', e);
    return null;
  }
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function writeCell(colNum, rowNum, value) {
  const sheets = await getSheets();
  if (!sheets) return;
  const range = `${colLetter(colNum)}${rowNum}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
  } catch (e) {
    console.error('❌ writeCell error', e);
  }
}

async function appendUnderColumn(headerName, text) {
  const sheets = await getSheets();
  if (!sheets) return;
  try {
    const headersResp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: '1:1' });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    let colIndex = headers.findIndex(h => String(h).trim() === headerName);
    if (colIndex === -1) {
      colIndex = headers.length;
      const headerCol = colLetter(colIndex + 1) + '1';
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: headerCol,
        valueInputOption: 'RAW',
        requestBody: { values: [[headerName]] }
      });
    }
    const colNum = colIndex + 1;
    const colRange = `${colLetter(colNum)}2:${colLetter(colNum)}`;
    let colValues = [];
    try {
      const colResp = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: colRange,
        majorDimension: 'COLUMNS'
      });
      colValues = (colResp.data.values && colResp.data.values[0]) || [];
    } catch (e) {
      colValues = [];
    }
    const nextRow = 2 + colValues.length;
    const ts = new Date().toISOString();
    const finalText = `${ts} | ${text}`;
    await writeCell(colNum, nextRow, finalText);
  } catch (e) {
    console.error('❌ appendUnderColumn error', e);
  }
}

/* -------------------------
   Storage + CSV data
--------------------------*/
let conversations = {};
let galleriesData = [];
let sellersData = [];

/* -------------------------
   Download links + Zulu info
--------------------------*/
const DOWNLOAD_LINKS = `\n\nDownload the Zulu Club app:\n• App Store: https://apps.apple.com/in/app/zulu-club/id6739531325\n• Google Play: https://play.google.com/store/apps/details?id=com.zulu.consumer.zulu_consumer`;

const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love:
- Women's Fashion, Men's Fashion, Kids, Footwear, Home Decor, Beauty & Self-Care, Accessories, Gifting.

Now live in Gurgaon. Pop-ups: AIPL Joy Street & AIPL Central.
Explore & shop on zulu.club
${DOWNLOAD_LINKS}
`;

const INVESTORS_PARAGRAPH = `
Thanks for your interest in investing in Zulu Club. Please share your pitch deck or contact investor-relations@zulu.club and our team will get back to you.
`;

/* -------------------------
   CSV loaders
--------------------------*/
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv', { timeout: 60000 });
    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) { console.log('❌ Empty CSV data received'); resolve([]); return; }
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
        .on('end', () => { console.log(`✅ Loaded ${results.length} product categories from CSV`); resolve(results); })
        .on('error', (error) => { console.error('❌ Error parsing CSV:', error); reject(error); });
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
      if (!response.data || response.data.trim().length === 0) { console.log('❌ Empty sellers CSV received'); resolve([]); return; }
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
        .on('end', () => { console.log(`✅ Loaded ${results.length} sellers from CSV`); resolve(results); })
        .on('error', (error) => { console.error('❌ Error parsing sellers CSV:', error); reject(error); });
    });
  } catch (error) {
    console.error('❌ Error loading sellers CSV:', error.message);
    return [];
  }
}

(async () => {
  try { galleriesData = await loadGalleriesData(); } catch (e) { console.error('Failed loading galleries:', e); galleriesData = []; }
  try { sellersData = await loadSellersData(); } catch (e) { console.error('Failed loading sellers:', e); sellersData = []; }
})();

/* -------------------------
   Session / history
--------------------------*/
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_CLEANUP_MS = 1000 * 60 * 5;
const MAX_HISTORY_MESSAGES = 500;

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
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  conversations[sessionId].lastActive = nowMs();
}
function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s || !s.history) return [];
  return s.history.slice();
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
   Messaging helper
--------------------------*/
async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Attempting to send message to ${to} (${name}): ${message}`);
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
    console.log('✅ Message sent successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', { status: error.response?.status, data: error.response?.data, message: error.message });
    throw error;
  }
}

/* -------------------------
   Matching helpers (kept)
--------------------------*/
function normalizeToken(t) {
  if (!t) return '';
  return String(t).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
  for (const p of ampParts) { if (p && p.length > 1) variants.add(p.trim()); }
  return Array.from(variants);
}
const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);
function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men','women','kids','kid','child','children','man','woman','boy','girl'];
  const message = (userMessage || '').toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

/* -------------------------
   Gallery keyword matching
--------------------------*/
function findKeywordMatchesInCat1(userMessage) {
  if (!userMessage || !galleriesData.length) return [];
  const rawTerms = userMessage.toLowerCase().replace(/&/g, ' and ').split(/\s+/).filter(term => term.length > 1 && !STOPWORDS.has(term));
  const searchTerms = rawTerms.map(t => singularize(normalizeToken(t))).filter(t => t.length > 1);
  const matches = [];
  const clothingKeywords = ['clothing','apparel','wear','shirt','pant','dress','top','bottom','jacket','sweater'];
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
            matches.push({ ...item, matchType: sim === 1.0 ? 'exact' : 'similar', matchedTerm: searchTerm, score: sim });
          }
        }
      }
    }
  });
  return matches.sort((a,b) => b.score - a.score).slice(0,5);
}

/* -------------------------
   Seller matching helpers
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;
const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];

function stripClothingFromType2(type2) {
  if (!type2) return type2;
  let tokens = type2.split(/\s+/);
  while (tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g, ''))) tokens.shift();
  return tokens.join(' ').trim();
}

function matchSellersByStoreName(type2Value, detectedGender = null) {
  if (!type2Value || !sellersData.length) return [];
  const stripped = stripClothingFromType2(type2Value);
  const norm = normalizeToken(stripped);
  if (!norm) return [];
  const matches = [];
  sellersData.forEach(seller => {
    const store = seller.store_name || '';
    const sim = smartSimilarity(store, norm);
    if (sim < 0.82) return;
    if (detectedGender) {
      const sellerGenders = new Set();
      (seller.category_ids_array || []).forEach(c => {
        if (/\bmen\b|\bman\b|\bmens\b/.test(c)) sellerGenders.add('men');
        if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c)) sellerGenders.add('women');
        if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c)) sellerGenders.add('kids');
      });
      if (sellerGenders.size > 0 && !sellerGenders.has(detectedGender)) return;
    }
    matches.push({ seller, score: sim });
  });
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0,10);
}

function matchSellersByCategoryIds(userMessage, detectedGender = null) {
  if (!userMessage || !sellersData.length) return [];
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matches = [];
  sellersData.forEach(seller => {
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
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0,10);
}

/* -------------------------
   inferGenderFromCategories
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
   Unified OpenAI helper (gpt-4o-mini)
--------------------------*/
async function runOpenAIChat(messages, opts = {}) {
  if (!openai || !process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI not configured');
  }
  const params = {
    model: "gpt-4o-mini",
    messages,
    max_tokens: opts.max_tokens || 800,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.25
  };
  try {
    const completion = await openai.chat.completions.create(params);
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI error (runOpenAIChat):', err);
    throw err;
  }
}

/* -------------------------
   Single GPT-run to handle Intent, Category matching, Seller scoring, and final reply
--------------------------*/
async function gptHandleAll(userMessage, conversationHistory = []) {
  // Limit data included in prompt to avoid huge token usage.
  const limitedGalleries = galleriesData.slice(0, 150).map(g => ({ type2: g.type2, cat1: g.cat1, cat_id: g.cat_id }));
  const limitedSellers = sellersData.slice(0, 150).map(s => ({
    seller_id: s.seller_id, user_id: s.user_id, store_name: s.store_name, category_ids_array: s.category_ids_array
  }));

  const system = `
You are Zulu Club's assistant. You will receive a USER MESSAGE and recent conversation history.
Your job: (1) decide intent (company|product|seller|investors), (2) return up to 5 category matches (type2 from provided categories) with reason+score, (3) return up to 8 candidate sellers with score+one-line reason, and (4) produce a short conversational reply for the user (<= 300 chars) that can be returned directly to WhatsApp.
Important: Return ONLY valid JSON (no markdown). Use numeric scores 0.0-1.0.
Fields required in JSON:
{
  "intent": "<company|product|seller|investors>",
  "intent_confidence": 0.0,
  "category_matches": [
    { "type2": "...", "reason": "...", "score": 0.0 }
  ],
  "seller_matches": [
    { "seller_id": "...", "store_name": "...", "score": 0.0, "reason": "..." }
  ],
  "is_home_score": 0.0,
  "final_reply": "user-facing reply string"
}
Use the provided CATEGORIES and SELLERS to ground matches. If you cannot find matches, return empty arrays but still produce a helpful final_reply.
  `;

  const messages = [{ role: 'system', content: system }];

  // Include recent history (converted to 'user'/'assistant')
  const histToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];
  for (const h of histToInclude) {
    const role = (h.role === 'assistant') ? 'assistant' : 'user';
    messages.push({ role, content: h.content });
  }

  const userPrompt = `
USER MESSAGE: """${String(userMessage).replace(/"/g, '\\"')}"""

AVAILABLE_CATEGORIES JSON:
${JSON.stringify(limitedGalleries, null, 2)}

AVAILABLE_SELLERS JSON:
${JSON.stringify(limitedSellers, null, 2)}

Now produce the required JSON object only.
  `;
  messages.push({ role: 'user', content: userPrompt });

  try {
    const raw = await runOpenAIChat(messages, { max_tokens: 1200, temperature: 0.2 });
    try {
      const parsed = JSON.parse(raw);
      parsed.intent = parsed.intent || 'company';
      parsed.intent_confidence = Number(parsed.intent_confidence || 0.0);
      parsed.category_matches = Array.isArray(parsed.category_matches) ? parsed.category_matches.slice(0,5) : [];
      parsed.seller_matches = Array.isArray(parsed.seller_matches) ? parsed.seller_matches.slice(0,8) : [];
      parsed.is_home_score = Number(parsed.is_home_score || 0.0);
      parsed.final_reply = String(parsed.final_reply || '').trim();
      return parsed;
    } catch (parseErr) {
      console.warn('gptHandleAll: failed JSON parse, raw response:', raw);
      return {
        intent: 'company', intent_confidence: 0.0,
        category_matches: [], seller_matches: [], is_home_score: 0.0,
        final_reply: raw.substring(0, 1500)
      };
    }
  } catch (err) {
    console.error('gptHandleAll error:', err);
    return {
      intent: 'company', intent_confidence: 0.0,
      category_matches: [], seller_matches: [], is_home_score: 0.0,
      final_reply: `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.`
    };
  }
}

/* -------------------------
   Lightweight helpers still used
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
  } else msg += `\nGalleries:\nNone\n`;
  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else msg += `None\n`;
  msg += DOWNLOAD_LINKS;
  return msg.trim();
}

/* -------------------------
   Greeting / seller detection heuristics
--------------------------*/
function isSellerOnboardQuery(userMessage) {
  if (!userMessage) return false;
  const m = userMessage.toLowerCase();
  const triggers = ['sell on','sell with','become a seller','become seller','be a seller','how to join','how to onboard','onboard','onboarding','register as seller','register as a seller','join as seller','become a merchant','how to sell','partner with','partner with zulu','seller signup','seller sign up','how to become a seller','how to register','apply as seller','apply to sell','sell on zulu','seller onboarding'];
  return triggers.some(t => m.includes(t));
}

function sellerOnboardMessage() {
  const link = 'https://app.zulu.club/brand';
  return `Want to sell on Zulu Club? Sign up here: ${link}\n\nQuick steps:\n• Fill the seller form at the link\n• Our team will review & reach out\n• Start listing products & reach Gurgaon customers${DOWNLOAD_LINKS}`;
}

function isGreetingMessage(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase().trim();
  const greetings = ['hi','hello','hey','good morning','good afternoon','good evening','hola','namaste'];
  for (const g of greetings) {
    if (m === g) return true;
    if (m.startsWith(g + ' ') || m.startsWith(g + ',')) return true;
  }
  return false;
}

/* -------------------------
   Recent history product hint
--------------------------*/
function recentHistoryContainsProductSignal(conversationHistory = []) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return null;
  const productKeywords = ['tshirt','t-shirt','shirt','tee','jeans','pant','pants','trouser','kurta','lehenga','top','dress','saree','innerwear','jacket','sweater','shorts','tshir','t shrt'];
  const recentUserMsgs = conversationHistory.slice(-10).filter(m => m.role === 'user').map(m => (m.content || '').toLowerCase());
  for (const msg of recentUserMsgs) {
    for (const pk of productKeywords) {
      if (msg.includes(pk)) return true;
    }
  }
  return false;
}

/* -------------------------
   Main response flow (delegates to gptHandleAll)
--------------------------*/
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    // Quick heuristics
    if (isSellerOnboardQuery(userMessage)) return sellerOnboardMessage();
    if (isGreetingMessage(userMessage)) {
      // Let GPT produce greeting via unified handler for consistency
      const gptResult = await gptHandleAll(userMessage, conversationHistory);
      const finalReply = (gptResult && gptResult.final_reply) ? `${gptResult.final_reply}${DOWNLOAD_LINKS}` : `${await generateCompanyResponse(userMessage, conversationHistory, companyInfo)}`;
      return finalReply;
    }

    // Primary: let GPT do everything
    const gptResult = await gptHandleAll(userMessage, conversationHistory);

    // If GPT indicates investors or seller intent, fast-route
    if (gptResult.intent === 'investors') {
      return `${INVESTORS_PARAGRAPH.trim()}${DOWNLOAD_LINKS}`;
    }
    if (gptResult.intent === 'seller') {
      return sellerOnboardMessage();
    }

    // Prefer GPT final_reply if present
    if (gptResult && gptResult.final_reply && gptResult.final_reply.length > 0) {
      return `${gptResult.final_reply}${DOWNLOAD_LINKS}`;
    }

    // As fallback, try classical matching flows (keyword & heuristics)
    // 1) try keyword matches
    const keywordMatches = findKeywordMatchesInCat1(userMessage);
    const detectedGender = inferGenderFromCategories(keywordMatches);
    const sellers = await findSellersForQuery(userMessage, keywordMatches, detectedGender);
    const concise = buildConciseResponse(userMessage, keywordMatches, sellers);
    return concise;

  } catch (error) {
    console.error('❌ getChatGPTResponse error (unified mode):', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None${DOWNLOAD_LINKS}`;
  }
}

/* -------------------------
   findSellersForQuery (uses gptCheckSellerMaySell via runOpenAIChat fallback)
--------------------------*/
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
  `;
  try {
    const messages = [
      { role: 'system', content: 'You are a concise classifier that returns only JSON {score, reason}.' },
      { role: 'user', content: prompt }
    ];
    const raw = await runOpenAIChat(messages, { max_tokens: 150, temperature: 0.0 });
    try {
      const parsed = JSON.parse(raw);
      return { score: Number(parsed.score) || 0, reason: parsed.reason || '' };
    } catch (e) {
      console.error('Error parsing GPT seller-check response:', e, 'raw:', raw);
      return { score: 0, reason: 'GPT response could not be parsed' };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error' };
  }
}

async function findSellersForQuery(userMessage, galleryMatches = [], detectedGender = null) {
  const homeCheck = { isHome: false, score: 0 };
  try {
    // Basic home check using simple keywords
    const hc = /home|decor|vase|lamp|clock|showpiece|furniture|cushion/i;
    homeCheck.isHome = hc.test(userMessage);
    homeCheck.score = homeCheck.isHome ? 0.9 : 0.0;
  } catch (e) { homeCheck.isHome = false; homeCheck.score = 0; }

  if (!detectedGender) detectedGender = inferGenderFromCategories(galleryMatches);

  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }
  const catMatches = matchSellersByCategoryIds(userMessage, detectedGender);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));

  if (homeCheck.isHome) {
    const homeSyns = ['home','decor','home decor','furniture','vase','lamp','clock','showpiece','cushion','home-accessories'];
    const keepIfHome = (s) => {
      const arr = s.category_ids_array || [];
      return arr.some(c => {
        const cc = c.toLowerCase();
        return homeSyns.some(h => cc.includes(h) || h.includes(cc));
      });
    };
    for (const [k, s] of Array.from(sellers_by_type2.entries())) if (!keepIfHome(s)) sellers_by_type2.delete(k);
    for (const [k, s] of Array.from(sellers_by_category.entries())) if (!keepIfHome(s)) sellers_by_category.delete(k);
  }

  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];

  if (candidateIds.size === 0) {
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length) && candidateList.length < MAX_GPT_SELLER_CHECK; i++) {
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
    if (homeCheck.isHome) {
      const arr = seller.category_ids_array || [];
      if (!arr.some(c => c.includes('home') || c.includes('decor') || c.includes('vase') || c.includes('lamp') || c.includes('clock') || c.includes('furnit'))) {
        continue;
      }
    }
    const result = await gptCheckSellerMaySell(userMessage, seller);
    if (result.score > GPT_THRESHOLD) sellers_by_gpt.push({ seller, score: result.score, reason: result.reason });
  }

  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);
  return { by_type2: sellersType2Arr, by_category: sellersCategoryArr, by_gpt: sellers_by_gpt, homeCheck: homeCheck };
}

/* -------------------------
   generateCompanyResponse (kept, but uses runOpenAIChat)
--------------------------*/
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  const messages = [];
  const systemMessage = {
    role: "system",
    content: `You are a friendly and helpful customer service assistant for Zulu Club. 
ZULU CLUB INFORMATION:
${companyInfo}

IMPORTANT RESPONSE GUIDELINES:
1. Keep responses conversational and helpful
2. Highlight key benefits: 100-minute delivery, try-at-home, easy returns
3. Mention availability: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
4. Use emojis to make it engaging but professional
5. Keep responses under 200 characters for WhatsApp compatibility
`
  };
  messages.push(systemMessage);
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => { if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content }); });
  }
  messages.push({ role: "user", content: userMessage });
  try {
    const raw = await runOpenAIChat(messages, { max_tokens: 300, temperature: 0.6 });
    const reply = raw.trim();
    return `${reply}${DOWNLOAD_LINKS}`;
  } catch (e) {
    console.error('Error in generateCompanyResponse:', e);
    return `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.${DOWNLOAD_LINKS}`;
  }
}

/* -------------------------
   Handler that receives & processes messages
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  try {
    appendToSessionHistory(sessionId, 'user', userMessage);
    try { await appendUnderColumn(sessionId, `USER: ${userMessage}`); } catch (e) { console.error('sheet log user failed', e); }

    const fullHistory = getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}`);

    const aiResponse = await getChatGPTResponse(userMessage, fullHistory);

    appendToSessionHistory(sessionId, 'assistant', aiResponse);
    try { await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`); } catch (e) { console.error('sheet log assistant failed', e); }

    conversations[sessionId].lastActive = nowMs();

    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None${DOWNLOAD_LINKS}`;
  }
}

/* -------------------------
   Webhook + endpoints
--------------------------*/
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
      console.log(`➡️ Storing incoming message into session ${sessionId}.`);
      const aiResponse = await handleMessage(sessionId, userMessage);
      console.log(`➡️ Sending AI response to ${sessionId}. Response length: ${aiResponse.length}`);
      await sendMessage(userPhone, userName, aiResponse);
      console.log(`✅ AI response sent to ${userPhone}`);
      res.status(200).json({ status: 'success', message: 'Webhook processed successfully', processed: true });
    } else {
      console.log('❓ No valid message or phone number found in webhook');
      res.status(200).json({ status: 'ignored', message: 'No valid message or phone in webhook' });
    }
  } catch (error) {
    console.error('💥 Webhook error:', error.message);
    res.status(500).json({ status: 'error', message: error.message, processed: false });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Server is running',
    service: 'Zulu Club WhatsApp AI Assistant',
    version: 'unified-gpt-4o-mini-v1',
    stats: { product_categories_loaded: galleriesData.length, sellers_loaded: sellersData.length, active_sessions: Object.keys(conversations).length },
    timestamp: new Date().toISOString()
  });
});

app.get('/refresh-csv', async (req, res) => {
  try { galleriesData = await loadGalleriesData(); sellersData = await loadSellersData(); res.json({ status: 'success', message: 'CSV data refreshed successfully', categories_loaded: galleriesData.length, sellers_loaded: sellersData.length }); }
  catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.get('/test-keyword-matching', async (req, res) => {
  const { query } = req.query; if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const isClothing = containsClothingKeywords(query);
    const keywordMatches = findKeywordMatchesInCat1(query);
    const detectedGender = inferGenderFromCategories(keywordMatches);
    const sellers = await findSellersForQuery(query, keywordMatches, detectedGender);
    const concise = buildConciseResponse(query, keywordMatches, sellers);
    res.json({ query, is_clothing_query: isClothing, detected_gender: detectedGender, keyword_matches: keywordMatches, sellers, homeCheck: sellers.homeCheck || {}, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query; if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const dummyHistory = [{ role: 'user', content: 'I want a tshirt' }];
    const matched = await gptHandleAll(query, dummyHistory);
    const detectedGender = inferGenderFromCategories(matched.category_matches || []);
    res.json({ query, matched_categories: matched.category_matches, categories_loaded: galleriesData.length, detected_gender: detectedGender, seller_matches: matched.seller_matches || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/send-test-message', async (req, res) => {
  try {
    const { to, name, message } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing "to" in request body', example: { "to": "918368127760", "name": "Rishi", "message": "What products do you have?" } });
    const result = await sendMessage(to, name || 'Test User', message || 'Hello! This is a test message from Zulu Club AI Assistant. 🚀');
    res.json({ status: 'success', message: 'Test message sent successfully', data: result });
  } catch (error) { res.status(500).json({ error: 'Failed to send test message', details: error.message }); }
});

// Export for Vercel or run directly
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

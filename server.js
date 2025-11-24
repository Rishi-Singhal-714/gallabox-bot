// server.js (refactored, compact, same features)
// - All original features preserved
// - Duplicated logic removed
// - Simplified similarity & keyword matching
// - Simplified seller matching pipeline
// - No noisy logs
// - Uses GPT where needed (classify, category-match, seller-check, home-check)
// - Google Sheets logging kept (best-effort)
// - Session management kept (TTL + simple history)
// - Routes: /, /webhook, /refresh-csv, test endpoints + send-test-message
//
// ENV expected:
// OPENAI_API_KEY, GALLABOX_* (ACCOUNT_ID, API_KEY, API_SECRET, CHANNEL_ID), GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, AGENT_TICKETS_SHEET
//
const express = require('express');
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { OpenAI } = require('openai'); // using same interface as original code

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------
   CONFIG / CONSTANTS
--------------------------*/
const VOICE_AI_FORM_LINK = 'https://forms.gle/CiPAk6RqWxkd8uSKA';
const ZULU_CLUB_INFO = `
Zulu Club — personalized lifestyle shopping.
100-minute delivery, try-at-home, easy returns.
Pop-ups: AIPL Joy Street & AIPL Central (Gurgaon).
Site: zulu.club
`;

const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Sheet2';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

const GALLABOX = {
  baseUrl: 'https://server.gallabox.com/devapi',
  accountId: process.env.GALLABOX_ACCOUNT_ID || '',
  apiKey: process.env.GALLABOX_API_KEY || '',
  apiSecret: process.env.GALLABOX_API_SECRET || '',
  channelId: process.env.GALLABOX_CHANNEL_ID || ''
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

/* -------------------------
   In-memory state (compact)
--------------------------*/
let galleriesData = []; // { type2, cat1, cat_id }
let sellersData = [];   // { seller_id, user_id, store_name, category_ids_array, raw }
let conversations = {}; // sessionId -> { history: [{role,content,ts}], lastActive, lastDetectedIntent, lastDetectedIntentTs }

const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_HISTORY_MESSAGES = 2000;
setInterval(() => purgeExpiredSessions(), 1000 * 60 * 5);

/* -------------------------
   UTIL: Google Sheets helper (best-effort)
--------------------------*/
async function getSheetsClient() {
  if (!GOOGLE_SHEET_ID || !SA_JSON_B64) return null;
  try {
    const keyJson = JSON.parse(Buffer.from(SA_JSON_B64, 'base64').toString('utf8'));
    const jwt = new google.auth.JWT(keyJson.client_email, null, keyJson.private_key, ['https://www.googleapis.com/auth/spreadsheets']);
    await jwt.authorize();
    return google.sheets({ version: 'v4', auth: jwt });
  } catch {
    return null;
  }
}
async function appendUnderColumn(columnKey, text) {
  // columnKey used as sheet column header (we create column if absent)
  const sheets = await getSheetsClient();
  if (!sheets) return;
  try {
    const headerRange = `1:1`;
    const sheetName = AGENT_TICKETS_SHEET;
    const headerResp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!${headerRange}` }).catch(() => null);
    const headers = (headerResp && headerResp.data && headerResp.data.values && headerResp.data.values[0]) || [];
    let colIndex = headers.findIndex(h => String(h).trim() === columnKey);
    if (colIndex === -1) {
      // append header at the end
      colIndex = headers.length;
      const headerCell = `${colLetter(colIndex + 1)}1`;
      await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!${headerCell}`, valueInputOption: 'RAW', requestBody: { values: [[columnKey]] } }).catch(() => {});
    }
    const colLetterRange = `${colLetter(colIndex + 1)}2:${colLetter(colIndex + 1)}`;
    const colResp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!${colLetterRange}`, majorDimension: 'COLUMNS' }).catch(() => null);
    const colVals = (colResp && colResp.data && colResp.data.values && colResp.data.values[0]) || [];
    const nextRow = 2 + colVals.length;
    const ts = new Date().toISOString();
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!${colLetter(colIndex + 1)}${nextRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[`${ts} | ${text}`]] }
    }).catch(() => {});
  } catch {
    // ignore sheet errors (best-effort)
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

/* -------------------------
   CSV Loaders (compact + robust)
--------------------------*/
async function loadCsvFromUrl(url, mapFn) {
  try {
    const resp = await axios.get(url, { timeout: 60000 });
    if (!resp.data || !String(resp.data).trim()) return [];
    return await new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(resp.data);
      stream.pipe(csv()).on('data', row => {
        try {
          const mapped = mapFn(row);
          if (mapped) results.push(mapped);
        } catch {}
      }).on('end', () => resolve(results)).on('error', err => reject(err));
    });
  } catch {
    return [];
  }
}

async function loadGalleriesData() {
  const url = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv';
  const mapped = await loadCsvFromUrl(url, (r) => {
    const type2 = r.type2 || r.Type2 || r.TYPE2 || '';
    const cat1 = r.cat1 || r.CAT1 || r.Cat1 || '';
    const cat_id = r.cat_id || r.CAT_ID || r.catId || '';
    if (!type2 && !cat1 && !cat_id) return null;
    return { type2: String(type2).trim(), cat1: String(cat1).trim(), cat_id: String(cat_id).trim() };
  });
  galleriesData = mapped;
  return galleriesData;
}
async function loadSellersData() {
  const url = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv';
  const mapped = await loadCsvFromUrl(url, (r) => {
    const seller_id = r.seller_id || r.SELLER_ID || r.id || r.ID || '';
    const user_id = r.user_id || r.USER_ID || r.userId || '';
    const store_name = r.store_name || r.StoreName || r.store || '';
    const category_ids = r.category_ids || r.CATEGORY_IDS || r.categories || '';
    const arr = String(category_ids || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!seller_id && !store_name) return null;
    return { seller_id: String(seller_id).trim(), user_id: String(user_id).trim(), store_name: String(store_name).trim(), category_ids_array: arr, raw: r };
  });
  sellersData = mapped;
  return sellersData;
}

// initial load
(async () => {
  await loadGalleriesData();
  await loadSellersData();
})();

/* -------------------------
   Small/string helpers (single source)
--------------------------*/
function nowMs() { return Date.now(); }
function createOrTouchSession(id) {
  if (!conversations[id]) {
    conversations[id] = { history: [], lastActive: nowMs(), lastDetectedIntent: null, lastDetectedIntentTs: 0 };
  } else {
    conversations[id].lastActive = nowMs();
  }
  return conversations[id];
}
function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  conversations[sessionId].history.push({ role, content, ts: nowMs() });
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  conversations[sessionId].lastActive = nowMs();
}
function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s) return [];
  return s.history.slice();
}
function purgeExpiredSessions() {
  const cutoff = nowMs() - SESSION_TTL_MS;
  for (const id of Object.keys(conversations)) {
    if (!conversations[id].lastActive || conversations[id].lastActive < cutoff) delete conversations[id];
  }
}

/* -------------------------
   Simplified normalization & similarity
   - single normalizer
   - short edit-distance + overlap heuristic
--------------------------*/
function normalize(text = '') {
  return String(text || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function singularize(word = '') {
  if (!word) return '';
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
}
function simpleSimilarity(a = '', b = '') {
  const A = singularize(normalize(a));
  const B = singularize(normalize(b));
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.95;
  // char overlap ratio
  const common = [...new Set(A)].filter(ch => B.includes(ch)).length;
  const score = common / Math.max(1, Math.max(A.length, B.length));
  return Math.min(1, Math.max(score, 0));
}

/* -------------------------
   Lightweight category keyword match (fast)
--------------------------*/
const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);
function extractSearchTerms(message = '') {
  return normalize(message).split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t)).map(t => singularize(t));
}
function findKeywordMatchesInCat1(userMessage = '') {
  if (!userMessage || !galleriesData.length) return [];
  const terms = extractSearchTerms(userMessage);
  if (!terms.length) return [];
  const matches = [];
  for (const item of galleriesData) {
    if (!item.cat1 && !item.cat_id) continue;
    const catText = [item.cat1, item.cat_id, item.type2].filter(Boolean).join(' ');
    for (const t of terms) {
      const sim = simpleSimilarity(catText, t);
      if (sim >= 0.82) {
        matches.push({ ...item, score: sim, matchedTerm: t });
        break;
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 6);
}

/* -------------------------
   Gender inference from categories (compact)
--------------------------*/
function inferGenderFromCategories(matchedCategories = []) {
  if (!Array.isArray(matchedCategories) || matchedCategories.length === 0) return null;
  const scores = { men: 0, women: 0, kids: 0 };
  matchedCategories.forEach(cat => {
    const text = normalize((cat.cat1 || '') + ' ' + (cat.cat_id || ''));
    if (/\bmen\b|\bman\b|\bmens\b/.test(text)) scores.men++;
    if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(text)) scores.women++;
    if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(text)) scores.kids++;
  });
  const max = Math.max(scores.men, scores.women, scores.kids);
  if (max === 0) return null;
  const winners = Object.keys(scores).filter(k => scores[k] === max);
  return winners.length === 1 ? winners[0] : null;
}

/* -------------------------
   Simple seller matching (two-pass):
   1) match by type2/store name (similarity)
   2) match by category_ids inclusion
   Optionally use GPT-check to refine top candidates
--------------------------*/
function stripLeadingGenderWords(s) {
  if (!s) return s;
  return s.split(/\s+/).filter(tok => !['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'].includes(tok.toLowerCase())).join(' ').trim();
}

// match by store name similarity (fast)
function matchSellersByStoreName(type2Value, detectedGender = null) {
  if (!type2Value || !sellersData.length) return [];
  const target = normalize(stripLeadingGenderWords(type2Value));
  if (!target) return [];
  const results = [];
  for (const s of sellersData) {
    const store = normalize(s.store_name || '');
    const sim = simpleSimilarity(store, target);
    if (sim >= 0.82) {
      // if seller categories explicitly indicate gender, require match
      if (detectedGender) {
        const sellerGenders = new Set(s.category_ids_array || []);
        const sellerHasGender = sellerGenders.size > 0 && [...sellerGenders].some(c => /\bmen\b|\bwoman|\bwomen\b|\bkid\b/.test(c));
        if (sellerHasGender) {
          const matches = detectedGender === 'men' ? sellerGenders.has('men') || sellerGenders.has('man') :
                          detectedGender === 'women' ? sellerGenders.has('women') || sellerGenders.has('woman') :
                          sellerGenders.has('kids') || sellerGenders.has('kid');
          if (!matches) continue;
        }
      }
      results.push({ seller: s, score: sim });
    }
  }
  return results.sort((a, b) => b.score - a.score).map(r => ({ ...r.seller, score: r.score })).slice(0, 10);
}

// match by category ids (user message terms vs seller category tags)
function matchSellersByCategoryIds(userMessage, detectedGender = null) {
  if (!userMessage || !sellersData.length) return [];
  const terms = extractSearchTerms(userMessage);
  if (!terms.length) return [];
  const res = [];
  for (const s of sellersData) {
    if (detectedGender) {
      const cats = s.category_ids_array || [];
      const sellerHasGender = cats.some(c => /\bmen\b|\bman\b|\bmums\b|\bwomen\b|\bwomens\b|\bkid\b|\bkids\b/.test(c));
      if (sellerHasGender) {
        const match = detectedGender === 'men' ? cats.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                    : detectedGender === 'women' ? cats.some(c => /\bwomen\b|\bwoman\b|\bwomens\b/.test(c))
                    : cats.some(c => /\bkid\b|\bkids\b/.test(c));
        if (!match) continue;
      }
    }
    // simple overlap
    const common = s.category_ids_array.filter(c => terms.some(t => c.includes(t) || t.includes(c)));
    if (common.length) res.push({ seller: s, matches: common.length });
  }
  return res.sort((a, b) => b.matches - a.matches).map(r => r.seller).slice(0, 10);
}

/* -------------------------
   Minimal GPT helpers (classifiers + checks)
   - classifyAndMatchWithGPT (intent + optional type2 matches)
   - findGptMatchedCategories (history-aware category matching)
   - isQueryHome (home-check)
   - gptCheckSellerMaySell (rate likelihood)
   Note: each returns JSON or fallback values on error
--------------------------*/
async function callOpenAIChat(messages, opts = {}) {
  if (!openai || !process.env.OPENAI_API_KEY) return null;
  try {
    const completion = await openai.chat.completions.create(Object.assign({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 900,
      temperature: 0.2
    }, opts));
    return completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content;
  } catch {
    return null;
  }
}

async function classifyAndMatchWithGPT(userMessage) {
  if (!userMessage) return { intent: 'company', confidence: 1.0, reason: 'empty', matches: [] };
  if (!openai || !process.env.OPENAI_API_KEY) return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [] };

  const csvDataForGPT = galleriesData.map(i => ({ type2: i.type2, cat1: i.cat1, cat_id: i.cat_id }));
  const prompt = `
You are a JSON-only classifier for Zulu Club.
Choose exactly one intent from: company, product, seller, investors, agent, voice_ai.
If intent is "product", return up to 5 best matching "type2" values from AVAILABLE CATEGORIES with reason and score (0.0-1.0).
Return ONLY JSON:
{ "intent":"product", "confidence":0.0, "reason":"short", "matches":[ {"type2":"...","reason":"...","score":0.8} ], "reasoning":"..." }
USER MESSAGE: "${String(userMessage).replace(/"/g,'\\"')}"
AVAILABLE_CATEGORIES: ${JSON.stringify(csvDataForGPT)}
`;
  const sys = [{ role: 'system', content: 'Return only JSON as described.' }, { role: 'user', content: prompt }];
  const raw = await callOpenAIChat(sys);
  if (!raw) return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [] };
  try {
    const parsed = JSON.parse(raw);
    const allowed = ['company','product','seller','investors','agent','voice_ai'];
    const intent = (parsed.intent && allowed.includes(parsed.intent)) ? parsed.intent : 'company';
    const confidence = Number(parsed.confidence) || 0;
    const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ type2: m.type2, reason: m.reason, score: Number(m.score) || 0 })) : [];
    return { intent, confidence, reason: parsed.reason || '', matches, reasoning: parsed.reasoning || '' };
  } catch {
    // fallback: no parsed json
    return { intent: 'company', confidence: 0.0, reason: 'parse_error', matches: [], reasoning: raw.slice(0, 300) };
  }
}

async function findGptMatchedCategories(userMessage, conversationHistory = []) {
  if (!openai || !process.env.OPENAI_API_KEY) return [];
  const csvDataForGPT = galleriesData.map(i => ({ type2: i.type2, cat1: i.cat1, cat_id: i.cat_id }));
  const system = { role: 'system', content: 'You are a product matching assistant for Zulu Club. Return only JSON.' };
  const messages = [system];
  const historyToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-30) : [];
  for (const h of historyToInclude) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  messages.push({ role: 'user', content: `USER MESSAGE: "${String(userMessage).replace(/"/g,'\\"')}"\nAVAILABLE_CATEGORIES: ${JSON.stringify(csvDataForGPT)}\nReturn JSON: { "matches": [ {"type2":"...","score":0.9,"reason":"..."} ], "reasoning": "..." }` });

  const raw = await callOpenAIChat(messages, { max_tokens: 1000, temperature: 0.2 });
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => m.type2) : [];
    return matches.map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim())).filter(Boolean).slice(0, 5);
  } catch {
    return [];
  }
}

async function isQueryHome(userMessage) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0, reasoning: '' };
  const prompt = `Return JSON only: { "is_home_score": 0.0, "reasoning": "..." } for USER QUERY: "${String(userMessage).replace(/"/g,'\\"')}".`;
  const raw = await callOpenAIChat([{role:'system',content:'Return only JSON with is_home_score and reasoning.'}, {role:'user',content:prompt}], { max_tokens: 120, temperature: 0.0 });
  if (!raw) return { isHome: false, score: 0, reasoning: '' };
  try {
    const parsed = JSON.parse(raw);
    const score = Number(parsed.is_home_score) || 0;
    return { isHome: score >= 0.6, score, reasoning: parsed.reasoning || '' };
  } catch {
    return { isHome: false, score: 0, reasoning: '' };
  }
}

async function gptCheckSellerMaySell(userMessage, seller) {
  if (!openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured', reasoning: '' };
  const prompt = `
Return JSON only: {"score":0.0,"reason":"one-sentence","reasoning":"compact chain-of-thought"}
USER MESSAGE: "${String(userMessage).replace(/"/g,'\\"')}"
SELLER: ${JSON.stringify({ store_name: seller.store_name, seller_id: seller.seller_id, categories: seller.category_ids_array })}
`;
  const raw = await callOpenAIChat([{role:'system',content:'You are a concise JSON-only classifier.'},{role:'user',content:prompt}], { max_tokens: 180, temperature: 0.0 });
  if (!raw) return { score: 0, reason: 'gpt-fail', reasoning: '' };
  try {
    const p = JSON.parse(raw);
    return { score: Number(p.score) || 0, reason: p.reason || '', reasoning: p.reasoning || '' };
  } catch {
    return { score: 0, reason: 'parse_error', reasoning: raw.slice(0, 300) };
  }
}

/* -------------------------
   Master pipeline: findSellersForQuery
   - Runs simple local matching + optional GPT-check on top candidates
   - Applies home filter if needed
--------------------------*/
const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;

async function findSellersForQuery(userMessage, galleryMatches = [], detectedGender = null) {
  // 0) home-check
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome;

  // 1) collect by type2
  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    if (!gm.type2) continue;
    const found = matchSellersByStoreName(gm.type2, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name + '#'), s));
  }

  // 2) collect by category ids
  const sellers_by_category = new Map();
  matchSellersByCategoryIds(userMessage, detectedGender).forEach(s => sellers_by_category.set(s.seller_id || (s.store_name + '#'), s));

  // 3) candidate pool
  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  if (candidateIds.size === 0) {
    // start with sellers that look like home if applyHomeFilter, else top sellers
    for (const s of sellersData) {
      if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
      if (applyHomeFilter) {
        const cats = s.category_ids_array || [];
        if (!cats.some(c => c.includes('home') || c.includes('decor') || c.includes('lamp') || c.includes('vase') || c.includes('clock'))) continue;
      }
      candidateList.push(s);
    }
    // fill remaining
    for (const s of sellersData) {
      if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
      if (!candidateList.includes(s)) candidateList.push(s);
    }
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name + '#') == id));
      if (s) candidateList.push(s);
    }
    for (const s of sellersData) {
      if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
      if (!candidateList.includes(s)) candidateList.push(s);
    }
  }

  // apply home filter to candidateList if required
  const filteredCandidates = applyHomeFilter ? candidateList.filter(s => (s.category_ids_array || []).some(c => c.includes('home') || c.includes('decor') || c.includes('lamp') || c.includes('vase') || c.includes('clock'))) : candidateList;

  // 4) GPT-check top candidates (async)
  const toCheck = filteredCandidates.slice(0, MAX_GPT_SELLER_CHECK);
  const checks = await Promise.all(toCheck.map(async s => {
    // lightweight prefilter: if category match strong, accept quickly
    const catMatchScore = (s.category_ids_array || []).some(c => extractSearchTerms(userMessage).some(t => c.includes(t))) ? 0.85 : 0;
    if (catMatchScore >= GPT_THRESHOLD) return { seller: s, score: catMatchScore, reason: 'category match prefilter' };
    // else call GPT
    const res = await gptCheckSellerMaySell(userMessage, s);
    if (res.score > GPT_THRESHOLD) return { seller: s, score: res.score, reason: res.reason };
    return null;
  }));

  const sellers_by_gpt = checks.filter(Boolean).map(c => ({ seller: c.seller, score: c.score, reason: c.reason }));

  // 5) create combined ordered lists
  const by_type2 = Array.from(sellers_by_type2.values()).slice(0, 10);
  const by_category = Array.from(sellers_by_category.values()).slice(0, 10);
  return { by_type2, by_category, by_gpt: sellers_by_gpt, homeCheck };
}

/* -------------------------
   Response builders
--------------------------*/
function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(String(t).trim()).replace(/\s+/g, '%20');
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

  let msg = `Based on your interest in "${userMessage}":\n\nGalleries:\n`;
  if (galleries.length) {
    galleries.slice(0,5).forEach((g, i) => {
      const t = g.type2 || '';
      const link = `app.zulu.club/${urlEncodeType2(t)}`;
      msg += `${i+1}. ${t} — ${link}\n`;
    });
  } else {
    msg += 'None\n';
  }
  msg += `\nSellers:\n`;
  if (sellersList.length) {
    sellersList.slice(0,5).forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else msg += 'None\n';
  return msg.trim();
}

/* -------------------------
   Company response (keeps helpful links, short)
--------------------------*/
function isGreeting(text) {
  if (!text) return false;
  const t = normalize(text);
  const greetings = ['hi','hello','hey','namaste','namaskar','hola'];
  return greetings.includes(t) || /^hi+$/.test(t);
}
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo = ZULU_CLUB_INFO) {
  // Use GPT to craft friendly short answer (best-effort). If GPT fails, fallback to a static reply.
  if (!openai || !process.env.OPENAI_API_KEY) {
    const LINKS = `*iOS:*\nhttps://apps.apple.com/in/app/zulu-club/id6739531325\n*iOS:*\nhttps://play.google.com/store/apps/details?id=com.zulu.consumer.zulu_consumer`;
    return isGreeting(userMessage) ? 'Hi! How can we help you at Zulu Club?' : `Hi! ${companyInfo}\n\n${LINKS}`;
  }
  const messages = [
    { role: 'system', content: `You are a friendly Zulu Club assistant. Keep answers under 200 chars, use emojis sparingly.` }
  ];
  const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-6) : [];
  recentHistory.forEach(h => messages.push({ role: h.role, content: h.content }));
  messages.push({ role: 'user', content: userMessage });

  const raw = await callOpenAIChat(messages, { max_tokens: 300, temperature: 0.6 });
  const LINKS_BLOCK = [
    "*iOS:* https://apps.apple.com/in/app/zulu-club/id6739531325",
    "*Android:* https://play.google.com/store/apps/details?id=com.zulu.consumer.zulu_consumer"
  ].join('\n');

  if (!raw) {
    return isGreeting(userMessage) ? 'Hi! How can we help you at Zulu Club?' : `${companyInfo}\n\n${LINKS_BLOCK}`;
  }
  // Append links unless greeting
  let assistantText = raw.trim();
  if (!isGreeting(userMessage)) assistantText = assistantText + "\n\n" + LINKS_BLOCK;
  return assistantText;
}

/* -------------------------
   Agent ticket helpers (Google Sheets row append)
--------------------------*/
function generateTicketId() {
  const now = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${now}-${rand}`;
}
async function ensureAgentTicketsHeader(sheets) {
  try {
    const sheetName = AGENT_TICKETS_SHEET;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!1:1` }).catch(() => null);
    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = ['mobile_number', 'last_5th_message', '4th_message', '3rd_message', '2nd_message', '1st_message', 'ticket_id', 'ts'];
    if (existing.length === 0 || required.some((h, i) => String(existing[i] || '').trim().toLowerCase() !== h)) {
      await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!1:1`, valueInputOption: 'RAW', requestBody: { values: [required] } }).catch(() => {});
    }
    return sheetName;
  } catch {
    return AGENT_TICKETS_SHEET;
  }
}
async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheetsClient();
  const ticketId = generateTicketId();
  const ts = new Date().toISOString();
  if (!sheets) return ticketId;
  try {
    const sheetName = await ensureAgentTicketsHeader(sheets);
    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(m => m.role === 'user').map(m => m.content || '');
    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];
    const row = [mobileNumber || '', arranged[0]||'', arranged[1]||'', arranged[2]||'', arranged[3]||'', arranged[4]||'', ticketId, ts];
    await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!A:Z`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } }).catch(() => {});
    return ticketId;
  } catch {
    return ticketId;
  }
}

/* -------------------------
   Gallabox sendMessage helper (WhatsApp)
--------------------------*/
async function sendMessage(to, name, message) {
  if (!GALLABOX.apiKey || !GALLABOX.apiSecret || !GALLABOX.channelId) throw new Error('Gallabox not configured');
  const payload = {
    channelId: GALLABOX.channelId,
    channelType: 'whatsapp',
    recipient: { name: name || 'Customer', phone: to },
    whatsapp: { type: 'text', text: { body: message } }
  };
  const resp = await axios.post(`${GALLABOX.baseUrl}/messages/whatsapp`, payload, {
    headers: { apiKey: GALLABOX.apiKey, apiSecret: GALLABOX.apiSecret, 'Content-Type': 'application/json' },
    timeout: 10000
  });
  return resp.data;
}

/* -------------------------
   Main session-aware response function
--------------------------*/
async function getChatGPTResponse(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  createOrTouchSession(sessionId);
  const session = conversations[sessionId];

  // quick check: seller onboarding phrases
  const msgLower = String(userMessage || '').toLowerCase();
  if (['sell on','sell with','become a seller','become seller','be a seller','how to join','onboard','register as seller','join as seller','become a merchant','how to sell','partner with zulu','seller signup'].some(t => msgLower.includes(t))) {
    session.lastDetectedIntent = 'seller';
    session.lastDetectedIntentTs = nowMs();
    return `Want to sell on Zulu Club? Sign up here: https://app.zulu.club/brand\nFill the seller form: https://forms.gle/tvkaKncQMs29dPrPA`;
  }

  // 1) classify incoming single message
  const classification = await classifyAndMatchWithGPT(userMessage);
  let intent = classification.intent || 'company';
  if (intent === 'product') {
    session.lastDetectedIntent = 'product';
    session.lastDetectedIntentTs = nowMs();
  }

  // agent flow
  if (intent === 'agent') {
    session.lastDetectedIntent = 'agent';
    session.lastDetectedIntentTs = nowMs();
    const fullHistory = getFullSessionHistory(sessionId);
    let ticketId = await createAgentTicket(sessionId, fullHistory).catch(() => generateTicketId());
    // log to sheet column for session (best-effort)
    try { await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`); } catch {}
    return `Our representative will connect with you soon. Your ticket id: ${ticketId}`;
  }

  // voice_ai flow
  if (intent === 'voice_ai') {
    session.lastDetectedIntent = 'voice_ai';
    session.lastDetectedIntentTs = nowMs();
    return `🎵 *Custom AI Music Message (Premium Add-on)*\n\nFor gifts above ₹1,000:\n• Provide a fun/emotional dialogue\n• We turn it into a personalised AI song\n• Delivered within *2 hours* on WhatsApp\n\nCreate your AI song: ${VOICE_AI_FORM_LINK}`;
  }

  // seller / investors simple flows
  if (intent === 'seller') {
    session.lastDetectedIntent = 'seller';
    session.lastDetectedIntentTs = nowMs();
    return `Want to sell on Zulu Club? Sign up: https://app.zulu.club/brand\nForm: https://forms.gle/tvkaKncQMs29dPrPA`;
  }
  if (intent === 'investors') {
    session.lastDetectedIntent = 'investors';
    session.lastDetectedIntentTs = nowMs();
    return `Thanks for your interest in investing. Please share your pitch deck: https://forms.gle/5wwfYFB7gGs75pYq5`;
  }

  // product flow (full pipeline)
  if (intent === 'product' && galleriesData.length > 0) {
    // try classifier-provided matches
    let matchedCategories = (classification.matches || []).map(m => m.type2).filter(Boolean).map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim())).filter(Boolean).slice(0,5);

    // if none or short qualifier, call history-aware category matcher
    const isShortQualifier = (txt) => { if (!txt) return false; const t = String(txt).trim(); return t.split(/\s+/).length <= 3 || t.length <= 12; };
    if (!matchedCategories.length || isShortQualifier(userMessage)) {
      const fullHistory = getFullSessionHistory(sessionId);
      const refined = await findGptMatchedCategories(userMessage, fullHistory);
      if (refined && refined.length) matchedCategories = refined;
    }

    // fallback to local keyword matching
    if (!matchedCategories.length) {
      const keywordMatches = findKeywordMatchesInCat1(userMessage);
      if (keywordMatches.length) matchedCategories = keywordMatches;
      else {
        const fullHistory = getFullSessionHistory(sessionId);
        const refined = await findGptMatchedCategories(userMessage, fullHistory);
        if (refined && refined.length) matchedCategories = refined;
      }
    }

    // infer gender from matched categories
    const detectedGender = inferGenderFromCategories(matchedCategories);

    // find sellers (uses GPT-checks internally)
    const sellers = await findSellersForQuery(userMessage, matchedCategories, detectedGender);

    // return concise response
    return buildConciseResponse(userMessage, matchedCategories, sellers);
  }

  // default: company response
  return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), ZULU_CLUB_INFO);
}

/* -------------------------
   handleMessage wrapper (saves history, logs to sheets, sends response)
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  appendToSessionHistory(sessionId, 'user', userMessage);
  try { await appendUnderColumn(sessionId, `USER: ${userMessage}`); } catch {}
  const aiResponse = await getChatGPTResponse(sessionId, userMessage);
  appendToSessionHistory(sessionId, 'assistant', aiResponse);
  try { await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`); } catch {}
  if (conversations[sessionId]) conversations[sessionId].lastActive = nowMs();
  return aiResponse;
}

/* -------------------------
   Express routes
--------------------------*/
app.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body || {};
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage);
      // send via Gallabox (best-effort)
      try { await sendMessage(userPhone, userName, aiResponse); } catch {}
    }
    res.status(200).json({ status: 'success', processed: true });
  } catch (err) {
    res.status(500).json({ status: 'error', message: String(err && err.message) || 'unknown' });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Server is running',
    service: 'Zulu Club WhatsApp AI Assistant (refactored)',
    version: 'refactor-1',
    stats: { product_categories_loaded: galleriesData.length, sellers_loaded: sellersData.length, active_conversations: Object.keys(conversations).length },
    timestamp: new Date().toISOString()
  });
});

app.get('/refresh-csv', async (req, res) => {
  try {
    const g = await loadGalleriesData();
    const s = await loadSellersData();
    res.json({ status: 'success', categories_loaded: g.length, sellers_loaded: s.length });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/test-keyword-matching', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  const isClothing = /men|women|kid|kids|child|children/gi.test(query);
  const keywordMatches = findKeywordMatchesInCat1(query);
  const detectedGender = inferGenderFromCategories(keywordMatches);
  const sellers = await findSellersForQuery(query, keywordMatches, detectedGender);
  const concise = buildConciseResponse(query, keywordMatches, sellers);
  res.json({ query, is_clothing_query: isClothing, detected_gender: detectedGender, keyword_matches: keywordMatches, sellers, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
});

app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  const dummyHistory = [{ role: 'user', content: 'Earlier I asked about lamps' }, { role: 'assistant', content: 'Would you like modern floor lamps?' }];
  const matched = await findGptMatchedCategories(query, dummyHistory);
  const detectedGender = inferGenderFromCategories(matched);
  res.json({ query, matched_categories: matched, detected_gender: detectedGender, categories_loaded: galleriesData.length });
});

app.post('/send-test-message', async (req, res) => {
  try {
    const { to, name, message } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing "to"' });
    const result = await sendMessage(to, name || 'Test User', message || 'Hello! This is a test message from Zulu Club AI Assistant.');
    res.json({ status: 'success', data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session' });
  res.json({ sessionId: id, lastActive: s.lastActive, historyLen: s.history.length, history: s.history });
});

// export (works for Vercel or classic node)
module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

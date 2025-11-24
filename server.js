// server.js - GPT-first intent + category matcher (AI is the boss)
// Gender detection now uses category data (cat_id / cat1) as the source of truth.

const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

const { google } = require('googleapis'); // ADDED: for Google Sheets logging

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

// -------------------------
// PERSISTED DATA: conversations, csvs
// -------------------------
let conversations = {}; // sessionId -> { history: [{role, content, ts}], lastActive }
let galleriesData = [];
let sellersData = []; // sellers CSV data

// -------------------------
// Google Sheets config (ADDED)
// -------------------------
// Name of the sheet/tab to store agent tickets — default to the tab you added (Sheet2)
// Override in production with env var AGENT_TICKETS_SHEET
const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Sheet2';

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || 'Sheet1';
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

const VOICE_AI_SHEET = process.env.VOICE_AI_SHEET || 'Sheet3';

if (!GOOGLE_SHEET_ID) {
  console.log('⚠️ GOOGLE_SHEET_ID not set — sheet logging disabled');
}
if (!SA_JSON_B64) {
  console.log('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set — sheet logging disabled');
}

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

// -------------------------
// ZULU CLUB INFORMATION
// -------------------------
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

Explore & shop on: zulu.club
Get the Zulu Club app: Android-> Playstore iOS-> Appstore
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
            cat_id: data.cat_id || data.CAT_ID || '',
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
   Agent ticket helpers
   - Creates a ticket id and appends a row to your AGENT_TICKETS_SHEET
   - Headers: mobile_number, last_5th_message, 4th_message, 3rd_message, 2nd_message, 1st_message, ticket_id, ts
--------------------------*/

function generateTicketId() {
  const now = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${now}-${rand}`;
}

async function ensureAgentTicketsHeader(sheets) {
  try {
    const sheetName = AGENT_TICKETS_SHEET;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!1:1`
    }).catch(() => null);

    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = ['mobile_number', 'last_5th_message', '4th_message', '3rd_message', '2nd_message', '1st_message', 'ticket_id', 'ts'];
    if (existing.length === 0 || required.some((h, i) => String(existing[i] || '').trim().toLowerCase() !== h)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [required] }
      });
    }
    return sheetName;
  } catch (e) {
    console.error('ensureAgentTicketsHeader error', e);
    return AGENT_TICKETS_SHEET;
  }
}

async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot write agent ticket');
    return generateTicketId();
  }
  try {
    const sheetName = await ensureAgentTicketsHeader(sheets);

    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(m => m.role === 'user')
      .map(m => (m.content || ''));

    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];

    const ticketId = generateTicketId();
    const ts = new Date().toISOString();

    const row = [
      mobileNumber || '',
      arranged[0] || '',
      arranged[1] || '',
      arranged[2] || '',
      arranged[3] || '',
      arranged[4] || '',
      ticketId,
      ts
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    return ticketId;
  } catch (e) {
    console.error('createAgentTicket error', e);
    return generateTicketId();
  }
}

/* -------------------------
   Matching helpers (kept + gender-from-cat_id)
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
  const clothingTerms = ['men', 'women', 'kids', 'kid', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
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
   Seller matching (kept but uses explicit gender from categories)
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
      if (sellerGenders.size > 0 && !sellerGenders.has(detectedGender)) {
        return;
      }
    }

    matches.push({ seller, score: sim });
  });
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0, 10);
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
    if (common.length > 0) {
      matches.push({ seller, matches: common.length });
    }
  });
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0, 10);
}

async function isQueryHome(userMessage) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  const prompt = `
You are a classifier that decides whether a user search query is about HOME / HOME DECOR items (vases, lamps, clocks, showpieces, cushions, etc.) or NOT.

USER QUERY: "${userMessage}"

Answer ONLY with JSON:
{ "is_home_score": 0.0, "reasoning": "one-to-three-sentence reasoning why you scored it this way" }

Where is_home_score is a number 0.0 - 1.0 representing how strongly this query is home/home-decor related.
Do not include any text outside the JSON.
  `;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier that returns only JSON with is_home_score and reasoning." },
        { role: "user", content: prompt }
      ],
      max_tokens: 120,
      temperature: 0.0
    });
    const raw = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(raw);
      const score = Number(parsed.is_home_score) || 0;
      return { isHome: score >= GPT_HOME_THRESHOLD, score, reasoning: parsed.reasoning || parsed.debug_reasoning || '' };
    } catch (e) {
      console.error('Error parsing isQueryHome JSON:', e, 'raw:', raw);
      return { isHome: false, score: 0, reasoning: '' };
    }
  } catch (err) {
    console.error('GPT error in isQueryHome:', err);
    return { isHome: false, score: 0, reasoning: '' };
  }
}

async function gptCheckSellerMaySell(userMessage, seller) {
  if (!openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured', reasoning: '' };

  const prompt = `
You are an assistant that rates how likely a seller sells a product a user asks for.

USER MESSAGE: "${userMessage}"

SELLER INFORMATION:
Store name: "${seller.store_name || ''}"
Seller id: "${seller.seller_id || ''}"
Seller categories: "${(seller.category_ids_array || []).join(', ')}"
Other info (raw CSV row): ${JSON.stringify(seller.raw || {})}

Question: Based on the above, how likely (0.0 - 1.0) is it that this seller sells the product the user is asking for?

Return ONLY valid JSON in this format:
{ "score": 0.0, "reason": "one-sentence reason", "reasoning": "1-3 sentence compact chain-of-thought / steps used to decide" }

Do not return anything else.
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier & scorer. Return only JSON {score, reason, reasoning}." },
        { role: "user", content: prompt }
      ],
      max_tokens: 180,
      temperature: 0.0
    });

    const content = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return {
        score: Number(parsed.score) || 0,
        reason: parsed.reason || parsed.explanation || '',
        reasoning: parsed.reasoning || parsed.debug_reasoning || ''
      };
    } catch (parseError) {
      console.error('Error parsing GPT seller-check response:', parseError, 'raw:', content);
      return { score: 0, reason: 'GPT response could not be parsed', reasoning: content.slice(0, 300) };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error', reasoning: '' };
  }
}

function getUserIdForSellerId(sellerId) {
  if (!sellerId) return '';
  const s = sellersData.find(x => (x.seller_id && String(x.seller_id) === String(sellerId)));
  if (s && s.user_id && String(s.user_id).trim().length > 0) return String(s.user_id).trim();
  return String(sellerId).trim();
}

/* -------------------------
   Utility: infer gender from matched categories (cat_id / cat1)
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
   master function to find sellers for a user query
--------------------------*/
async function findSellersForQuery(userMessage, galleryMatches = [], detectedGender = null) {
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome;

  if (!detectedGender) {
    detectedGender = inferGenderFromCategories(galleryMatches);
  }

  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }

  const catMatches = matchSellersByCategoryIds(userMessage, detectedGender);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));

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

  const toCheck = candidateList.slice(0, MAX_GPT_SELLER_CHECK);

  const gptPromises = toCheck.map(async (seller) => {
    if (applyHomeFilter) {
      const arr = seller.category_ids_array || [];
      const isHome = arr.some(c => 
        c.includes("home") || c.includes("decor") || 
        c.includes("lamp") || c.includes("vase") || 
        c.includes("clock") || c.includes("furnit")
      );
      if (!isHome) return null;
    }

    const result = await gptCheckSellerMaySell(userMessage, seller);

    if (result.score > GPT_THRESHOLD) {
      return { seller, score: result.score, reason: result.reason };
    }

    return null;
  });

  const gptResults = await Promise.all(gptPromises);
  gptResults.forEach(r => {
    if (r) sellers_by_gpt.push(r);
  });

  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);

  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt,
    homeCheck
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
   findGptMatchedCategories (UPDATED)
--------------------------*/
async function findGptMatchedCategories(userMessage, conversationHistory = []) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id
    }));

    const systemContent = "You are a product matching expert for Zulu Club. Use the conversation history to understand what the user wants, and return only JSON with top matches and a compact reasoning field.";
    const messagesForGPT = [{ role: 'system', content: systemContent }];

    const historyToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-30) : [];
    for (const h of historyToInclude) {
      const role = (h.role === 'assistant') ? 'assistant' : 'user';
      messagesForGPT.push({ role, content: h.content });
    }

    const userPrompt = `
Using the conversation above and the user's latest message, return the top 5 matching categories from the AVAILABLE PRODUCT CATEGORIES (use the "type2" field). For each match return a short reason and a relevance score 0.0-1.0.

AVAILABLE PRODUCT CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE: "${userMessage}"

RESPONSE FORMAT (JSON ONLY):
{
  "matches": [
    { "type2": "exact-type2-value-from-csv", "reason": "brief explanation", "score": 0.9 }
  ],
  "reasoning": "1-3 sentence summary of how you matched categories (brief steps)"
}
    `;
    messagesForGPT.push({ role: 'user', content: userPrompt });

    console.log(`🧾 findGptMatchedCategories -> sending ${messagesForGPT.length} messages to OpenAI (session history included).`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForGPT,
      max_tokens: 1000,
      temperature: 0.2
    });

    const responseText = completion.choices[0].message.content.trim();
    let matches = [];
    let reasoning = '';
    try {
      const parsed = JSON.parse(responseText);
      matches = parsed.matches || [];
      reasoning = parsed.reasoning || parsed.debug_reasoning || '';
    } catch (e) {
      console.error('Error parsing GPT product matches JSON:', e, 'raw:', responseText);
      matches = [];
      reasoning = responseText.slice(0, 300);
    }

    const matchedCategories = matches
      .map(match => galleriesData.find(item => String(item.type2).trim() === String(match.type2).trim()))
      .filter(Boolean)
      .slice(0,5);

    matchedCategories._reasoning = reasoning;
    return matchedCategories;
  } catch (error) {
    console.error('Error in findGptMatchedCategories:', error);
    return [];
  }
}

/* -------------------------
   GPT-first classifier + category matcher (single call)
--------------------------*/
async function classifyAndMatchWithGPT(userMessage) {
  const text = (userMessage || '').trim();
  if (!text) {
    return { intent: 'company', confidence: 1.0, reason: 'empty message', matches: [], reasoning: '' };
  }

  if (!openai || !process.env.OPENAI_API_KEY) {
    return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [], reasoning: '' };
  }

  const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));

  const prompt = `
You are an assistant for Zulu Club (a lifestyle shopping service).

Task:
1) Decide the user's intent. Choose exactly one of: "company", "product", "seller", "investors", "agent".
   - "company": general questions, greetings, store info, pop-ups, support, availability.
   - "product": the user is asking to browse or buy items, asking what we have, searching for products/categories.
   - "seller": queries about selling on the platform, onboarding merchants.
   - "investors": questions about business model, revenue, funding, pitch, investment.
   - "agent": the user explicitly asks to connect to a human/agent/representative, or asks for a person to contact them (e.g., "connect me to agent", "I want a human", "talk to a person", "connect to representative").

2) If the intent is "product", pick up to 5 best-matching categories from the AVAILABLE CATEGORIES list provided (match using the "type2" field). For each match return a short reason and a relevance score between 0.0 and 1.0.

3) Return ONLY valid JSON in this exact format (no extra text):
{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "matches": [
    { "type2": "exact-type2-from-csv", "reason": "why it matches", "score": 0.85 }
  ],
  "reasoning": "1-3 sentence concise explanation of the steps you took to decide (brief chain-of-thought)"
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
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a JSON-only classifier & category matcher. Return only the requested JSON, including a short 'reasoning' field." },
        { role: "user", content: prompt }
      ],
      max_tokens: 900,
      temperature: 0.12
    });

    const raw = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) ? completion.choices[0].message.content.trim() : '';
    try {
      const parsed = JSON.parse(raw);
      const allowedIntents = ['company', 'product', 'seller', 'investors', 'agent'];
      const intent = (parsed.intent && allowedIntents.includes(parsed.intent)) ? parsed.intent : 'company';
      const confidence = Number(parsed.confidence) || 0.0;
      const reason = parsed.reason || '';
      const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ type2: m.type2, reason: m.reason, score: Number(m.score) || 0 })) : [];
      const reasoning = parsed.reasoning || parsed.debug_reasoning || '';

      console.log('🧾 classifyAndMatchWithGPT parsed:', { raw, parsed, intent, confidence });

      return { intent, confidence, reason, matches, reasoning };

    } catch (e) {
      console.error('Error parsing classifyAndMatchWithGPT JSON:', e, 'raw:', raw);
      return { intent: 'company', confidence: 0.0, reason: 'parse error from GPT', matches: [], reasoning: raw.slice(0, 300) };
    }
  } catch (err) {
    console.error('Error calling OpenAI classifyAndMatchWithGPT:', err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [], reasoning: '' };
  }
}

/* -------------------------
   Company Response Generator
--------------------------*/
function isGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'greetings', 'namaste', 'namaskar' , 'hola', 'hey there'];
  const cleaned = t.replace(/[^\w\s]/g, '').trim();
  if (greetings.includes(cleaned)) return true;
  if (/^hi+$/i.test(cleaned)) return true;
  if (greetings.some(g => cleaned === g)) return true;
  return false;
}

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

  const LINKS_BLOCK = [
    "*iOS:*",
    "https://apps.apple.com/in/app/zulu-club/id6739531325",
    "*Android:*",
    "https://play.google.com/store/apps/details?id=com.zulu.consumer.zulu_consumer"
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      max_tokens: 300,
      temperature: 0.6
    });

    let assistantText = (completion.choices[0].message && completion.choices[0].message.content)
      ? completion.choices[0].message.content.trim()
      : "";

    if (!isGreeting(userMessage)) {
      if (assistantText.length > 0) assistantText = assistantText + "\n\n" + LINKS_BLOCK;
      else assistantText = LINKS_BLOCK;
    }

    return assistantText;
  } catch (e) {
    console.error('Error in generateCompanyResponse:', e);
    let fallback = `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.`;
    if (!isGreeting(userMessage)) {
      fallback = `${fallback}\n\n${LINKS_BLOCK}`;
    }
    return fallback;
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
   Session/history helpers
--------------------------*/
const SESSION_TTL_MS = 1000 * 60 * 60;
const SESSION_CLEANUP_MS = 1000 * 60 * 5;
const MAX_HISTORY_MESSAGES = 2000;

function nowMs() { return Date.now(); }

function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      history: [],
      lastActive: nowMs(),
      lastDetectedIntent: null,
      lastDetectedIntentTs: 0
    };
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

app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session found' });
  res.json({ sessionId: id, lastActive: s.lastActive, historyLen: s.history.length, history: s.history });
});

/* -------------------------
   Heuristic helper - detect product words in history
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
   VOICE-AI: helpers and flow
--------------------------*/
function generateFormId() {
  const id = Math.floor(10000 + Math.random() * 90000);
  return String(id);
}

function isVoiceAIQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  const triggers = [
    'voice ai', 'voice-ai', 'voiceai', 'voice assistant', 'voice assistant form', 'voiceai form', 'voice form',
    'generate voice', 'voiceover', 'voice over', 'audio ai', 'record my voice', 'voice ai form', 'voiceaiform'
  ];
  return triggers.some(tr => t.includes(tr));
}

async function writeVoiceAIFormToSheet(formRow) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot write voice AI form');
    return false;
  }

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${VOICE_AI_SHEET}!1:1`
    }).catch(() => null);

    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = ['id','phn_no','name','email','genre','dialogue','friend_name','product_you_gift','time_to_deliver_output','optional_comment'];
    if (existing.length === 0 || required.some((h, i) => String(existing[i] || '').trim().toLowerCase() !== h)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${VOICE_AI_SHEET}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [required] }
      });
    }

    const values = [
      formRow.id || '',
      formRow.phn_no || '',
      formRow.name || '',
      formRow.email || '',
      formRow.genre || '',
      formRow.dialogue || '',
      formRow.friend_name || '',
      formRow.product_you_gift || '',
      formRow.time_to_deliver_output || '',
      formRow.optional_comment || ''
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${VOICE_AI_SHEET}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] }
    });

    return true;
  } catch (e) {
    console.error('writeVoiceAIFormToSheet error', e);
    return false;
  }
}

const VOICE_AI_QUESTIONS = [
  { key: 'name', prompt: 'Please provide the name for the voice piece.' },
  { key: 'email', prompt: 'Please provide an email so we can contact you.' },
  { key: 'genre', prompt: 'Which genre should the voice follow? (e.g., comedy, drama, romantic, horror)' },
  { key: 'dialogue', prompt: 'Please paste/type the dialogue (the lines to be voiced).' },
  { key: 'friend_name', prompt: "What is your friend's name?" },
  { key: 'product_you_gift', prompt: 'Which product are you gifting (product name)?' },
  { key: 'time_to_deliver_output', prompt: 'When do you need the output delivered? (date/time)' },
  { key: 'optional_comment', prompt: 'Any optional comment? (type "skip" to leave blank)' }
];

async function handleVoiceAIForm(sessionId, userMessage) {
  createOrTouchSession(sessionId);
  const session = conversations[sessionId];

  
  // Always log incoming message while voice form is active (or starting)
  const safeMsg = (userMessage || '').trim();

  // If form not started, start it and log the trigger message
  if (!session.voiceForm || !session.voiceForm.active) {
    const id = generateFormId();
    session.voiceForm = {
      active: true,
      id,
      stepIndex: 0,
      answers: {},
      startedAt: new Date().toISOString(),
      phn_no: sessionId
    };

    // Log into session column and dedicated columns
    try { await appendUnderColumn(sessionId, `voice_ai: ${safeMsg}`); } catch (e) { /* ignore */ }
    try { await appendUnderColumn('voice_ai', safeMsg); } catch (e) { /* ignore */ }
    try { await appendUnderColumn('ex-voice_ai', safeMsg); } catch (e) { /* ignore */ }

    const firstQ = VOICE_AI_QUESTIONS[0].prompt;
    return `Sure — let's create your Voice AI form. Your form ID is *${id}*.\n\n${firstQ}`;
  }

  // If form already active, log the incoming answer before processing
  try { await appendUnderColumn(sessionId, `voice_ai: ${safeMsg}`); } catch (e) { /* ignore */ }
  try { await appendUnderColumn('voice_ai', safeMsg); } catch (e) { /* ignore */ }
  try { await appendUnderColumn('ex-voice_ai', safeMsg); } catch (e) { /* ignore */ }

  const vf = session.voiceForm;
  const idx = vf.stepIndex;
  let answer = safeMsg;
  if (VOICE_AI_QUESTIONS[idx] && VOICE_AI_QUESTIONS[idx].key === 'optional_comment' && /^skip$/i.test(answer)) answer = '';

  const currentKey = VOICE_AI_QUESTIONS[idx].key;
  vf.answers[currentKey] = answer;

  vf.stepIndex += 1;

  if (vf.stepIndex < VOICE_AI_QUESTIONS.length) {
    const nextQ = VOICE_AI_QUESTIONS[vf.stepIndex].prompt;
    return nextQ;
  }

  vf.active = false;
  const finalRow = {
    id: vf.id,
    phn_no: vf.phn_no,
    name: vf.answers.name || '',
    email: vf.answers.email || '',
    genre: vf.answers.genre || '',
    dialogue: vf.answers.dialogue || '',
    friend_name: vf.answers.friend_name || '',
    product_you_gift: vf.answers.product_you_gift || '',
    time_to_deliver_output: vf.answers.time_to_deliver_output || '',
    optional_comment: vf.answers.optional_comment || ''
  };

  let ok = false;
  try {
    ok = await writeVoiceAIFormToSheet(finalRow);
  } catch (e) {
    ok = false;
  }

  try {
    await appendUnderColumn(sessionId, `VOICEAI_FORM_SUBMITTED: ${vf.id} | ${JSON.stringify(finalRow)}`);
  } catch (e) { /* ignore */ }

  const ack = ok
    ? `Thank you! Your Voice AI form (ID *${vf.id}*) has been saved. We'll contact you at ${finalRow.email || 'the provided contact'} with next steps.`
    : `Thank you! Your Voice AI form (ID *${vf.id}*) is complete. We attempted to save it but couldn't reach Google Sheets — we'll follow up shortly.`;

  return ack;
}


/* -------------------------
   Main product flow with Voice-AI integration
--------------------------*/
async function getChatGPTResponse(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    createOrTouchSession(sessionId);
    const session = conversations[sessionId];
    
    if (session.voiceForm && session.voiceForm.active) {
        userMessage = `voice_ai: ${userMessage}`;
    }

    if (conversations[sessionId] && conversations[sessionId].voiceForm && conversations[sessionId].voiceForm.active) {
      return await handleVoiceAIForm(sessionId, userMessage);
    }

    if (isVoiceAIQuery(userMessage)) {
      return await handleVoiceAIForm(sessionId, userMessage);
    }

    if (isSellerOnboardQuery(userMessage)) {
      session.lastDetectedIntent = 'seller';
      session.lastDetectedIntentTs = nowMs();
      return sellerOnboardMessage();
    }

    // if voice form active for this session, prefix the classifier input so GPT sees "voice_ai: <message>"
    let classificationInput = userMessage;
    if (conversations[sessionId] && conversations[sessionId].voiceForm && conversations[sessionId].voiceForm.active) {
        classificationInput = `voice_ai: ${userMessage}`;
    }
    const classification = await classifyAndMatchWithGPT(classificationInput);

    let intent = classification.intent || 'company';
    let confidence = classification.confidence || 0;

    console.log('🧠 GPT classification (single-message):', { intent, confidence, reason: classification.reason });

    if (intent === 'product') {
      session.lastDetectedIntent = 'product';
      session.lastDetectedIntentTs = nowMs();
    }

    if (intent === 'agent') {
      session.lastDetectedIntent = 'agent';
      session.lastDetectedIntentTs = nowMs();

      const fullHistory = getFullSessionHistory(sessionId);

      let ticketId = '';
      try {
        ticketId = await createAgentTicket(sessionId, fullHistory);
      } catch (e) {
        console.error('Error creating agent ticket:', e);
        ticketId = generateTicketId();
      }

      try {
        await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`);
      } catch (e) {
        console.error('Failed to log agent ticket into column:', e);
      }

      const reply = `Our representative will connect with you soon (within 30 mins). Your ticket id: ${ticketId}`;
      return reply;
    }

    if (intent === 'seller') {
      session.lastDetectedIntent = 'seller';
      session.lastDetectedIntentTs = nowMs();
      return sellerOnboardMessage();
    }

    if (intent === 'investors') {
      session.lastDetectedIntent = 'investors';
      session.lastDetectedIntentTs = nowMs();
      return INVESTORS_PARAGRAPH.trim();
    }

    if (intent === 'product' && galleriesData.length > 0) {
      if (session.lastDetectedIntent !== 'product') {
        session.lastDetectedIntent = 'product';
        session.lastDetectedIntentTs = nowMs();
      }

      const matchedType2s = (classification.matches || []).map(m => m.type2).filter(Boolean);
      let matchedCategories = [];
      if (matchedType2s.length > 0) {
        matchedCategories = matchedType2s
          .map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim()))
          .filter(Boolean)
          .slice(0,5);
      }

      if (matchedCategories.length === 0) {
        const fullHistory = getFullSessionHistory(sessionId);
        matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
      } else {
        const fullHistory = getFullSessionHistory(sessionId);
        const isShortOrQualifier = (msg) => {
          if (!msg) return false;
          const trimmed = String(msg).trim();
          if (trimmed.split(/\s+/).length <= 3) return true;
          if (trimmed.length <= 12) return true;
          return false;
        };
        if (isShortOrQualifier(userMessage)) {
          const refined = await findGptMatchedCategories(userMessage, fullHistory);
          if (refined && refined.length > 0) matchedCategories = refined;
        }
      }

      if (matchedCategories.length === 0) {
        if (containsClothingKeywords(userMessage)) {
          const fullHistory = getFullSessionHistory(sessionId);
          matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
        } else {
          const keywordMatches = findKeywordMatchesInCat1(userMessage);
          if (keywordMatches.length > 0) {
            matchedCategories = keywordMatches;
          } else {
            const fullHistory = getFullSessionHistory(sessionId);
            matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
          }
        }
      }

      const detectedGender = inferGenderFromCategories(matchedCategories);
      const sellers = await findSellersForQuery(userMessage, matchedCategories, detectedGender);
      return buildConciseResponse(userMessage, matchedCategories, sellers);
    }

    return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), companyInfo);

  } catch (error) {
    console.error('❌ getChatGPTResponse error (session-aware):', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

// -------------------------
// Updated handleMessage to call session-aware getChatGPTResponse
// - When voiceForm.active === true, store & pass the prefixed message everywhere
// -------------------------
async function handleMessage(sessionId, userMessage) {
  try {
    // ensure session exists so we can check voiceForm
    createOrTouchSession(sessionId);
    const session = conversations[sessionId];

    // choose what we will store / pass downstream.
    // if voice form active -> prefix the message everywhere (history, sheets, classifier, etc.)
    const storedMessage = (session && session.voiceForm && session.voiceForm.active)
      ? `voice_ai: ${userMessage}`
      : userMessage;

    // 1) Save incoming (possibly prefixed) user message to session history
    appendToSessionHistory(sessionId, 'user', storedMessage);

    // 2) Log user message to Google Sheet (column = phone/sessionId) — best-effort
    try {
      await appendUnderColumn(sessionId, `USER: ${storedMessage}`);
    } catch (e) {
      console.error('sheet log user failed', e);
    }

    // 3) Debug print compact history (after storing the prefixed message)
    const fullHistory = getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}`);
    fullHistory.forEach((h, idx) => {
      console.log(`   ${idx + 1}. [${h.role}] ${h.content}`);
    });

    // 4) IMPORTANT: pass the storedMessage (prefixed if voice form active) to the processor
    const aiResponse = await getChatGPTResponse(sessionId, storedMessage);

    // 5) Save AI response back into session history
    appendToSessionHistory(sessionId, 'assistant', aiResponse);

    // 6) Log assistant response to Google Sheet (same column) — best-effort
    try {
      await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`);
    } catch (e) {
      console.error('sheet log assistant failed', e);
    }

    // 7) update lastActive (appendToSessionHistory already did this)
    if (conversations[sessionId]) conversations[sessionId].lastActive = nowMs();

    // 8) return the assistant reply
    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message (session-aware):', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
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
      console.log(`➡️ Handling message for session ${sessionId}`);
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
    version: '6.1 - Intent-first + session history & sheets logging (history used only after intent) + Voice-AI form',
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
    const detectedGender = inferGenderFromCategories(keywordMatches);
    const sellers = await findSellersForQuery(query, keywordMatches, detectedGender);
    const concise = buildConciseResponse(query, keywordMatches, sellers);
    res.json({ query, is_clothing_query: isClothing, detected_gender: detectedGender, keyword_matches: keywordMatches, sellers, homeCheck: sellers.homeCheck || {}, concise_preview: concise, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const dummyHistory = [{ role: 'user', content: 'Earlier I asked about lamps' }, { role: 'assistant', content: 'Would you like modern floor lamps?' }];
    const matched = await findGptMatchedCategories(query, dummyHistory);
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

// Export for Vercel
module.exports = app;

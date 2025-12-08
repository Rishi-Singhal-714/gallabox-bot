// server.js - Optimized batch GPT for galleries + sellers (top 5), same model (gpt-4o-mini)

const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');
const preIntentFilter = require('./preintentfilter');
const { google } = require('googleapis');

const app = express();

const VOICE_AI_FORM_LINK = 'https://forms.gle/CiPAk6RqWxkd8uSKA';

const EMPLOYEE_NUMBERS = [
  "918368127760"
];

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
let conversations = {}; // sessionId -> { history: [{role, content, ts}], lastActive, lastDetectedIntent, lastDetectedIntentTs }
let galleriesData = [];
let sellersData = []; // sellers CSV data

// -------------------------
// Google Sheets config
// -------------------------
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || 'Sheet1';
// Sheet/tab for agent tickets
const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Sheet2';
// Billing sheet (not used directly here, but kept for compatibility)
const BILLING_SHEET_NAME = process.env.BILLING_SHEET_NAME || "Sheet3";

const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

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
    // read headers (first row)
    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: '1:1'
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    let colIndex = headers.findIndex(h => String(h).trim() === headerName);
    if (colIndex === -1) {
      // add header at end
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
    // read column values from row 2 down to find next empty row
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

const INVESTOR_KNOWLEDGE = `
Zulu, founded in 2024 by Adarsh Bhatia with co-founder Anubhav, operates under MADMIND TECH INNOVATIONS PRIVATE LIMITED, Gurgaon.
Seed round: $250K raised on July 16, 2025 from TDV Partners.
Legal: CIN U47710HR2024PTC125362, registered on October 7, 2024.
HQ: D20-301, Ireo Victory Valley, Sector-67, Gurgaon.
Authorized capital INR 6.5 lakh | Paid-up INR 5.57 lakh.
1 brand (Zulu), 9 competitors (Inc: Slikk, Booon, Blip).
`;

const SELLER_KNOWLEDGE = `
Zulu Club is a lifestyle commerce platform by MADMIND TECH.
Serve Gurgaon — 100-min delivery. Try at home. Instant returns.
Works with fashion, beauty, home, footwear, accessories, kids & gifting.
Online visibility + offline pop-ups at AIPL Joy Street & Central.
High intent customers, fast logistics, frictionless onboarding.
zulu.club + Zulu Club apps (Android + iOS).
`;

/* -------------------------
   CSV loaders: galleries + sellers
--------------------------*/
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get(
      'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv',
      { timeout: 60000 }
    );

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
    const response = await axios.get(
      'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv',
      { timeout: 60000 }
    );

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
            mapped.category_ids_array = (mapped.category_ids || '')
              .split(',')
              .map(s => s.trim().toLowerCase())
              .filter(Boolean);
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

// initialize both CSVs at startup
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
   sendMessage
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
--------------------------*/
async function generateTicketId() {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn("Sheets not available — fallback random Ticket ID");
    const now = Date.now();
    return `TKT-${String(now).slice(-6)}`;
  }
  const COUNTER_CELL = `${AGENT_TICKETS_SHEET}!Z2`; // reserved for ticket counter
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: COUNTER_CELL
    });
    let current = resp.data.values?.[0]?.[0] ? Number(resp.data.values[0][0]) : 0;
    const next = current + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: COUNTER_CELL,
      valueInputOption: "RAW",
      requestBody: { values: [[next]] }
    });
    return `TKT-${String(next).padStart(6, "0")}`; // ex: TKT-000001
  } catch (err) {
    console.error("Ticket ID counter error:", err);
    return `TKT-${String(Date.now()).slice(-6)}`;
  }
}

async function ensureAgentTicketsHeader(sheets) {
  try {
    const sheetName = AGENT_TICKETS_SHEET;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!1:1`
    }).catch(() => null);
    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = [
      'mobile_number',
      'last_5th_message',
      '4th_message',
      '3rd_message',
      '2nd_message',
      '1st_message',
      'ticket_id',
      'ts'
    ];

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

    const ticketId = await generateTicketId();
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

    // Internal alerts to EMPLOYEE_NUMBERS
    try {
      const formattedNumber = mobileNumber.startsWith('91')
        ? mobileNumber
        : `91${mobileNumber}`;
      const createdAt = new Date().toLocaleString('en-IN', {
        timeZone: "Asia/Kolkata"
      });
      const customerName = (() => {
        if (!conversationHistory) return "Customer";
        const lastUser = conversationHistory.slice().reverse().find(m => m.role === 'user');
        return lastUser?.name || "Customer";
      })();
      const adminMessage =
        `📌 *New Agent Ticket Created*\n` +
        `Customer: +${formattedNumber}\n` +
        `Name: ${customerName}\n` +
        `Ticket ID: *${ticketId}*\n` +
        `Created At: ${createdAt}`;
      for (const admin of EMPLOYEE_NUMBERS) {
        console.log(`📤 Sending internal alert to: ${admin}`);
        await sendMessage(admin, "Admin", adminMessage);
      }
      console.log(`✔ Internal alerts sent for ticket: ${ticketId}`);
    } catch (err) {
      console.error("❌ Failed sending internal alerts:", err.message);
    }

    return ticketId;
  } catch (e) {
    console.error('createAgentTicket error', e);
    return generateTicketId();
  }
}

/* -------------------------
   Session/history helpers
--------------------------*/
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_CLEANUP_MS = 1000 * 60 * 5; // cleanup every 5 minutes
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
    conversations[sessionId].history =
      conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
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

// optional debug endpoint
app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session found' });
  res.json({
    sessionId: id,
    lastActive: s.lastActive,
    historyLen: s.history.length,
    history: s.history
  });
});

/* -------------------------
   Utility: URL encoding for type2 links
--------------------------*/
function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(t.trim().replace(/\s+/g, ' ')).replace(/%20/g, '%20');
}

/* -------------------------
   Small/concise response builder
   - Takes final top categories & top sellers
--------------------------*/
function buildConciseResponse(userMessage, galleryMatches = [], sellerMatches = []) {
  const galleries = (galleryMatches || []).slice(0, 5);

  // unique seller by seller_id/user_id
  const sellerMap = new Map();
  for (const s of sellerMatches || []) {
    if (!s) continue;
    const id = s.user_id || s.seller_id;
    if (!id) continue;
    if (!sellerMap.has(id)) sellerMap.set(id, s);
  }
  const sellersToShow = Array.from(sellerMap.values()).slice(0, 5);

  let msg = `Based on your interest in "${userMessage}":\n`;

  msg += `\nGalleries:\n`;
  if (galleries.length) {
    galleries.forEach((g, i) => {
      const t = g.type2 || '';
      const link = t ? `app.zulu.club/${urlEncodeType2(t)}` : '';
      msg += `${i + 1}. ${t}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i + 1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i + 1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  return msg.trim();
}

/* -------------------------
   Greeting detector
--------------------------*/
function isGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  const greetings = [
    'hi',
    'hello',
    'hey',
    'good morning',
    'good evening',
    'good afternoon',
    'greetings',
    'namaste',
    'namaskar',
    'hola',
    'hey there'
  ];
  const cleaned = t.replace(/[^\w\s]/g, '').trim();
  if (greetings.includes(cleaned)) return true;
  if (/^hi+$/i.test(cleaned)) return true;
  if (greetings.some(g => cleaned === g)) return true;
  return false;
}

/* -------------------------
   Company Response Generator
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
   Investor & Seller Responses
--------------------------*/
async function generateInvestorResponse(userMessage) {
  const prompt = `
You are an **Investor Relations Associate** for Zulu (MAD MIND TECH INNOVATIONS PVT LTD).

Use ONLY this factual data when answering:
${INVESTOR_KNOWLEDGE}

Rules:
• Respond directly to the user's question: "${userMessage}"
• Strong, authoritative IR tone (no over-selling)
• Include relevant metrics: funding, founders, growth stage, HQ, legal info according to user's question: "${userMessage}"
• Max 200 characters (2–4 sentences)
• Avoid emojis inside the explanation
• Do not mention “paragraph above” or internal sources
• If user asks broad or unclear query → Give concise Zulu overview

At the end, always add a separate CTA line:
Apply to invest 👉 https://forms.gle/5wwfYFB7gGs75pYq5
  `;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    temperature: 0.3
  });
  return res.choices[0].message.content.trim();
}

async function generateSellerResponse(userMessage) {
  const prompt = `
You are a **Brand Partnerships | Seller Success Associate** at Zulu Club.

Use ONLY this factual data when answering:
${SELLER_KNOWLEDGE}

Rules:
• Respond specifically to the seller’s question: "${userMessage}"
• Highlight benefits that match their intent (reach, logistics, onboarding, customers) according to user's question: "${userMessage}"
• Premium but friendly business tone
• Max 200 characters (2–4 sentences)
• Avoid emojis inside explanation
• Avoid generic copywriting style

Add this CTA as a new line at the end:
Join as partner 👉 https://forms.gle/tvkaKncQMs29dPrPA
  `;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    temperature: 0.35
  });
  return res.choices[0].message.content.trim();
}

/* -------------------------
   NEW: Single batch GPT for
   - Intent classification
   - Top 5 product categories
   - Top 5 sellers
--------------------------*/
async function classifyAndRankAll(userMessage, conversationHistory = []) {
  const text = (userMessage || '').trim();
  if (!text) {
    return {
      intent: 'company',
      confidence: 1.0,
      reason: 'empty message',
      categories: [],
      sellers: [],
      reasoning: ''
    };
  }
  if (!openai || !process.env.OPENAI_API_KEY) {
    return {
      intent: 'company',
      confidence: 0.0,
      reason: 'OpenAI not configured',
      categories: [],
      sellers: [],
      reasoning: ''
    };
  }

  // Prepare galleries + sellers for GPT
  const galleriesForGPT = galleriesData.map(item => ({
    type2: item.type2 || '',
    cat1: item.cat1 || '',
    cat_id: item.cat_id || '',
    seller_id: item.seller_id || ''
  }));

  const sellersForGPT = sellersData.map(s => ({
    seller_id: s.seller_id || '',
    user_id: s.user_id || '',
    store_name: s.store_name || '',
    categories: (s.category_ids_array || []).join(', ')
  }));

  // Include last few messages for context (without influencing intent too much)
  const recentUserHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .filter(m => m.role === 'user')
    .slice(-5)
    .map((m, idx) => `U${idx + 1}: ${m.content}`);

  const prompt = `
You are the Zulu Club product & intent router.

Tasks:
1) Decide the user's intent. Choose exactly one of:
   "company", "product", "seller", "investors", "agent", "voice_ai".

2) If intent = "product":
   - Rank the best matching PRODUCT CATEGORIES (galleries) using "type2".
   - Rank the best matching SELLERS that are likely to have what user wants.
   - Use ALL provided categories and sellers to decide.
   - You MUST pick at most 5 categories and at most 5 sellers, each with a relevance score (0.0–1.0).

3) If intent != "product":
   - Return empty arrays for "categories" and "sellers".

Definitions:
- "company": general info, greetings, store info, app links, features, city availability, pop-ups, support queries.
- "product": user wants to browse, search or buy items, asks for particular products, outfits, styles, or categories.
- "seller": wants to sell on Zulu, brand onboarding, partnership questions.
- "investors": funding, business model, revenue, valuations, investor relations.
- "agent": wants to talk to human or asks for call-back, "representative", "customer care person".
- "voice_ai": wants AI generated song, AI audio, custom voice message, goofy AI track etc.

CONTEXT (recent user messages):
${recentUserHistory.join('\n')}

CURRENT USER MESSAGE:
"""${String(userMessage).replace(/"/g, '\\"')}"""

AVAILABLE PRODUCT CATEGORIES (galleries):
${JSON.stringify(galleriesForGPT, null, 2)}

AVAILABLE SELLERS:
${JSON.stringify(sellersForGPT, null, 2)}

Return ONLY valid JSON in this format:

{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "categories": [
    { "type2": "exact-type2-from-galleries", "score": 0.9 }
  ],
  "sellers": [
    { "seller_id": "exact-seller-id-from-sellers", "score": 0.88 }
  ],
  "reasoning": "1-3 sentence concise explanation of how you matched things"
}
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a JSON-only router & ranker for Zulu Club. Return only valid JSON with keys: intent, confidence, reason, categories, sellers, reasoning."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.1
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing classifyAndRankAll JSON:', e, 'raw:', raw);
      return {
        intent: 'company',
        confidence: 0.0,
        reason: 'parse error',
        categories: [],
        sellers: [],
        reasoning: raw.slice(0, 300)
      };
    }

    const allowedIntents = ['company', 'product', 'seller', 'investors', 'agent', 'voice_ai'];
    const intent = (parsed.intent && allowedIntents.includes(parsed.intent)) ? parsed.intent : 'company';
    const confidence = Number(parsed.confidence) || 0.0;
    const reason = parsed.reason || '';
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.map(c => ({
        type2: c.type2,
        score: Number(c.score) || 0
      }))
      : [];
    const sellers = Array.isArray(parsed.sellers)
      ? parsed.sellers.map(s => ({
        seller_id: s.seller_id,
        score: Number(s.score) || 0
      }))
      : [];
    const reasoning = parsed.reasoning || parsed.debug_reasoning || '';

    console.log('🧾 classifyAndRankAll parsed:', {
      intent,
      confidence,
      reason,
      categories: categories.map(c => c.type2),
      sellers: sellers.map(s => s.seller_id)
    });

    return { intent, confidence, reason, categories, sellers, reasoning };
  } catch (err) {
    console.error('Error calling OpenAI classifyAndRankAll:', err);
    return {
      intent: 'company',
      confidence: 0.0,
      reason: 'gpt error',
      categories: [],
      sellers: [],
      reasoning: ''
    };
  }
}

/* -------------------------
   Main ChatGPT Response
--------------------------*/
async function getChatGPTResponse(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    createOrTouchSession(sessionId);
    const session = conversations[sessionId];

    // EMPLOYEE MODE: never enter product/company flow
    const isEmployee = EMPLOYEE_NUMBERS.includes(sessionId);
    if (isEmployee) {
      console.log("⚡ Employee mode active", sessionId);
      const employeeHandled = await preIntentFilter(
        openai,
        session,
        sessionId,
        userMessage,
        getSheets,
        createAgentTicket,
        appendUnderColumn
      );
      if (employeeHandled && employeeHandled.trim().length > 0) {
        return employeeHandled;
      }
      return "⚠️ Not able to note, please resend the message boss.";
    }

    const fullHistory = getFullSessionHistory(sessionId);
    const classification = await classifyAndRankAll(userMessage, fullHistory);

    let { intent, confidence } = classification;
    console.log('🧠 GPT classification (batch):', {
      intent,
      confidence,
      reason: classification.reason
    });

    // Track last detected intent
    session.lastDetectedIntent = intent;
    session.lastDetectedIntentTs = nowMs();

    // AGENT FLOW
    if (intent === 'agent') {
      const historyForTicket = getFullSessionHistory(sessionId);
      let ticketId = '';
      try {
        ticketId = await createAgentTicket(sessionId, historyForTicket);
      } catch (e) {
        console.error('Error creating agent ticket:', e);
        ticketId = await generateTicketId();
      }
      try {
        await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`);
      } catch (e) {
        console.error('Failed to log agent ticket into column:', e);
      }
      const reply = `Our representative will connect with you soon (within 30 mins). Your ticket id: ${ticketId}`;
      return reply;
    }

    // VOICE AI FLOW
    if (intent === 'voice_ai') {
      const message =
`🎵 *Custom AI Music Message (Premium Add-on)*

For every gift above ₹1,000:
• You give a fun/emotional dialogue or a voice note  
• We turn it into a goofy or personalised AI song  
• Delivered within *2 hours* on WhatsApp  
• Adds emotional value & boosts the gifting impact ❤️

Fill this quick form to create your AI song:
${VOICE_AI_FORM_LINK}`;
      return message;
    }

    // SELLER FLOW
    if (intent === 'seller') {
      return await generateSellerResponse(userMessage);
    }

    // INVESTORS FLOW
    if (intent === 'investors') {
      return await generateInvestorResponse(userMessage);
    }

    // PRODUCT FLOW USING BATCH GPT (TOP 5 categories + sellers)
    if (intent === 'product' && galleriesData.length > 0 && sellersData.length > 0) {
      const categoryMatches = classification.categories || [];
      const sellerMatches = classification.sellers || [];

      const matchedCategories = [];
      const usedType2 = new Set();
      for (const cm of categoryMatches) {
        if (!cm.type2) continue;
        const t2 = String(cm.type2).trim();
        if (usedType2.has(t2)) continue;
        const found = galleriesData.find(g => String(g.type2).trim() === t2);
        if (found) {
          matchedCategories.push(found);
          usedType2.add(t2);
        }
        if (matchedCategories.length >= 5) break;
      }

      const matchedSellers = [];
      const usedSellerIds = new Set();
      for (const sm of sellerMatches) {
        if (!sm.seller_id) continue;
        const sid = String(sm.seller_id).trim();
        if (usedSellerIds.has(sid)) continue;
        const found = sellersData.find(s => String(s.seller_id).trim() === sid);
        if (found) {
          matchedSellers.push(found);
          usedSellerIds.add(sid);
        }
        if (matchedSellers.length >= 5) break;
      }

      // Fallback: if GPT failed to return anything, take some defaults
      const finalCategories = matchedCategories.length ? matchedCategories : galleriesData.slice(0, 5);
      const finalSellers = matchedSellers.length ? matchedSellers : sellersData.slice(0, 5);

      return buildConciseResponse(userMessage, finalCategories, finalSellers);
    }

    // DEFAULT: COMPANY FLOW
    return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), companyInfo);
  } catch (error) {
    console.error('❌ getChatGPTResponse error (session-aware):', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   handleMessage (session-aware)
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  try {
    appendToSessionHistory(sessionId, 'user', userMessage);

    try {
      await appendUnderColumn(sessionId, `USER: ${userMessage}`);
    } catch (e) {
      console.error('sheet log user failed', e);
    }

    const fullHistory = getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}`);
    fullHistory.forEach((h, idx) => {
      console.log(`   ${idx + 1}. [${h.role}] ${h.content}`);
    });

    const aiResponse = await getChatGPTResponse(sessionId, userMessage);

    appendToSessionHistory(sessionId, 'assistant', aiResponse);

    try {
      await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`);
    } catch (e) {
      console.error('sheet log assistant failed', e);
    }

    if (conversations[sessionId]) conversations[sessionId].lastActive = nowMs();

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

// ===============================
// Zulu Club - TOUR STATUS ALERTS
// ===============================
app.post('/tour/booked', async (req, res) => {
  try {
    const { customerPhone, customerName } = req.body;
    const msg =
      `🎉 *New Try-At-Home Booking*\n` +
      `Customer: ${customerName || "Unknown"}\n` +
      `Phone: ${customerPhone || "Not Provided"}\n` +
      `📌 Please contact customer.`;

    for (const admin of EMPLOYEE_NUMBERS) {
      await sendMessage(admin, "Admin", msg);
    }

    return res.json({
      success: true,
      message: "Tour booked alerts sent to EMPLOYEE_NUMBERS"
    });
  } catch (error) {
    console.error("❌ Tour Booked Admin Alert - Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Alert failed"
    });
  }
});

app.post('/tour/notbooked', async (req, res) => {
  try {
    const { customerPhone, customerName } = req.body;
    const msg =
      `⚠️ *Try-At-Home Booking Failed*\n` +
      `Customer: ${customerName || "Unknown"}\n` +
      `Phone: +${customerPhone || "Not Provided"}\n` +
      `📌 Please follow up.`;

    for (const admin of EMPLOYEE_NUMBERS) {
      await sendMessage(admin, "Admin", msg);
    }

    return res.json({
      success: true,
      message: "Tour not-booked alerts sent to EMPLOYEE_NUMBERS"
    });
  } catch (error) {
    console.error("❌ Tour NotBooked Admin Alert - Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Alert failed"
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Server is running on Vercel',
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '7.0 - Batch GPT for products (categories + sellers) + session history & sheets logging',
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

// Export for Vercel
module.exports = app;

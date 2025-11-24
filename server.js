// server.js
// Single-file GPT-first assistant (CSV loaded locally, decision-making via GPT)
// Requirements: express, axios, csv-parser, openai, googleapis

const express = require('express');
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------
   CONFIG
--------------------------*/
const VOICE_AI_FORM_LINK = 'https://forms.gle/CiPAk6RqWxkd8uSKA';

const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID || '',
  apiKey: process.env.GALLABOX_API_KEY || '',
  apiSecret: process.env.GALLABOX_API_SECRET || '',
  channelId: process.env.GALLABOX_CHANNEL_ID || '',
  baseUrl: 'https://server.gallabox.com/devapi'
};

const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Sheet2';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const GALLERIES_CSV_URL = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv';
const SELLERS_CSV_URL = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv';

// Limit how many CSV rows to include in GPT prompt (safeguard tokens)
const MAX_GPT_GALLERIES = 200; // adjust if needed
const MAX_GPT_SELLERS = 200;

/* -------------------------
   In-memory persistence
--------------------------*/
let galleriesData = [];
let sellersData = [];
let conversations = {}; // sessionId -> { history: [{role,content,ts}], lastActive, lastDetectedIntent, lastDetectedIntentTs }

/* -------------------------
   Google Sheets helper
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
    console.error('❌ Error initializing Google Sheets client:', e.message || e);
    return null;
  }
}

// write a value to a single cell
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
    console.error('❌ writeCell error', e.message || e);
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
    console.error('❌ appendUnderColumn error', e.message || e);
  }
}

/* -------------------------
   CSV loaders
--------------------------*/
async function fetchCSV(url) {
  try {
    const resp = await axios.get(url, { timeout: 60000 });
    return resp.data || '';
  } catch (e) {
    console.error('❌ Error fetching CSV', url, e.message || e);
    return '';
  }
}
async function parseCSVString(csvStr) {
  return new Promise((resolve, reject) => {
    const results = [];
    if (!csvStr || csvStr.trim().length === 0) {
      resolve([]);
      return;
    }
    const stream = Readable.from(csvStr);
    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV...');
    const csvStr = await fetchCSV(GALLERIES_CSV_URL);
    const parsed = await parseCSVString(csvStr);
    const mapped = parsed.map(row => ({
      type2: row.type2 || row.Type2 || row.TYPE2 || '',
      cat_id: row.cat_id || row.CAT_ID || row.catId || '',
      cat1: row.cat1 || row.Cat1 || row.CAT1 || ''
    })).filter(r => r.type2 && (r.cat1 || r.cat_id));
    galleriesData = mapped;
    console.log(`✅ galleries loaded: ${galleriesData.length}`);
    return galleriesData;
  } catch (e) {
    console.error('❌ loadGalleriesData failed', e.message || e);
    galleriesData = [];
    return [];
  }
}

async function loadSellersData() {
  try {
    console.log('📥 Loading sellers CSV...');
    const csvStr = await fetchCSV(SELLERS_CSV_URL);
    const parsed = await parseCSVString(csvStr);
    const mapped = parsed.map(row => {
      const category_ids = row.category_ids || row.CATEGORY_IDS || row.categories || row.Categories || '';
      return {
        seller_id: row.seller_id || row.SELLER_ID || row.id || row.ID || '',
        user_id: row.user_id || row.USER_ID || row.userId || '',
        store_name: row.store_name || row.StoreName || row.store || row.Store || '',
        category_ids,
        category_ids_array: (category_ids || '').split(',').map(s => (s || '').trim().toLowerCase()).filter(Boolean),
        raw: row
      };
    }).filter(r => r.seller_id || r.store_name);
    sellersData = mapped;
    console.log(`✅ sellers loaded: ${sellersData.length}`);
    return sellersData;
  } catch (e) {
    console.error('❌ loadSellersData failed', e.message || e);
    sellersData = [];
    return [];
  }
}

// initial load
(async () => {
  await loadGalleriesData();
  await loadSellersData();
})();

/* -------------------------
   Gallabox sendMessage
--------------------------*/
async function sendMessage(to, name, message) {
  try {
    if (!gallaboxConfig.apiKey || !gallaboxConfig.apiSecret || !gallaboxConfig.channelId) {
      console.warn('⚠️ Gallabox not configured. Skipping sendMessage.');
      return { warning: 'Gallabox not configured' };
    }
    const payload = {
      channelId: gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: { name: name || 'Customer', phone: to },
      whatsapp: { type: "text", text: { body: message } }
    };
    const resp = await axios.post(`${gallaboxConfig.baseUrl}/messages/whatsapp`, payload, {
      headers: {
        'apiKey': gallaboxConfig.apiKey,
        'apiSecret': gallaboxConfig.apiSecret,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return resp.data;
  } catch (e) {
    console.error('❌ Error sending message via Gallabox:', e.response?.data || e.message || e);
    throw e;
  }
}

/* -------------------------
   Session helpers
--------------------------*/
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_CLEANUP_MS = 1000 * 60 * 5;
function nowMs() { return Date.now(); }
function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = { history: [], lastActive: nowMs(), lastDetectedIntent: null, lastDetectedIntentTs: 0 };
  } else {
    conversations[sessionId].lastActive = nowMs();
  }
  return conversations[sessionId];
}
function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  conversations[sessionId].history.push({ role, content, ts: nowMs() });
  // cap at 100 messages
  if (conversations[sessionId].history.length > 100) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-100);
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
   GPT orchestration
   - classifyAndMatchWithGPT: single structured call that:
     - classifies intent
     - when 'product' returns top categories (type2) and top sellers (seller_id or user_id + score + reason)
     - returns assistant_text (final reply)
--------------------------*/

function trimForGPT(dataArray, maxItems, fields) {
  const arr = (Array.isArray(dataArray) ? dataArray : []).slice(0, maxItems);
  return arr.map(item => {
    const out = {};
    for (const f of fields) {
      out[f] = item[f] || '';
    }
    return out;
  });
}

async function classifyAndMatchWithGPT(userMessage, sessionId) {
  // If OpenAI not configured, return fallback
  if (!OPENAI_API_KEY) {
    return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [], sellers: [], assistant_text: `Hello — zulu.club is live. Visit zulu.club for details.` };
  }

  // Prepare small-but-useful CSV slices for GPT context
  const galleriesSlice = trimForGPT(galleriesData, MAX_GPT_GALLERIES, ['type2','cat1','cat_id']);
  const sellersSlice = trimForGPT(sellersData, MAX_GPT_SELLERS, ['seller_id','user_id','store_name','category_ids_array']);

  // Build system + user prompt
  const systemPrompt = `
You are "Zulu Club Assistant Brain" — a concise JSON-only classifier and matcher for the Zulu Club WhatsApp assistant.
You will receive:
- USER_MESSAGE: the user text they sent
- RECENT_HISTORY: the last few messages from the user/assistant in this session (if any)
- AVAILABLE_GALLERIES: a JSON array of product categories (fields: type2, cat1, cat_id)
- AVAILABLE_SELLERS: a JSON array of sellers (fields: seller_id, user_id, store_name, category_ids_array)

Task (single-shot):
1) Decide intent -> one of: "company","product","seller","investors","agent","voice_ai".
2) If intent == "product":
   - return up to 5 matching categories (type2) from AVAILABLE_GALLERIES with a reason and score (0.0-1.0).
   - return up to 7 candidate sellers from AVAILABLE_SELLERS. For each seller, return:
       { seller_id, user_id, store_name, score (0.0-1.0), reason }
     Score indicates how likely this seller sells the requested items.
   - infer gender if apparent: "men"|"women"|"kids"|null
   - determine if it's home-decor related: true/false and confidence score.
3) Generate a concise WhatsApp assistant reply (assistant_text) that:
   - is helpful, < 200 characters ideally, includes 100-min delivery and try-at-home mention when relevant,
   - when intent == 'product' it should include short gallery links like "app.zulu.club/<url-encoded-type2>" for top categories and 2 top sellers with their app links
   - when intent == 'voice_ai' include the VOICE_AI_FORM_LINK and short instructions
   - when intent == 'agent' generate a ticket suggestion text (do NOT create ticket here - just text)
   - avoid any extraneous text beyond the assistant_text field
4) ALWAYS RETURN VALID JSON ONLY in the exact format described below.

Important:
- Use only data present in AVAILABLE_GALLERIES and AVAILABLE_SELLERS to pick names / type2 values.
- Keep 'assistant_text' short, friendly, and WhatsApp-friendly (emojis allowed).
- Return numeric scores as decimal numbers between 0 and 1.
`;

  const userPayload = {
    USER_MESSAGE: userMessage,
    RECENT_HISTORY: getFullSessionHistory(sessionId).slice(-10),
    AVAILABLE_GALLERIES: galleriesSlice,
    AVAILABLE_SELLERS: sellersSlice,
    VOICE_AI_FORM_LINK
  };

  const userPrompt = `
USER_PAYLOAD:
${JSON.stringify(userPayload, null, 2)}

RESPONSE FORMAT (JSON ONLY):
{
  "intent": "product",
  "confidence": 0.0,
  "reason": "brief explanation for intent",
  "matches": [
    { "type2": "value-from-AVAILABLE_GALLERIES", "reason": "why match", "score": 0.85 }
  ],
  "sellers": [
    { "seller_id": "123", "user_id": "456", "store_name": "Name", "score": 0.76, "reason": "why we scored it" }
  ],
  "detected_gender": "men"|"women"|"kids"|null,
  "is_home": true|false,
  "home_score": 0.0,
  "assistant_text": "The message the assistant should send back (short)"
}
`;

  try {
    // call OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // use gpt-4o-mini or best available; adapt model string if you prefer
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 900,
      temperature: 0.0
    });

    const raw = completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content
      ? completion.choices[0].message.content.trim()
      : '';

    // attempt parse
    try {
      const parsed = JSON.parse(raw);
      // sanitize numeric fields
      parsed.confidence = Number(parsed.confidence) || 0;
      if (Array.isArray(parsed.matches)) parsed.matches = parsed.matches.map(m => ({ type2: m.type2, reason: m.reason || '', score: Number(m.score) || 0 }));
      if (Array.isArray(parsed.sellers)) parsed.sellers = parsed.sellers.map(s => ({
        seller_id: s.seller_id || '',
        user_id: s.user_id || '',
        store_name: s.store_name || '',
        score: Number(s.score) || 0,
        reason: s.reason || ''
      }));
      parsed.home_score = Number(parsed.home_score) || 0;
      parsed.is_home = !!parsed.is_home;
      parsed.detected_gender = parsed.detected_gender || null;
      parsed.assistant_text = (parsed.assistant_text || '').trim();
      return parsed;
    } catch (e) {
      console.error('❌ Error parsing GPT JSON:', e.message || e, 'raw->', raw.slice(0, 600));
      // fallback minimal structure
      return { intent: 'company', confidence: 0.0, reason: 'gpt parse error', matches: [], sellers: [], detected_gender: null, is_home: false, home_score: 0, assistant_text: `Hello — visit zulu.club for more info.` };
    }
  } catch (err) {
    console.error('❌ GPT call failed:', err.message || err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt call failed', matches: [], sellers: [], detected_gender: null, is_home: false, home_score: 0, assistant_text: `Hello — zulu.club is live. Visit zulu.club for details.` };
  }
}

/* -------------------------
   Agent ticket helpers (simple)
--------------------------*/
function generateTicketId() {
  const now = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${now}-${rand}`;
}
async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheets();
  const ticketId = generateTicketId();
  if (!sheets) {
    console.warn('Google Sheets not configured — returning generated ticket id only');
    return ticketId;
  }
  try {
    const sheetName = AGENT_TICKETS_SHEET;
    // ensure header row
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!1:1` }).catch(() => null);
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

    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(m => m.role === 'user').map(m => m.content || '');
    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];

    const row = [
      mobileNumber || '',
      arranged[0] || '',
      arranged[1] || '',
      arranged[2] || '',
      arranged[3] || '',
      arranged[4] || '',
      ticketId,
      new Date().toISOString()
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
    console.error('createAgentTicket error', e.message || e);
    return ticketId;
  }
}

/* -------------------------
   Main message handling
--------------------------*/
async function handleMessage(sessionId, userMessage, userPhone = '') {
  try {
    appendToSessionHistory(sessionId, 'user', userMessage);

    // attempt to log user message to sheets column sessionId
    try { await appendUnderColumn(sessionId, `USER: ${userMessage}`); } catch (e) { /* ignore */ }

    // Run GPT classifier + matcher
    const gptResult = await classifyAndMatchWithGPT(userMessage, sessionId);

    // special handling: agent
    if (gptResult.intent === 'agent') {
      // create ticket and store it in sheets
      const fullHistory = getFullSessionHistory(sessionId);
      let ticketId = '';
      try { ticketId = await createAgentTicket(sessionId, fullHistory); } catch (e) { ticketId = generateTicketId(); }
      try { await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`); } catch (e) { /* ignore */ }
      const reply = `Our representative will connect with you soon. Your ticket id: ${ticketId}`;
      appendToSessionHistory(sessionId, 'assistant', reply);
      try { await appendUnderColumn(sessionId, `ASSISTANT: ${reply}`); } catch (e) {}
      return reply;
    }

    // special handling: voice_ai
    if (gptResult.intent === 'voice_ai') {
      const reply = gptResult.assistant_text || (`🎵 Custom AI Music: Fill form ${VOICE_AI_FORM_LINK}`);
      appendToSessionHistory(sessionId, 'assistant', reply);
      try { await appendUnderColumn(sessionId, `ASSISTANT: ${reply}`); } catch (e) {}
      return reply;
    }

    // product: we might want to append some structured debug to sheets
    if (gptResult.intent === 'product') {
      // log matched categories and top sellers
      try {
        const catLog = (gptResult.matches || []).map(m => `${m.type2}(${m.score})`).join(' | ');
        const sellerLog = (gptResult.sellers || []).slice(0,5).map(s => `${s.store_name || s.seller_id}(${s.score})`).join(' | ');
        await appendUnderColumn(sessionId, `MATCHES: ${catLog}`);
        await appendUnderColumn(sessionId, `SELLERS: ${sellerLog}`);
      } catch (e) { /* ignore */ }
    }

    // assistant_text from GPT (recommended to use) - fallback to simple builder if empty
    let assistantReply = gptResult.assistant_text || '';
    if (!assistantReply) {
      // build concise fallback
      if (gptResult.intent === 'product') {
        const topCats = (gptResult.matches || []).slice(0,3).map(m => m.type2).filter(Boolean);
        const topSellers = (gptResult.sellers || []).slice(0,2).map(s => s.store_name || s.seller_id);
        let msg = `Based on "${userMessage}":\n`;
        if (topCats.length) {
          msg += `Categories: ${topCats.slice(0,3).join(', ')}\n`;
        }
        if (topSellers.length) msg += `Top sellers: ${topSellers.join(', ')}`;
        assistantReply = msg;
      } else if (gptResult.intent === 'seller') {
        assistantReply = `Want to sell on Zulu Club? Sign up: https://app.zulu.club/brand\nFill seller form: https://forms.gle/tvkaKncQMs29dPrPA`;
      } else if (gptResult.intent === 'investors') {
        assistantReply = `Thanks for your interest — share your pitch deck: https://forms.gle/5wwfYFB7gGs75pYq5`;
      } else {
        assistantReply = `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.`;
      }
    }

    // save assistant reply to session & sheets
    appendToSessionHistory(sessionId, 'assistant', assistantReply);
    try { await appendUnderColumn(sessionId, `ASSISTANT: ${assistantReply}`); } catch (e) {}

    return assistantReply;
  } catch (e) {
    console.error('❌ handleMessage error', e.message || e);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

/* -------------------------
   Webhook & routes
--------------------------*/
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body && req.body.whatsapp ? { meta: 'whatsapp' } : {}, null, 2));
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage, userPhone);
      // attempt to send back
      try {
        await sendMessage(userPhone, userName, aiResponse);
        console.log(`✅ AI response sent to ${userPhone}`);
      } catch (err) {
        console.error('Failed to send via Gallabox:', err.message || err);
      }
    } else {
      console.log('❓ Invalid webhook payload (missing message or phone)');
    }
    res.status(200).json({ status: 'success', processed: true });
  } catch (err) {
    console.error('💥 Webhook error:', err.message || err);
    res.status(500).json({ status: 'error', message: err.message || 'internal error' });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Server running',
    service: 'Zulu Club GPT-first Assistant (single-file)',
    version: '1.0',
    stats: {
      categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_conversations: Object.keys(conversations).length
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/refresh-csv', async (req, res) => {
  try {
    const g = await loadGalleriesData();
    const s = await loadSellersData();
    res.json({ status: 'success', categories_loaded: g.length, sellers_loaded: s.length });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message || e });
  }
});

app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session found' });
  res.json({ sessionId: id, lastActive: s.lastActive, historyLen: s.history.length, history: s.history });
});

app.get('/test-gpt-match', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const dummySession = 'TESTSESSION';
    createOrTouchSession(dummySession);
    appendToSessionHistory(dummySession, 'user', query);
    const result = await classifyAndMatchWithGPT(query, dummySession);
    res.json({ query, result, categories_loaded: galleriesData.length, sellers_loaded: sellersData.length });
  } catch (e) {
    res.status(500).json({ error: e.message || e });
  }
});

/* -------------------------
   Start server
--------------------------*/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

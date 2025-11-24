// server.js - GPT-first intent + category matcher (AI is the boss)
// Gender detection now uses category data (cat_id / cat1) as the source of truth.
// Added Voice AI Form Intent - COMPLETELY ISOLATED WHEN ACTIVE

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
    const headersResp = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: '1:1' });
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

// INVESTORS paragraph placeholder (edit as required)
const INVESTORS_PARAGRAPH = `
Thanks for your interest in investing in Zulu Club. Please share your pitch deck or contact investor-relations@zulu.club and our team will get back to you. (Edit this paragraph to include your funding history, pitch-deck link, and IR contact.)
`;

// VOICE AI FORM QUESTIONS
const VOICE_AI_FORM_QUESTIONS = [
  { field: 'name', question: 'Great! Let me get some details for your voice AI request. What\'s your name?' },
  { field: 'email', question: 'Thanks! What\'s your email address?' },
  { field: 'genre', question: 'What genre are you looking for? (e.g., comedy, romance, action, etc.)' },
  { field: 'dialogue', question: 'Please share the dialogue you\'d like us to recreate:' },
  { field: 'friend_name', question: 'What\'s your friend\'s name?' },
  { field: 'product_you_gift', question: 'What product are you planning to gift?' },
  { field: 'time_to_deliver_output', question: 'When would you like the output delivered? (e.g., 2 hours, 1 day)' },
  { field: 'optional_comment', question: 'Any additional comments? (optional)' }
];

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
   Voice AI Form Helpers - COMPLETELY ISOLATED
--------------------------*/
function generateFormId() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

async function writeVoiceAIFormToSheet(formData) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot save voice AI form');
    return false;
  }

  try {
    const sheetName = 'Sheet3';
    
    // Check if header exists, if not create it
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!1:1`
    }).catch(() => null);

    const existingHeaders = (headerResp && headerResp.data && headerResp.data.values && headerResp.data.values[0]) || [];
    const requiredHeaders = ['id', 'phn_no', 'name', 'email', 'genre', 'dialogue', 'friend_name', 'product_you_gift', 'time_to_deliver_output', 'optional_comment'];
    
    if (existingHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [requiredHeaders] }
      });
    }

    // Prepare the row data
    const row = [
      formData.id,
      formData.phn_no,
      formData.name,
      formData.email,
      formData.genre,
      formData.dialogue,
      formData.friend_name,
      formData.product_you_gift,
      formData.time_to_deliver_output,
      formData.optional_comment
    ];

    // Append the row
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    console.log(`✅ Voice AI form data written to ${sheetName} with ID: ${formData.id}`);
    return true;
  } catch (e) {
    console.error('❌ Error writing voice AI form to sheet:', e);
    return false;
  }
}

function isVoiceAIQuery(userMessage) {
  if (!userMessage) return false;
  const message = userMessage.toLowerCase();
  const voiceAITriggers = [
    'voice ai', 'voiceai', 'voice over', 'voiceover', 'custom voice', 
    'voice clone', 'ai voice', 'voice generation', 'voice recording',
    'voice message', 'voice gift', 'voice present', 'voice note',
    'voice service', 'voice technology'
  ];
  return voiceAITriggers.some(trigger => message.includes(trigger));
}

async function handleVoiceAIForm(sessionId, userMessage) {
  const session = conversations[sessionId];
  if (!session.voiceAIFormState) {
    return "Sorry, there was an error with the form. Please try again.";
  }

  const formState = session.voiceAIFormState;
  const currentQuestionIndex = formState.currentQuestionIndex;
  
  // Store the answer for the current question
  const currentField = VOICE_AI_FORM_QUESTIONS[currentQuestionIndex].field;
  formState.answers[currentField] = userMessage;

  // Move to next question or complete form
  if (currentQuestionIndex < VOICE_AI_FORM_QUESTIONS.length - 1) {
    formState.currentQuestionIndex++;
    const nextQuestion = VOICE_AI_FORM_QUESTIONS[formState.currentQuestionIndex].question;
    
    // Save user message and assistant response to history
    appendToSessionHistory(sessionId, 'user', userMessage);
    appendToSessionHistory(sessionId, 'assistant', nextQuestion);
    
    return nextQuestion;
  } else {
    // Form completed - save to sheet
    const formData = {
      id: formState.formId,
      ...formState.answers
    };

    const success = await writeVoiceAIFormToSheet(formData);
    
    // Reset form state
    session.voiceAIFormState = {
      active: false,
      currentQuestionIndex: 0,
      answers: {},
      formId: null
    };

    // Save final messages to history
    appendToSessionHistory(sessionId, 'user', userMessage);
    const completionMessage = success 
      ? `✅ Thank you! Your voice AI request has been submitted with ID: ${formData.id}. Our team will contact you shortly.`
      : `⚠️ Thank you for your details! There was an issue saving your request (ID: ${formData.id}). Please contact support.`;
    
    appendToSessionHistory(sessionId, 'assistant', completionMessage);
    
    return completionMessage;
  }
}

/* -------------------------
   Session/history helpers
--------------------------*/
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_CLEANUP_MS = 1000 * 60 * 5; // cleanup every 5 minutes
const MAX_HISTORY_MESSAGES = 2000;

// helper for timestamps
function nowMs() { return Date.now(); }

// create/touch session; initialize lastDetectedIntent fields
function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      history: [],              // full chat history: { role, content, ts }
      lastActive: nowMs(),
      lastDetectedIntent: null,
      lastDetectedIntentTs: 0,
      voiceAIFormState: {  // VOICE AI FORM STATE - ISOLATED
        active: false,
        currentQuestionIndex: 0,
        answers: {},
        formId: null
      }
    };
  } else {
    conversations[sessionId].lastActive = nowMs();
  }
  return conversations[sessionId];
}

// append message to session history and keep it (no cleanup under 1 hour)
function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  const entry = { role, content, ts: nowMs() };
  conversations[sessionId].history.push(entry);
  // cap history length - keep enough messages for 1 hour
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  conversations[sessionId].lastActive = nowMs();
}

// return full session history (copy)
function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s || !s.history) return [];
  return s.history.slice();
}

// purge expired sessions older than TTL
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
   UPDATED MAIN MESSAGE HANDLER - VOICE AI TAKES COMPLETE PRIORITY
--------------------------*/
async function handleMessage(sessionId, userMessage) {
  try {
    // 1) Ensure session exists
    const session = createOrTouchSession(sessionId);
    
    console.log(`🔍 Checking voice AI form state for session ${sessionId}:`, {
      active: session.voiceAIFormState?.active,
      currentQuestion: session.voiceAIFormState?.currentQuestionIndex
    });

    // 2) CRITICAL: Check if voice AI form is active - THIS TAKES ABSOLUTE PRIORITY
    if (session.voiceAIFormState && session.voiceAIFormState.active) {
      console.log(`🎯 VOICE AI FORM ACTIVE - Processing form question ${session.voiceAIFormState.currentQuestionIndex}`);
      const voiceAIResponse = await handleVoiceAIForm(sessionId, userMessage);
      
      // Log to sheets
      try {
        await appendUnderColumn(sessionId, `VOICE_AI_FORM: ${userMessage} -> ${voiceAIResponse}`);
      } catch (e) {
        console.error('sheet log voice AI failed', e);
      }
      
      return voiceAIResponse;
    }

    // 3) Check if this is a new voice AI query - START FORM IMMEDIATELY
    if (isVoiceAIQuery(userMessage)) {
      console.log(`🎯 NEW VOICE AI QUERY DETECTED - Starting form for session ${sessionId}`);
      
      // Initialize form state
      session.voiceAIFormState = {
        active: true,
        currentQuestionIndex: 0,
        answers: {
          phn_no: sessionId // store phone number as sessionId
        },
        formId: generateFormId()
      };
      
      const firstQuestion = VOICE_AI_FORM_QUESTIONS[0].question;
      
      // Save to history and logs
      appendToSessionHistory(sessionId, 'user', userMessage);
      appendToSessionHistory(sessionId, 'assistant', firstQuestion);
      
      try {
        await appendUnderColumn(sessionId, `VOICE_AI_STARTED: ${userMessage} -> ${firstQuestion}`);
      } catch (e) {
        console.error('sheet log voice AI start failed', e);
      }
      
      return firstQuestion;
    }

    // 4) ONLY if not voice AI related, proceed with normal processing
    console.log(`📝 Normal processing for non-voice AI message: ${userMessage}`);
    
    // Save incoming user message to session
    appendToSessionHistory(sessionId, 'user', userMessage);

    // Log user message to Google Sheet
    try {
      await appendUnderColumn(sessionId, `USER: ${userMessage}`);
    } catch (e) {
      console.error('sheet log user failed', e);
    }

    // Get response using normal processing
    const aiResponse = await getChatGPTResponse(sessionId, userMessage);

    // Save AI response back into session history
    appendToSessionHistory(sessionId, 'assistant', aiResponse);

    // Log assistant response to Google Sheet
    try {
      await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`);
    } catch (e) {
      console.error('sheet log assistant failed', e);
    }

    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `Sorry, I encountered an error. Please try again.`;
  }
}

/* -------------------------
   SIMPLIFIED getChatGPTResponse - NO VOICE AI LOGIC HERE
--------------------------*/
async function getChatGPTResponse(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    const session = conversations[sessionId];

    // Seller onboarding detection
    if (isSellerOnboardQuery(userMessage)) {
      session.lastDetectedIntent = 'seller';
      session.lastDetectedIntentTs = nowMs();
      return sellerOnboardMessage();
    }

    // Use simple keyword detection for other intents
    const message = userMessage.toLowerCase();
    
    if (message.includes('invest') || message.includes('funding') || message.includes('pitch') || message.includes('investor')) {
      session.lastDetectedIntent = 'investors';
      return INVESTORS_PARAGRAPH.trim();
    }

    if (message.includes('agent') || message.includes('human') || message.includes('representative') || message.includes('talk to person')) {
      session.lastDetectedIntent = 'agent';
      // Simple agent response without ticket creation for now
      return "I'll connect you with a human representative. Please wait while we transfer your conversation.";
    }

    // Default to company info
    session.lastDetectedIntent = 'company';
    return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), companyInfo);

  } catch (error) {
    console.error('❌ getChatGPTResponse error:', error);
    return `Hello! I'm here to help with Zulu Club. You can ask me about our products, sellers, or company information.`;
  }
}

/* -------------------------
   Helper functions
--------------------------*/
function isSellerOnboardQuery(userMessage) {
  if (!userMessage) return false;
  const m = userMessage.toLowerCase();
  const triggers = [
    'sell on', 'sell with', 'become a seller', 'become seller', 'be a seller', 'how to join', 'how to onboard',
    'onboard', 'onboarding', 'register as seller', 'register as a seller', 'join as seller', 'become a merchant',
    'how to sell', 'partner with', 'partner with zulu', 'seller signup', 'seller sign up', 'how to become a seller'
  ];
  return triggers.some(t => m.includes(t));
}

function sellerOnboardMessage() {
  const link = 'https://app.zulu.club/brand';
  return `Want to sell on Zulu Club? Sign up here: ${link}\n\nQuick steps:\n• Fill the seller form at the link\n• Our team will review & reach out\n• Start listing products & reach Gurgaon customers`;
}

function isGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'greetings', 'namaste', 'namaskar', 'hola', 'hey there'];
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
      // send back over Gallabox
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
    version: 'VOICE AI PRIORITY - Form takes complete control when active',
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

// Export for Vercel
module.exports = app;

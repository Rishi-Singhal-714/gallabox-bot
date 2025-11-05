const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gallabox API configuration
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

// Cache for CSV data (load once, use everywhere)
let csvCache = {
  categoriesData: [],
  galleriesData: [],
  lastUpdated: null,
  isLoaded: false
};

// Session storage
let sessions = {};

// Session configuration - UPDATED
const SESSION_CONFIG = {
  ACTIVE_TIMEOUT: 60 * 60 * 1000, // 1 hour for active sessions
  INACTIVE_TIMEOUT: 3 * 60 * 1000, // 3 minutes for inactive sessions
  WARNING_TIME: 2 * 60 * 1000, // Warn at 2 minutes of inactivity
  CLEANUP_INTERVAL: 60 * 1000 // Cleanup every 1 minute (reduced frequency)
};

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love:

And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.

Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on zulu.club
`;

// Greeting detection
const GREETINGS = [
  'hi', 'hello', 'hey', 'hola', 'namaste', 'good morning', 'good afternoon', 
  'good evening', 'hi there', 'hello there', 'hey there', 'whats up', 'sup'
];

// Initialize CSV data once and cache it
async function initializeCSVData() {
  try {
    console.log('🔄 Initializing CSV data cache...');
    
    const categoriesUrl = process.env.CATEGORIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
    const galleriesUrl = process.env.GALLERIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';
    
    // Load categories1.csv
    const categoriesResults = await loadCSVFromGitHub(categoriesUrl, 'categories1.csv');
    
    // Load galleries1.csv
    const galleriesResults = await loadCSVFromGitHub(galleriesUrl, 'galleries1.csv');
    
    // Update cache
    csvCache = {
      categoriesData: categoriesResults || [],
      galleriesData: galleriesResults || [],
      lastUpdated: new Date(),
      isLoaded: true
    };
    
    console.log(`✅ CSV Cache loaded: ${csvCache.categoriesData.length} categories, ${csvCache.galleriesData.length} galleries`);
    
  } catch (error) {
    console.error('❌ Error initializing CSV cache:', error);
  }
}

// Start initialization
initializeCSVData();

// Function to load CSV data from GitHub
async function loadCSVFromGitHub(csvUrl, csvType) {
  try {
    console.log(`📥 Loading ${csvType} from: ${csvUrl}`);
    
    const response = await axios.get(csvUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'ZuluClub-Bot/1.0',
        'Accept': 'text/csv'
      }
    });
    
    const results = [];
    
    return new Promise((resolve, reject) => {
      const stream = Readable.from(response.data);
      stream
        .pipe(csv())
        .on('data', (data) => {
          if (Object.keys(data).length > 0 && Object.values(data).some(val => val && val.trim() !== '')) {
            results.push(data);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} rows from ${csvType}`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error(`❌ CSV parsing error for ${csvType}:`, error);
          reject(error);
        });
    });
  } catch (error) {
    console.error(`❌ Error loading ${csvType} from GitHub:`, error.message);
    return [];
  }
}

// Session Management Functions
function createSession(sessionId) {
  const now = Date.now();
  sessions[sessionId] = {
    id: sessionId,
    history: [],
    lastActivity: now,
    createdAt: now,
    warningSent: false,
    messageCount: 0,
    data: {
      categoryNames: [],
      lastSearch: null
    }
  };
  console.log(`🆕 Created new session: ${sessionId}`);
  return sessions[sessionId];
}

function getSession(sessionId) {
  const session = sessions[sessionId];
  if (session) {
    session.lastActivity = Date.now();
    session.messageCount++;
  }
  return session;
}

function updateSession(sessionId, updates = {}) {
  const session = getSession(sessionId);
  if (session) {
    Object.assign(session, updates);
    session.lastActivity = Date.now();
  }
  return session;
}

function deleteSession(sessionId) {
  if (sessions[sessionId]) {
    console.log(`🗑️ Deleting session: ${sessionId}`);
    delete sessions[sessionId];
    return true;
  }
  return false;
}

// NEW: Check if message is a greeting
function isGreeting(message) {
  const cleanMessage = message.toLowerCase().trim();
  return GREETINGS.some(greeting => cleanMessage.includes(greeting));
}

// NEW: Check if message is asking for products/categories
function isProductQuery(message) {
  const cleanMessage = message.toLowerCase().trim();
  const productKeywords = [
    'product', 'category', 'buy', 'shop', 'purchase', 'looking for',
    'want', 'need', 'show me', 'find', 'search', 'tshirt', 'shirt',
    'dress', 'vase', 'shoe', 'footwear', 'decor', 'home', 'fashion',
    'beauty', 'accessory', 'gift', 'kids', 'men', 'women'
  ];
  
  return productKeywords.some(keyword => cleanMessage.includes(keyword));
}

// Session cleanup job - UPDATED with new logic
function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    let warnedCount = 0;

    Object.entries(sessions).forEach(([sessionId, session]) => {
      const inactiveTime = now - session.lastActivity;
      const sessionAge = now - session.createdAt;
      
      // Check for inactive timeout (3 minutes of no response)
      if (!session.warningSent && inactiveTime >= SESSION_CONFIG.WARNING_TIME) {
        console.log(`⏰ Sending timeout warning for inactive session: ${sessionId}`);
        session.warningSent = true;
        warnedCount++;
        
        // Send warning message to user
        sendTimeoutWarning(sessionId, session);
      }
      
      // Delete session if inactive for 3 minutes OR session age exceeds 1 hour
      if (inactiveTime >= SESSION_CONFIG.INACTIVE_TIMEOUT || sessionAge >= SESSION_CONFIG.ACTIVE_TIMEOUT) {
        const reason = inactiveTime >= SESSION_CONFIG.INACTIVE_TIMEOUT ? 'inactivity' : 'max duration';
        deleteSession(sessionId);
        cleanedCount++;
        
        // Send thanks message for expired sessions
        sendSessionExpiredMessage(sessionId, session, reason);
        console.log(`👋 Session ${sessionId} expired due to ${reason}`);
      }
    });
    
    if (cleanedCount > 0 || warnedCount > 0) {
      console.log(`🧹 Session cleanup: ${warnedCount} warned, ${cleanedCount} deleted. Active sessions: ${Object.keys(sessions).length}`);
    }
  }, SESSION_CONFIG.CLEANUP_INTERVAL);
}

// Start session cleanup
startSessionCleanup();

// Send timeout warning message
async function sendTimeoutWarning(sessionId, session) {
  try {
    const warningMessage = `⏰ Hey! You've been inactive for 2 minutes. This session will expire in 1 minute if there's no response.\n\nJust send a message to keep shopping with me! 🛍️`;
    
    await sendMessage(sessionId, 'User', warningMessage);
    console.log(`⚠️ Timeout warning sent to ${sessionId}`);
    
  } catch (error) {
    console.error('❌ Error sending timeout warning:', error);
  }
}

// Send session expired message
async function sendSessionExpiredMessage(sessionId, session, reason) {
  try {
    let message = `👋 Thank you for chatting with Zulu Club! `;
    
    if (reason === 'inactivity') {
      message += `Your session has expired due to inactivity.\n\n`;
    } else {
      message += `Your session has reached the maximum duration.\n\n`;
    }
    
    message += `🚀 Remember - *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
    message += `Feel free to start a new conversation anytime to continue shopping! 🛍️`;
    
    await sendMessage(sessionId, 'User', message);
    console.log(`✅ Session expired message sent to ${sessionId}`);
    
  } catch (error) {
    console.error('❌ Error sending session expired message:', error);
  }
}

// Get category names from cached CSV data
function getCategoryNames() {
  if (!csvCache.isLoaded || csvCache.categoriesData.length === 0) {
    return [];
  }
  
  const categoryNames = [];
  csvCache.categoriesData.forEach((row) => {
    const name = row.name || row.Name;
    if (name && name.trim()) {
      categoryNames.push(name.trim());
    }
  });
  
  return categoryNames;
}

// Get category ID by name from cached CSV data
function getCategoryIdByName(categoryName) {
  if (!csvCache.isLoaded || !categoryName) {
    return null;
  }
  
  for (const row of csvCache.categoriesData) {
    const name = row.name || row.Name;
    if (name && name.trim() === categoryName) {
      const id = row.id || row.ID;
      if (id) {
        return id.toString();
      }
    }
  }
  
  return null;
}

// Parse cat1 column data
function parseCat1Data(cat1Value) {
  if (!cat1Value) return [];
  
  const strValue = cat1Value.toString().trim();
  
  if (strValue.startsWith('[') && strValue.endsWith(']')) {
    try {
      const cleanStr = strValue.slice(1, -1);
      return cleanStr.split(',').map(item => item.trim().replace(/"/g, ''));
    } catch (error) {
      return [];
    }
  }
  
  if (strValue.includes(',')) {
    return strValue.split(',').map(item => item.trim());
  }
  
  return [strValue];
}

// Get type2 data from cached galleries data
function getType2DataByCat1(categoryId) {
  if (!csvCache.isLoaded || !categoryId) {
    return [];
  }
  
  const type2Data = [];
  csvCache.galleriesData.forEach((row) => {
    const cat1Value = row.cat1;
    
    if (cat1Value) {
      const cat1Ids = parseCat1Data(cat1Value);
      if (cat1Ids.includes(categoryId.toString())) {
        const type2 = row.type2;
        if (type2 && type2.trim()) {
          type2Data.push(type2.trim());
        }
      }
    }
  });
  
  return type2Data;
}

// Generate links from type2 data
function generateLinksFromType2(type2Data) {
  return type2Data.map(name => {
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// Smart product search with fallback
async function smartProductSearch(userMessage, categoryNames, session) {
  const primaryCategory = await getAICategoryMatch(userMessage, categoryNames);
  if (!primaryCategory) {
    return { success: false, links: [], triedCategories: [] };
  }
  
  const triedCategories = [primaryCategory];
  const primaryCategoryId = getCategoryIdByName(primaryCategory);
  
  if (primaryCategoryId) {
    const primaryType2Data = getType2DataByCat1(primaryCategoryId);
    if (primaryType2Data.length > 0) {
      const links = generateLinksFromType2(primaryType2Data);
      return { success: true, links: links, triedCategories: triedCategories, source: 'primary' };
    }
  }
  
  return { success: false, links: [], triedCategories: triedCategories };
}

// ChatGPT function to find matching category
async function getAICategoryMatch(userMessage, categoryNames) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a customer service assistant for Zulu Club.

${ZULU_CLUB_INFO}

YOUR TASK:
1. Analyze the user's product query
2. Match it to the most relevant category from the available categories below
3. Return ONLY the exact category name from the available list

AVAILABLE CATEGORIES:
${categoryNames.map(name => `- ${name}`).join('\n')}

IMPORTANT:
- Return ONLY the category name, nothing else
- Choose the best matching category
- If no good match, return "no_match"`
    }, {
      role: "user", 
      content: userMessage
    }];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 50,
      temperature: 0.3
    });
    
    const response = completion.choices[0].message.content.trim();
    
    if (response === "no_match") {
      return null;
    }
    
    return categoryNames.find(cat => cat === response) || null;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return null;
  }
}

// Get helpful suggestion when no products found
function getHelpfulSuggestion(userMessage, triedCategories) {
  const message = userMessage.toLowerCase();
  
  let suggestion = `I searched for "${userMessage}" but couldn't find specific products at the moment. 😔\n\n`;
  
  if (message.includes('shoe') || message.includes('footwear')) {
    suggestion += `👟 For footwear, check our Men's Fashion or Women's Fashion categories.\n\n`;
  } else if (message.includes('tshirt') || message.includes('shirt') || message.includes('dress')) {
    suggestion += `👕 For clothing, explore our Men's Fashion and Women's Fashion categories.\n\n`;
  } else {
    suggestion += `🔍 You can explore our main categories or visit zulu.club for our complete collection.\n\n`;
  }
  
  suggestion += `🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`;
  
  return [suggestion];
}

// NEW: Improved response handler with greeting detection
async function getChatGPTResponse(userMessage, session) {
  // Check if it's a greeting
  if (isGreeting(userMessage)) {
    return `👋 Hello! Welcome to Zulu Club! 🛍️\n\nI'm here to help you discover amazing lifestyle products with *100-minute delivery* in Gurgaon!\n\nWhat would you like to explore today? You can ask me about:\n• Specific products (like "tshirts", "vases")\n• Product categories\n• Or just tell me what you're looking for!`;
  }
  
  // Check if it's a product query
  if (isProductQuery(userMessage)) {
    // Try product search first
    const productLinks = await getProductLinksWithAICategory(userMessage, session);
    
    if (productLinks.length > 0) {
      if (typeof productLinks[0] === 'string' && productLinks[0].includes('searched for')) {
        return productLinks[0]; // Helpful suggestion
      } else {
        let response = `Great choice! 🎯\n\nHere are the products you're looking for:\n\n`;
        
        productLinks.slice(0, 8).forEach(link => {
          response += `• ${link}\n`;
        });
        
        if (productLinks.length > 8) {
          response += `• ... and ${productLinks.length - 8} more options\n`;
        }
        
        response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
        response += `Click the links above to explore and shop! 🛍️`;
        
        return response;
      }
    }
  }
  
  // For general conversation, use AI
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Please visit zulu.club to explore our premium lifestyle products!";
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a friendly customer service assistant for Zulu Club. ${ZULU_CLUB_INFO} 
      
Keep responses conversational and helpful. If users ask about products, guide them to be more specific. 
Highlight: 100-minute delivery, try-at-home, easy returns. Keep responses under 300 characters.`
    }];
    
    // Add conversation history from session
    if (session && session.history.length > 0) {
      const recentHistory = session.history.slice(-6);
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
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 200,
      temperature: 0.7
    });
    
    return completion.choices[0].message.content.trim();
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! 🛍️";
  }
}

// Main product search logic
async function getProductLinksWithAICategory(userMessage, session) {
  try {
    if (!csvCache.isLoaded) {
      return ["🔄 Our product catalog is loading, please wait a moment and try again..."];
    }
    
    const categoryNames = getCategoryNames();
    if (categoryNames.length === 0) {
      return ["📦 Our product categories are currently being updated. Please try again in a moment."];
    }
    
    // Store category names in session for faster access
    if (session) {
      session.data.categoryNames = categoryNames;
    }
    
    const searchResult = await smartProductSearch(userMessage, categoryNames, session);
    
    if (searchResult.success) {
      return searchResult.links;
    } else {
      return getHelpfulSuggestion(userMessage, searchResult.triedCategories);
    }
    
  } catch (error) {
    console.error('❌ Error in product search:', error);
    return ["😔 I'm having trouble accessing our product catalog right now. Please try again in a moment or visit zulu.club directly."];
  }
}

// Function to send message via Gallabox API
async function sendMessage(to, name, message) {
  try {
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
    
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
    throw error;
  }
}

// Handle user message with session management
async function handleMessage(sessionId, userMessage) {
  try {
    // Get or create session
    let session = getSession(sessionId);
    if (!session) {
      session = createSession(sessionId);
    }
    
    // Reset warning flag if user is active again
    if (session.warningSent) {
      session.warningSent = false;
      console.log(`✅ User ${sessionId} became active again, reset warning`);
    }
    
    // Add user message to session history
    session.history.push({
      role: "user",
      content: userMessage,
      timestamp: Date.now()
    });
    
    // Get AI response
    const response = await getChatGPTResponse(userMessage, session);
    
    // Add AI response to session history
    session.history.push({
      role: "assistant",
      content: response,
      timestamp: Date.now()
    });
    
    // Keep history manageable (last 10 messages)
    if (session.history.length > 10) {
      session.history = session.history.slice(-10);
    }
    
    // Update session
    updateSession(sessionId, { lastActivity: Date.now() });
    
    return response;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our products!";
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    
    console.log(`💬 Message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage);
      await sendMessage(userPhone, userName, aiResponse);
      console.log(`✅ Response sent to ${userPhone}. Active sessions: ${Object.keys(sessions).length}`);
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed' });
    
  } catch (error) {
    console.error('💥 Webhook error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Debug endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '13.0 - Smart Greeting & Session Management',
    cache: {
      csv_loaded: csvCache.isLoaded,
      categories_count: csvCache.categoriesData.length,
      galleries_count: csvCache.galleriesData.length,
      last_updated: csvCache.lastUpdated
    },
    sessions: {
      active_sessions: Object.keys(sessions).length,
      active_timeout: `${SESSION_CONFIG.ACTIVE_TIMEOUT / 60000} minutes`,
      inactive_timeout: `${SESSION_CONFIG.INACTIVE_TIMEOUT / 60000} minutes`,
      warning_time: `${SESSION_CONFIG.WARNING_TIME / 60000} minutes`
    }
  });
});

// Session management endpoint
app.get('/sessions', (req, res) => {
  const sessionList = Object.entries(sessions).map(([id, session]) => ({
    id,
    history_length: session.history.length,
    message_count: session.messageCount,
    last_activity: new Date(session.lastActivity).toISOString(),
    created: new Date(session.createdAt).toISOString(),
    warning_sent: session.warningSent,
    inactive_minutes: ((Date.now() - session.lastActivity) / 60000).toFixed(2),
    session_age_minutes: ((Date.now() - session.createdAt) / 60000).toFixed(2)
  }));
  
  res.json({
    total_sessions: sessionList.length,
    sessions: sessionList
  });
});

// Refresh cache endpoint
app.post('/refresh-cache', async (req, res) => {
  try {
    await initializeCSVData();
    res.json({ 
      status: 'success', 
      message: 'Cache refreshed successfully',
      cache: {
        categories_count: csvCache.categoriesData.length,
        galleries_count: csvCache.galleriesData.length,
        last_updated: csvCache.lastUpdated
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
});

module.exports = app;

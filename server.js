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

// Cache for CSV data
let csvCache = {
  categoriesData: [],
  galleriesData: [],
  lastUpdated: null,
  isLoaded: false,
  isLoading: false,
  error: null
};

// Session storage
let sessions = {};

// Session configuration
const SESSION_CONFIG = {
  ACTIVE_TIMEOUT: 60 * 60 * 1000, // 1 hour for active sessions
  INACTIVE_TIMEOUT: 3 * 60 * 1000, // 3 minutes for inactive sessions
  WARNING_TIME: 2 * 60 * 1000, // Warn at 2 minutes of inactivity
  CLEANUP_INTERVAL: 60 * 1000 // Cleanup every 1 minute
};

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
Zulu Club - Premium lifestyle shopping with 100-minute delivery in Gurgaon.
Visit zulu.club or our pop-ups at AIPL Joy Street & AIPL Central.
`;

// Greeting detection
const GREETINGS = [
  'hi', 'hello', 'hey', 'hola', 'namaste', 'good morning', 'good afternoon', 
  'good evening', 'hi there', 'hello there', 'hey there', 'whats up', 'sup'
];

// IMPROVED: CSV initialization with retry logic
async function initializeCSVData() {
  if (csvCache.isLoading) {
    console.log('📥 CSV data is already loading...');
    return;
  }

  csvCache.isLoading = true;
  csvCache.error = null;

  try {
    console.log('🔄 Loading CSV data...');
    
    const categoriesUrl = process.env.CATEGORIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
    const galleriesUrl = process.env.GALLERIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';
    
    console.log('📁 Fetching CSV files...');
    
    // Load both CSVs in parallel
    const [categoriesResults, galleriesResults] = await Promise.all([
      loadCSVFromGitHub(categoriesUrl, 'categories1.csv'),
      loadCSVFromGitHub(galleriesUrl, 'galleries1.csv')
    ]);
    
    // Update cache
    csvCache.categoriesData = categoriesResults || [];
    csvCache.galleriesData = galleriesResults || [];
    csvCache.lastUpdated = new Date();
    csvCache.isLoaded = true;
    csvCache.isLoading = false;
    
    console.log(`✅ CSV Cache loaded successfully!`);
    console.log(`   - Categories: ${csvCache.categoriesData.length} rows`);
    console.log(`   - Galleries: ${csvCache.galleriesData.length} rows`);
    
    // Log sample data to verify structure
    if (csvCache.categoriesData.length > 0) {
      console.log('📋 Sample category:', csvCache.categoriesData[0]);
    }
    if (csvCache.galleriesData.length > 0) {
      console.log('📋 Sample gallery:', csvCache.galleriesData[0]);
    }
    
  } catch (error) {
    console.error('❌ CSV initialization failed:', error.message);
    csvCache.error = error.message;
    csvCache.isLoading = false;
    csvCache.isLoaded = false;
    
    // Retry after 10 seconds
    setTimeout(() => {
      console.log('🔄 Retrying CSV loading...');
      initializeCSVData();
    }, 10000);
  }
}

// Start initialization
initializeCSVData();

// IMPROVED: CSV loading with better error handling
async function loadCSVFromGitHub(csvUrl, csvType) {
  try {
    console.log(`📥 Fetching ${csvType} from: ${csvUrl}`);
    
    const response = await axios.get(csvUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'ZuluClub-Bot/1.0',
        'Accept': 'text/csv'
      }
    });
    
    // Check if we got valid CSV data
    if (!response.data || response.data.trim().length === 0) {
      throw new Error(`Empty CSV data received for ${csvType}`);
    }
    
    const results = [];
    
    return new Promise((resolve, reject) => {
      const stream = Readable.from(response.data);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Only add non-empty rows
          if (Object.keys(data).length > 0) {
            results.push(data);
          }
        })
        .on('end', () => {
          if (results.length === 0) {
            console.warn(`⚠️ No data rows found in ${csvType}`);
          }
          console.log(`✅ ${csvType}: ${results.length} rows parsed`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error(`❌ CSV parsing error for ${csvType}:`, error);
          reject(error);
        });
    });
  } catch (error) {
    console.error(`❌ Failed to load ${csvType}:`, error.message);
    throw error;
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
    messageCount: 0
  };
  return sessions[sessionId];
}

function getSession(sessionId) {
  const session = sessions[sessionId];
  if (session) {
    session.lastActivity = Date.now();
  }
  return session;
}

function deleteSession(sessionId) {
  if (sessions[sessionId]) {
    delete sessions[sessionId];
    return true;
  }
  return false;
}

// Session cleanup
function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    Object.entries(sessions).forEach(([sessionId, session]) => {
      const inactiveTime = now - session.lastActivity;
      
      // Delete session if inactive for 3 minutes
      if (inactiveTime >= SESSION_CONFIG.INACTIVE_TIMEOUT) {
        deleteSession(sessionId);
        cleanedCount++;
        console.log(`🗑️ Session ${sessionId} expired due to inactivity`);
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} sessions. Active: ${Object.keys(sessions).length}`);
    }
  }, SESSION_CONFIG.CLEANUP_INTERVAL);
}

startSessionCleanup();

// Check if message is a greeting
function isGreeting(message) {
  const cleanMessage = message.toLowerCase().trim();
  return GREETINGS.some(greeting => cleanMessage.includes(greeting));
}

// Check if message is asking for products
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

// Get category ID by name
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

// Get type2 data from galleries
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

// FIXED: Smart product search with proper CSV data handling
async function smartProductSearch(userMessage, categoryNames) {
  console.log(`🔍 Searching for: "${userMessage}"`);
  
  // Check if CSV data is available
  if (!csvCache.isLoaded || categoryNames.length === 0) {
    console.log('❌ CSV data not available for search');
    return { success: false, links: [], triedCategories: [] };
  }
  
  const primaryCategory = await getAICategoryMatch(userMessage, categoryNames);
  if (!primaryCategory) {
    console.log('❌ No category matched by AI');
    return { success: false, links: [], triedCategories: [] };
  }
  
  console.log(`🎯 Primary category: ${primaryCategory}`);
  
  const triedCategories = [primaryCategory];
  const primaryCategoryId = getCategoryIdByName(primaryCategory);
  
  if (!primaryCategoryId) {
    console.log(`❌ No ID found for category: ${primaryCategory}`);
    return { success: false, links: [], triedCategories: triedCategories };
  }
  
  console.log(`🔑 Category ID: ${primaryCategoryId}`);
  
  const primaryType2Data = getType2DataByCat1(primaryCategoryId);
  console.log(`📊 Found ${primaryType2Data.length} type2 entries`);
  
  if (primaryType2Data.length > 0) {
    const links = generateLinksFromType2(primaryType2Data);
    console.log(`✅ Generated ${links.length} product links`);
    return { success: true, links: links, triedCategories: triedCategories, source: 'primary' };
  }
  
  console.log(`❌ No products found in category: ${primaryCategory}`);
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

AVAILABLE CATEGORIES:
${categoryNames.map(name => `- ${name}`).join('\n')}

INSTRUCTIONS:
- Match the user's query to the most relevant category
- Return ONLY the exact category name from the available list
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

// FIXED: Main product search logic
async function getProductLinksWithAICategory(userMessage) {
  try {
    // Check CSV status first
    if (csvCache.isLoading) {
      return ["🔄 Our product catalog is currently loading. Please try again in a few seconds..."];
    }
    
    if (!csvCache.isLoaded) {
      if (csvCache.error) {
        return ["😔 We're experiencing technical difficulties with our product catalog. Please visit zulu.club directly for now."];
      }
      return ["🔄 Our product catalog is initializing. Please wait a moment..."];
    }
    
    const categoryNames = getCategoryNames();
    if (categoryNames.length === 0) {
      return ["📦 We're updating our product categories. Please check back in a few minutes."];
    }
    
    const searchResult = await smartProductSearch(userMessage, categoryNames);
    
    if (searchResult.success) {
      return searchResult.links;
    } else {
      // Return helpful message instead of generic error
      return getHelpfulProductMessage(userMessage);
    }
    
  } catch (error) {
    console.error('❌ Error in product search:', error);
    return ["😔 I'm having trouble accessing our products right now. Please try again later or visit zulu.club directly."];
  }
}

// IMPROVED: Better product message
function getHelpfulProductMessage(userMessage) {
  const message = userMessage.toLowerCase();
  
  if (message.includes('tshirt') || message.includes('shirt')) {
    return [`👕 Looking for t-shirts? While we update our catalog, you can visit:\n\n• app.zulu.club/men%20fashion\n• app.zulu.club/women%20fashion\n\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`];
  } else if (message.includes('vase') || message.includes('decor')) {
    return [`🏠 Looking for home decor? Check out:\n\n• app.zulu.club/home%20decor\n• app.zulu.club/home%20accessories\n\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`];
  } else if (message.includes('shoe') || message.includes('footwear')) {
    return [`👟 Looking for footwear? Visit:\n\n• app.zulu.club/men%20footwear\n• app.zulu.club/women%20footwear\n\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`];
  } else {
    return [`🔍 I understand you're looking for products! While we update our catalog, you can explore:\n\n• app.zulu.club/men%20fashion\n• app.zulu.club/women%20fashion\n• app.zulu.club/home%20decor\n• app.zulu.club/beauty\n\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\nVisit zulu.club for our complete collection! 🛍️`];
  }
}

// IMPROVED: Response handler with better CSV status handling
async function getChatGPTResponse(userMessage, session) {
  // Check if it's a greeting
  if (isGreeting(userMessage)) {
    return `👋 Hello! Welcome to Zulu Club! 🛍️\n\nI'm here to help you discover amazing lifestyle products with *100-minute delivery* in Gurgaon!\n\nWhat would you like to explore today?`;
  }
  
  // Check if it's a product query
  if (isProductQuery(userMessage)) {
    const productResponse = await getProductLinksWithAICategory(userMessage);
    
    // If we have actual product links, format them properly
    if (productResponse.length > 0 && productResponse[0].startsWith('app.zulu.club/')) {
      let response = `Great choice! 🎯\n\nHere are the products you're looking for:\n\n`;
      
      productResponse.slice(0, 6).forEach(link => {
        response += `• ${link}\n`;
      });
      
      response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
      response += `Click the links to explore and shop! 🛍️`;
      
      return response;
    } else {
      // Return the helpful message directly
      return productResponse[0];
    }
  }
  
  // For general conversation
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Please visit zulu.club to explore our premium lifestyle products!";
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a friendly customer service assistant for Zulu Club. ${ZULU_CLUB_INFO} Keep responses under 300 characters.`
    }];
    
    if (session && session.history.length > 0) {
      const recentHistory = session.history.slice(-4);
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
      max_tokens: 150,
      temperature: 0.7
    });
    
    return completion.choices[0].message.content.trim();
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club! 🛍️";
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

// Handle user message
async function handleMessage(sessionId, userMessage) {
  try {
    let session = getSession(sessionId);
    if (!session) {
      session = createSession(sessionId);
    }
    
    session.history.push({
      role: "user",
      content: userMessage,
      timestamp: Date.now()
    });
    
    const response = await getChatGPTResponse(userMessage, session);
    
    session.history.push({
      role: "assistant",
      content: response,
      timestamp: Date.now()
    });
    
    if (session.history.length > 8) {
      session.history = session.history.slice(-8);
    }
    
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
    
    console.log(`💬 Message from ${userPhone}: ${userMessage}`);
    
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage);
      await sendMessage(userPhone, userName, aiResponse);
      console.log(`✅ Response sent to ${userPhone}`);
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
    version: '14.0 - Fixed CSV Loading',
    csv_status: {
      is_loaded: csvCache.isLoaded,
      is_loading: csvCache.isLoading,
      categories_count: csvCache.categoriesData.length,
      galleries_count: csvCache.galleriesData.length,
      last_updated: csvCache.lastUpdated,
      error: csvCache.error
    },
    sessions: {
      active_sessions: Object.keys(sessions).length
    }
  });
});

// Test CSV data endpoint
app.get('/test-csv', (req, res) => {
  const categoryNames = getCategoryNames();
  
  res.json({
    csv_loaded: csvCache.isLoaded,
    csv_loading: csvCache.isLoading,
    csv_error: csvCache.error,
    categories_count: csvCache.categoriesData.length,
    galleries_count: csvCache.galleriesData.length,
    category_names: categoryNames,
    sample_category: csvCache.categoriesData.length > 0 ? csvCache.categoriesData[0] : null,
    sample_gallery: csvCache.galleriesData.length > 0 ? csvCache.galleriesData[0] : null
  });
});

// Manual cache refresh endpoint
app.post('/refresh-csv', async (req, res) => {
  try {
    await initializeCSVData();
    res.json({ 
      status: 'success', 
      message: 'CSV cache refresh initiated',
      csv_status: {
        is_loaded: csvCache.isLoaded,
        is_loading: csvCache.isLoading,
        categories_count: csvCache.categoriesData.length,
        galleries_count: csvCache.galleriesData.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh CSV cache' });
  }
});

module.exports = app;

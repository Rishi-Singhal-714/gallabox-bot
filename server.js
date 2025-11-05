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

// Store conversations
let conversations = {};

// Store CSV data
let categoriesData = [];
let galleriesData = [];

// Initialize CSV data
async function initializeCSVData() {
  try {
    console.log('🔄 Initializing CSV data from GitHub...');
    
    const categoriesUrl = process.env.CATEGORIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
    const galleriesUrl = process.env.GALLERIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';
    
    console.log('📁 CSV URLs:', { categories: categoriesUrl, galleries: galleriesUrl });
    
    // Load categories1.csv
    const categoriesResults = await loadCSVFromGitHub(categoriesUrl, 'categories1.csv');
    categoriesData = categoriesResults || [];
    
    // Load galleries1.csv
    const galleriesResults = await loadCSVFromGitHub(galleriesUrl, 'galleries1.csv');
    galleriesData = galleriesResults || [];
    
    console.log(`📊 Categories data loaded: ${categoriesData.length} rows`);
    console.log(`📊 Galleries data loaded: ${galleriesData.length} rows`);
    
    // Debug: Show column names
    if (categoriesData.length > 0) {
      console.log('📋 Categories columns:', Object.keys(categoriesData[0]));
    }
    if (galleriesData.length > 0) {
      console.log('📋 Galleries columns:', Object.keys(galleriesData[0]));
    }
    
  } catch (error) {
    console.error('❌ Error initializing CSV data:', error);
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

// STEP 1: Extract category names from categories1.csv
function getCategoryNamesFromCSV() {
  if (!categoriesData.length) {
    console.log('⚠️ No categories data available');
    return [];
  }
  
  const categoryNames = new Set();
  
  categoriesData.forEach((row) => {
    // Get name from various possible column names
    const name = row.name || row.Name || row.category_name || row.CategoryName || row.title || row.Title;
    if (name && name.trim()) {
      categoryNames.add(name.trim().toLowerCase());
    }
  });
  
  const result = Array.from(categoryNames);
  console.log(`📋 Found ${result.length} category names:`, result);
  return result;
}

// STEP 2: Send category names to ChatGPT to find matching category for user query
async function findMatchingCategoryWithAI(userMessage, categoryNames) {
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OpenAI API key not available');
    return null;
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a product categorization assistant. Your task is to find the most relevant category for a user's product query.

AVAILABLE CATEGORIES:
${categoryNames.map(name => `- ${name}`).join('\n')}

INSTRUCTIONS:
1. Analyze the user's message and find the BEST matching category from the available list
2. Return ONLY the exact category name from the available list
3. If no good match, return "no_match"
4. Do not add any explanations or additional text

Examples:
User: "I need tshirt" → "men's fashion" (if that category exists)
User: "looking for vases" → "home decor" (if that category exists)
User: "show me dresses" → "women's fashion" (if that category exists)`
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
    
    const response = completion.choices[0].message.content.trim().toLowerCase();
    console.log(`🤖 AI category match: "${response}"`);
    
    // Check if the response matches any of our category names
    const matchedCategory = categoryNames.find(cat => response === cat || response.includes(cat));
    
    return matchedCategory || null;
    
  } catch (error) {
    console.error('❌ ChatGPT API error in category matching:', error);
    return null;
  }
}

// STEP 3: Get category ID from categories1.csv for the matched category name
function getCategoryIdForName(categoryName) {
  if (!categoriesData.length || !categoryName) {
    return null;
  }
  
  console.log(`🔍 Looking for category ID for: "${categoryName}"`);
  
  for (const row of categoriesData) {
    const name = row.name || row.Name || row.category_name || row.CategoryName || row.title || row.Title;
    if (name && name.trim().toLowerCase() === categoryName.toLowerCase()) {
      const id = row.id || row.ID || row.Id || row.category_id || row.CategoryID;
      if (id) {
        console.log(`✅ Found category ID: ${id} for category: ${categoryName}`);
        return id.toString();
      }
    }
  }
  
  console.log(`❌ No category ID found for: ${categoryName}`);
  return null;
}

// STEP 4: Get type2 data from galleries1.csv using category ID
function getType2DataFromGalleries(categoryId) {
  if (!galleriesData.length || !categoryId) {
    return [];
  }
  
  console.log(`🔍 Looking for type2 data for category ID: ${categoryId}`);
  
  const type2Data = new Set();
  
  galleriesData.forEach((row) => {
    // Try different possible category ID field names
    const rowCategoryId = row.cat1 || row.Cat1 || row.category_id || row.CategoryID || row.id || row.ID || row.cat_id;
    
    if (rowCategoryId && rowCategoryId.toString() === categoryId.toString()) {
      const type2 = row.type2 || row.Type2 || row.type || row.Type || row.name || row.Name || row.product_name;
      if (type2 && type2.trim()) {
        type2Data.add(type2.trim());
        console.log(`✅ Found type2: "${type2}" for category ID: ${categoryId}`);
      }
    }
  });
  
  const result = Array.from(type2Data);
  console.log(`📝 Found ${result.length} type2 entries:`, result);
  return result;
}

// STEP 5: Generate links from type2 data
function generateLinksFromType2(type2Data) {
  return type2Data.map(name => {
    // Replace spaces with %20 and create link
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// MAIN LOGIC: Complete flow from user query to product links
async function getProductLinksFromCSV(userMessage) {
  try {
    console.log('\n🔍 STARTING CSV LOGIC FLOW');
    console.log(`📝 User query: "${userMessage}"`);
    
    // Step 1: Get all category names from categories1.csv
    const categoryNames = getCategoryNamesFromCSV();
    if (categoryNames.length === 0) {
      console.log('❌ No category names found in CSV');
      return [];
    }
    
    // Step 2: Use AI to find matching category for user query
    const matchedCategory = await findMatchingCategoryWithAI(userMessage, categoryNames);
    if (!matchedCategory) {
      console.log('❌ No category matched by AI');
      return [];
    }
    
    // Step 3: Get category ID for the matched category name
    const categoryId = getCategoryIdForName(matchedCategory);
    if (!categoryId) {
      console.log('❌ No category ID found');
      return [];
    }
    
    // Step 4: Get type2 data from galleries1.csv using category ID
    const type2Data = getType2DataFromGalleries(categoryId);
    if (type2Data.length === 0) {
      console.log('❌ No type2 data found');
      return [];
    }
    
    // Step 5: Generate links from type2 data
    const links = generateLinksFromType2(type2Data);
    console.log(`🔗 Generated ${links.length} links:`, links);
    
    return links;
    
  } catch (error) {
    console.error('❌ Error in getProductLinksFromCSV:', error);
    return [];
  }
}

// Function to send message via Gallabox API
async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Sending message to ${to}`);
    
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
    console.error('❌ Error sending message:', error.message);
    throw error;
  }
}

// Main response handler - Uses CSV logic first
async function getChatGPTResponse(userMessage, conversationHistory = []) {
  // STEP 1: Always try CSV logic first
  const productLinks = await getProductLinksFromCSV(userMessage);
  
  // If we found product links, use them
  if (productLinks.length > 0) {
    console.log(`🛍️ Using CSV logic, found ${productLinks.length} links`);
    
    let response = `Great choice! 🎯\n\n`;
    response += `Here are the products you're looking for:\n\n`;
    
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
  
  // STEP 2: Only use AI for non-product queries
  console.log('🤖 No product links found, using AI for general query');
  
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Please visit zulu.club to explore our premium lifestyle products!";
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a friendly customer service assistant for Zulu Club. Keep responses under 300 characters. Be enthusiastic and highlight 100-minute delivery, try-at-home, and easy returns.`
    }];
    
    // Add conversation history
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
    
    // Add current user message
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

// Handle user message
async function handleMessage(sessionId, userMessage) {
  try {
    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [] };
    }
    
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage
    });
    
    const response = await getChatGPTResponse(userMessage, conversations[sessionId].history);
    
    conversations[sessionId].history.push({
      role: "assistant",
      content: response
    });
    
    if (conversations[sessionId].history.length > 10) {
      conversations[sessionId].history = conversations[sessionId].history.slice(-10);
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
    console.log('📩 Received webhook');
    
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
    version: '7.0 - AI Category Matching',
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length,
      categories_columns: categoriesData.length > 0 ? Object.keys(categoriesData[0]) : [],
      galleries_columns: galleriesData.length > 0 ? Object.keys(galleriesData[0]) : []
    }
  });
});

// Test the complete logic flow
app.get('/test-logic', async (req, res) => {
  const query = req.query.q || 'tshirt';
  
  try {
    console.log(`\n🧪 TESTING COMPLETE LOGIC FOR: "${query}"`);
    
    // Step 1: Get category names
    const categoryNames = getCategoryNamesFromCSV();
    
    // Step 2: AI category matching
    const matchedCategory = await findMatchingCategoryWithAI(query, categoryNames);
    
    // Step 3: Get category ID
    const categoryId = getCategoryIdForName(matchedCategory);
    
    // Step 4: Get type2 data
    const type2Data = getType2DataFromGalleries(categoryId);
    
    // Step 5: Generate links
    const links = generateLinksFromType2(type2Data);
    
    res.json({
      query: query,
      step1_category_names: categoryNames,
      step2_ai_matched_category: matchedCategory,
      step3_category_id: categoryId,
      step4_type2_data: type2Data,
      step5_generated_links: links,
      final_result: links
    });
  } catch (error) {
    res.status(500).json({ error: 'Logic test failed', details: error.message });
  }
});

// Refresh CSV data endpoint
app.post('/refresh-csv-data', async (req, res) => {
  try {
    await initializeCSVData();
    res.json({ 
      status: 'success', 
      categories_count: categoriesData.length,
      galleries_count: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh CSV data' });
  }
});

module.exports = app;

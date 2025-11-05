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

// IMPROVED: Better keyword matching for categories
function findMatchingCategoryIds(userMessage) {
  if (!categoriesData.length) {
    console.log('⚠️ No categories data available');
    return [];
  }
  
  const message = userMessage.toLowerCase();
  const matchingIds = new Set();
  
  console.log(`🔍 Searching categories for: "${message}"`);
  
  // Common product variations
  const productVariations = {
    'tshirt': ['t-shirt', 'tee', 't shirt', 'tshirt'],
    'vase': ['vase', 'vases', 'flower vase'],
    'dress': ['dress', 'dresses'],
    'shirt': ['shirt', 'shirts'],
    'jacket': ['jacket', 'jackets'],
    'shoe': ['shoe', 'shoes', 'footwear'],
    'bag': ['bag', 'bags'],
    'watch': ['watch', 'watches'],
    'perfume': ['perfume', 'fragrance'],
    'lamp': ['lamp', 'lamps'],
    // Add more as needed
  };
  
  categoriesData.forEach((row) => {
    // Check all columns for matching keywords
    Object.entries(row).forEach(([key, value]) => {
      if (value && typeof value === 'string') {
        const cleanValue = value.toLowerCase().trim();
        
        // Check direct match
        if (cleanValue.length > 2 && message.includes(cleanValue)) {
          addMatchingId(row, cleanValue, key, matchingIds);
        }
        
        // Check product variations
        Object.entries(productVariations).forEach(([baseProduct, variations]) => {
          if (variations.some(variation => message.includes(variation))) {
            // If user is asking for this product, check if this category contains it
            if (cleanValue.includes(baseProduct) || variations.some(variation => cleanValue.includes(variation))) {
              addMatchingId(row, baseProduct, key, matchingIds);
            }
          }
        });
      }
    });
  });
  
  const result = Array.from(matchingIds);
  console.log(`📋 Found ${result.length} matching category IDs:`, result);
  return result;
}

function addMatchingId(row, matchedWord, column, matchingIds) {
  const id = row.id || row.ID || row.Id || row.category_id || row.CategoryID || row.cat_id;
  if (id) {
    matchingIds.add(id.toString());
    console.log(`✅ Matched: "${matchedWord}" in "${column}" column, ID: ${id}`);
  }
}

// IMPROVED: Get type2 names from galleries
function getType2NamesFromGalleries(categoryIds) {
  if (!galleriesData.length || !categoryIds.length) {
    console.log('⚠️ No galleries data or category IDs');
    return [];
  }
  
  const type2Names = new Set();
  
  console.log(`🔍 Searching galleries for category IDs:`, categoryIds);
  
  galleriesData.forEach((row) => {
    // Try different possible category ID field names
    const categoryId = row.cat1 || row.Cat1 || row.category_id || row.CategoryID || row.id || row.ID || row.cat_id;
    
    if (categoryId && categoryIds.includes(categoryId.toString())) {
      const type2 = row.type2 || row.Type2 || row.type || row.Type || row.name || row.Name || row.product_name;
      if (type2 && type2.trim()) {
        type2Names.add(type2.trim());
        console.log(`✅ Found type2: "${type2}" for category ID: ${categoryId}`);
      }
    }
  });
  
  const result = Array.from(type2Names);
  console.log(`📝 Found ${result.length} type2 names:`, result);
  return result;
}

// Function to generate links from type2 names
function generateLinksFromType2(type2Names) {
  return type2Names.map(name => {
    // Replace spaces with %20 and create link
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// IMPROVED: Get product links with better fallback
function getProductLinksFromCSV(userMessage) {
  try {
    console.log('🔍 CSV LOGIC: Searching for products...');
    
    // Step 1: Find matching category IDs from categories1.csv
    const matchingCategoryIds = findMatchingCategoryIds(userMessage);
    
    if (!matchingCategoryIds.length) {
      console.log('❌ No matching category IDs found');
      return getFallbackLinks(userMessage);
    }
    
    // Step 2: Get type2 names from galleries1.csv using cat1 column
    const type2Names = getType2NamesFromGalleries(matchingCategoryIds);
    
    if (!type2Names.length) {
      console.log('❌ No type2 names found for the category IDs');
      return getFallbackLinks(userMessage);
    }
    
    // Step 3: Generate links with app.zulu.club/ prefix and %20 for spaces
    const links = generateLinksFromType2(type2Names);
    console.log(`🔗 Generated ${links.length} links:`, links);
    
    return links;
  } catch (error) {
    console.error('❌ Error in getProductLinksFromCSV:', error);
    return getFallbackLinks(userMessage);
  }
}

// Fallback links when CSV doesn't have matches
function getFallbackLinks(userMessage) {
  const message = userMessage.toLowerCase();
  const fallbackLinks = [];
  
  // Common product fallbacks
  if (message.includes('tshirt') || message.includes('t-shirt') || message.includes('tee')) {
    fallbackLinks.push('app.zulu.club/men%20t-shirts', 'app.zulu.club/women%20t-shirts');
  }
  if (message.includes('vase') || message.includes('vases')) {
    fallbackLinks.push('app.zulu.club/home%20decor%20vases', 'app.zulu.club/ceramic%20vases');
  }
  if (message.includes('dress')) {
    fallbackLinks.push('app.zulu.club/women%20dresses', 'app.zulu.club/party%20dresses');
  }
  if (message.includes('shirt')) {
    fallbackLinks.push('app.zulu.club/men%20shirts', 'app.zulu.club/formal%20shirts');
  }
  
  if (fallbackLinks.length > 0) {
    console.log(`🔄 Using fallback links:`, fallbackLinks);
  }
  
  return fallbackLinks;
}

// Function to send message via Gallabox API
async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Sending message to ${to}: ${message}`);
    
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

// UPDATED: Force CSV logic to always run first and return links
async function getChatGPTResponse(userMessage, conversationHistory = []) {
  // ALWAYS try CSV logic first for any product-related query
  const productLinks = getProductLinksFromCSV(userMessage);
  
  // If we found product links (either from CSV or fallback), use them
  if (productLinks.length > 0) {
    console.log(`🛍️ Using CSV logic, found ${productLinks.length} links`);
    
    let response = `Great choice! 🎯\n\n`;
    
    // Add specific product mention based on user query
    const message = userMessage.toLowerCase();
    if (message.includes('tshirt') || message.includes('t-shirt') || message.includes('tee')) {
      response += `I found these amazing t-shirts for you:\n\n`;
    } else if (message.includes('vase') || message.includes('vases')) {
      response += `I found these beautiful vases for your home:\n\n`;
    } else if (message.includes('dress')) {
      response += `I found these stunning dresses for you:\n\n`;
    } else {
      response += `I found these products for you:\n\n`;
    }
    
    productLinks.slice(0, 6).forEach(link => {
      response += `• ${link}\n`;
    });
    
    if (productLinks.length > 6) {
      response += `• ... and ${productLinks.length - 6} more options\n`;
    }
    
    response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
    response += `Click the links above to explore and shop! 🛍️`;
    
    return response;
  }
  
  // Only use AI for non-product queries
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
    version: '6.0 - Enhanced CSV Matching',
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length,
      categories_columns: categoriesData.length > 0 ? Object.keys(categoriesData[0]) : [],
      galleries_columns: galleriesData.length > 0 ? Object.keys(galleriesData[0]) : []
    }
  });
});

// Test product search endpoint with detailed debugging
app.get('/search-products', async (req, res) => {
  const query = req.query.q || 'tshirt';
  
  try {
    console.log(`\n🔍 DEBUG SEARCH FOR: "${query}"`);
    
    // Step 1: Find matching category IDs
    const matchingCategoryIds = findMatchingCategoryIds(query);
    console.log('STEP 1 - Category IDs:', matchingCategoryIds);
    
    // Step 2: Get type2 names
    const type2Names = getType2NamesFromGalleries(matchingCategoryIds);
    console.log('STEP 2 - Type2 Names:', type2Names);
    
    // Step 3: Generate links
    const links = generateLinksFromType2(type2Names);
    console.log('STEP 3 - Generated Links:', links);
    
    // Fallback check
    const fallbackLinks = getFallbackLinks(query);
    
    res.json({
      query: query,
      csv_data_available: {
        categories: categoriesData.length,
        galleries: galleriesData.length
      },
      search_steps: {
        matching_category_ids: matchingCategoryIds,
        type2_names_found: type2Names,
        generated_links: links
      },
      fallback_links: fallbackLinks,
      final_links_used: links.length > 0 ? links : fallbackLinks
    });
  } catch (error) {
    res.status(500).json({ error: 'Search failed', details: error.message });
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

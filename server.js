const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');

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

// Store conversations
let conversations = {};

// Store CSV data
let categoriesData = [];
let galleriesData = [];

// ZULU CLUB INFORMATION
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
Explore & shop on zulu.club
`;

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
    
    // Log sample data to verify structure
    if (categoriesData.length > 0) {
      console.log('📋 Sample categories data:', categoriesData[0]);
    }
    if (galleriesData.length > 0) {
      console.log('📋 Sample galleries data:', galleriesData[0]);
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

// IMPROVED LOGIC: Find matching category IDs based on user message
function findMatchingCategoryIds(userMessage) {
  if (!categoriesData.length) {
    console.log('⚠️ No categories data available');
    return [];
  }
  
  const message = userMessage.toLowerCase();
  const matchingIds = new Set();
  
  console.log(`🔍 Searching in ${categoriesData.length} categories for: "${message}"`);
  
  categoriesData.forEach((row) => {
    // Check all columns for matching keywords
    Object.entries(row).forEach(([key, value]) => {
      if (value && typeof value === 'string') {
        const cleanValue = value.toLowerCase().trim();
        if (cleanValue.length > 2) {
          // Split by common separators and check each word
          const keywords = cleanValue.split(/[,\s\.\-_]+/).filter(k => k.length > 2);
          keywords.forEach(keyword => {
            if (message.includes(keyword)) {
              // Try different possible ID field names
              const id = row.id || row.ID || row.Id || row.category_id || row.CategoryID;
              if (id) {
                matchingIds.add(id.toString());
                console.log(`✅ Matched: "${keyword}" in "${key}" column, ID: ${id}`);
              }
            }
          });
        }
      }
    });
  });
  
  const result = Array.from(matchingIds);
  console.log(`📋 Found ${result.length} matching category IDs:`, result);
  return result;
}

// IMPROVED LOGIC: Get type2 names from galleries based on category IDs
function getType2NamesFromGalleries(categoryIds) {
  if (!galleriesData.length || !categoryIds.length) {
    console.log('⚠️ No galleries data or category IDs');
    return [];
  }
  
  const type2Names = new Set();
  
  console.log(`🔍 Searching ${galleriesData.length} galleries for category IDs:`, categoryIds);
  
  galleriesData.forEach((row) => {
    // Try different possible category ID field names
    const categoryId = row.cat1 || row.Cat1 || row.category_id || row.CategoryID || row.id || row.ID;
    
    if (categoryId && categoryIds.includes(categoryId.toString())) {
      const type2 = row.type2 || row.Type2 || row.type || row.Type || row.name || row.Name;
      if (type2) {
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

// IMPROVED LOGIC: Get product links based on user message
function getProductLinksFromCSV(userMessage) {
  try {
    console.log('🔍 CSV LOGIC: Searching for products...');
    
    // Step 1: Find matching category IDs from categories1.csv
    const matchingCategoryIds = findMatchingCategoryIds(userMessage);
    
    if (!matchingCategoryIds.length) {
      console.log('❌ No matching category IDs found');
      return [];
    }
    
    // Step 2: Get type2 names from galleries1.csv using cat1 column
    const type2Names = getType2NamesFromGalleries(matchingCategoryIds);
    
    if (!type2Names.length) {
      console.log('❌ No type2 names found for the category IDs');
      return [];
    }
    
    // Step 3: Generate links with app.zulu.club/ prefix and %20 for spaces
    const links = generateLinksFromType2(type2Names);
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

// IMPROVED AI Chat Functionality - Force CSV logic for product queries
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  // FIRST: Check if this is a product query and get links from CSV
  const productLinks = getProductLinksFromCSV(userMessage);
  
  // If we found product links, use them directly instead of AI
  if (productLinks.length > 0) {
    console.log(`🛍️ Using CSV logic for product query, found ${productLinks.length} links`);
    
    let response = `Great! I found these products for you:\n\n`;
    
    productLinks.slice(0, 8).forEach(link => {
      response += `• ${link}\n`;
    });
    
    if (productLinks.length > 8) {
      response += `• ... and ${productLinks.length - 8} more options\n`;
    }
    
    response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
    response += `Visit these links to explore and shop!`;
    
    return response;
  }
  
  // If no product links found, use AI for general conversation
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Please visit zulu.club to explore our premium lifestyle products with 100-minute delivery in Gurgaon!";
  }
  
  try {
    const messages = [];
    
    // System message
    const systemMessage = {
      role: "system",
      content: `You are a friendly customer service assistant for Zulu Club. 

      ZULU CLUB INFORMATION:
      ${companyInfo}

      RESPONSE GUIDELINES:
      1. Keep responses under 300 characters for WhatsApp
      2. Be enthusiastic and helpful
      3. Highlight: 100-minute delivery, try-at-home, easy returns
      4. Mention we're in Gurgaon with pop-ups at AIPL Joy Street & AIPL Central
      5. Use emojis to make it engaging

      If users ask about specific products, let the system handle product links automatically.`
    };
    
    messages.push(systemMessage);
    
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
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! What would you like to know? 🛍️";
  }
}

// Handle user message
async function handleMessage(sessionId, userMessage) {
  try {
    // Initialize conversation if not exists
    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [] };
    }
    
    // Add user message to history
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage
    });
    
    // Get response
    const response = await getChatGPTResponse(userMessage, conversations[sessionId].history);
    
    // Add response to history
    conversations[sessionId].history.push({
      role: "assistant",
      content: response
    });
    
    // Keep history manageable
    if (conversations[sessionId].history.length > 10) {
      conversations[sessionId].history = conversations[sessionId].history.slice(-10);
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our premium lifestyle products with 100-minute delivery in Gurgaon!";
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    
    console.log(`💬 Message from ${userPhone} (${userName}): ${userMessage}`);
    
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '5.0 - Enhanced CSV Logic',
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length
    }
  });
});

// Test product search endpoint
app.get('/search-products', async (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }
  
  try {
    const productLinks = getProductLinksFromCSV(query);
    
    res.json({
      query: query,
      matching_links: productLinks,
      total_found: productLinks.length,
      logic: {
        step1: 'Find matching category IDs in categories1.csv',
        step2: 'Look up type2 names in galleries1.csv using cat1 column', 
        step3: 'Generate links with app.zulu.club/ prefix and %20 for spaces'
      }
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

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

// Static fallback categories in case CSV loading fails
const STATIC_CATEGORIES = {
  "Women's Fashion": {
    link: "app.zulu.club/categories/womens-fashion",
    subcategories: {
      "Dresses": "app.zulu.club/categories/womens-fashion/dresses",
      "Tops": "app.zulu.club/categories/womens-fashion/tops",
      "Co-ords": "app.zulu.club/categories/womens-fashion/co-ords",
      "Winterwear": "app.zulu.club/categories/womens-fashion/winterwear",
      "Loungewear": "app.zulu.club/categories/womens-fashion/loungewear"
    }
  },
  "Men's Fashion": {
    link: "app.zulu.club/categories/mens-fashion",
    subcategories: {
      "Shirts": "app.zulu.club/categories/mens-fashion/shirts",
      "Tees": "app.zulu.club/categories/mens-fashion/tees",
      "Jackets": "app.zulu.club/categories/mens-fashion/jackets",
      "Athleisure": "app.zulu.club/categories/mens-fashion/athleisure"
    }
  },
  "Home Decor": {
    link: "app.zulu.club/categories/home-decor",
    subcategories: {
      "Showpieces": "app.zulu.club/categories/home-decor/showpieces",
      "Vases": "app.zulu.club/categories/home-decor/vases",
      "Lamps": "app.zulu.club/categories/home-decor/lamps"
    }
  }
};

// Function to load CSV data from GitHub with better error handling
async function loadCSVFromGitHub(csvUrl, csvType) {
  try {
    console.log(`📥 Loading ${csvType} from: ${csvUrl}`);
    
    if (!csvUrl) {
      throw new Error(`No URL provided for ${csvType}`);
    }
    
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
          // Clean the data - remove empty rows
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
    console.error(`❌ Error loading ${csvType} from GitHub:`, {
      message: error.message,
      status: error.response?.status,
      url: csvUrl
    });
    
    // Return empty array but don't crash
    return [];
  }
}

// Initialize CSV data with fallback
async function initializeCSVData() {
  try {
    console.log('🔄 Initializing CSV data from GitHub...');
    
    // Use environment variables for CSV URLs with fallbacks to YOUR actual raw GitHub URLs
    const categoriesUrl = process.env.CATEGORIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
    const galleriesUrl = process.env.GALLERIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';
    
    console.log('📁 CSV URLs:', {
      categories: categoriesUrl,
      galleries: galleriesUrl
    });
    
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
    
    // If no CSV data loaded, use static fallback
    if (categoriesData.length === 0 || galleriesData.length === 0) {
      console.log('⚠️ Using static fallback categories due to CSV loading issues');
    }
    
  } catch (error) {
    console.error('❌ Error initializing CSV data:', error);
    // Don't throw - we'll use static fallback
  }
}

// Initialize on startup with retry
let csvInitialized = false;
async function initializeWithRetry(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await initializeCSVData();
      if (categoriesData.length > 0 && galleriesData.length > 0) {
        csvInitialized = true;
        console.log('✅ CSV data initialized successfully');
        break;
      } else {
        console.log(`🔄 Retry ${i + 1}/${retries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.log(`🔄 Retry ${i + 1}/${retries} after error...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  if (!csvInitialized) {
    console.log('⚠️ CSV data not loaded, using static categories as fallback');
  }
}

// Start initialization
initializeWithRetry();

// Function to find matching category IDs based on user message
function findMatchingCategoryIds(userMessage) {
  if (!categoriesData.length) {
    console.log('⚠️ No categories data available, using static matching');
    return findMatchingStaticCategories(userMessage);
  }
  
  const message = userMessage.toLowerCase();
  const matchingIds = new Set();
  
  console.log(`🔍 Searching in ${categoriesData.length} categories for: "${message}"`);
  
  categoriesData.forEach((row, index) => {
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

// Static category matching fallback
function findMatchingStaticCategories(userMessage) {
  const message = userMessage.toLowerCase();
  const matchingCategories = [];
  
  Object.entries(STATIC_CATEGORIES).forEach(([category, data]) => {
    const categoryLower = category.toLowerCase();
    if (message.includes(categoryLower)) {
      matchingCategories.push(category);
    }
    
    // Check subcategories
    Object.keys(data.subcategories).forEach(subcategory => {
      const subLower = subcategory.toLowerCase();
      if (message.includes(subLower)) {
        matchingCategories.push(category);
      }
    });
  });
  
  return matchingCategories;
}

// Function to get type2 names from galleries based on category IDs
function getType2NamesFromGalleries(categoryIds) {
  if (!galleriesData.length || !categoryIds.length) {
    console.log('⚠️ No galleries data or category IDs, using static fallback');
    return getType2NamesFromStatic(categoryIds);
  }
  
  const type2Names = new Set();
  
  console.log(`🔍 Searching ${galleriesData.length} galleries for category IDs:`, categoryIds);
  
  galleriesData.forEach((row, index) => {
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

// Static type2 names fallback
function getType2NamesFromStatic(categoryIds) {
  const type2Names = [];
  
  categoryIds.forEach(categoryName => {
    const category = STATIC_CATEGORIES[categoryName];
    if (category) {
      Object.keys(category.subcategories).forEach(subcategory => {
        type2Names.push(subcategory);
      });
    }
  });
  
  return type2Names;
}

// Function to generate links from type2 names
function generateLinksFromType2(type2Names) {
  return type2Names.map(name => {
    // Replace spaces with %20 and create link
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// Function to get product links based on user message
function getProductLinksFromCSV(userMessage) {
  try {
    console.log('🔍 Searching for products in CSV data...');
    
    // Step 1: Find matching category IDs
    const matchingCategoryIds = findMatchingCategoryIds(userMessage);
    
    if (!matchingCategoryIds.length) {
      console.log('❌ No matching category IDs found');
      return [];
    }
    
    // Step 2: Get type2 names from galleries
    const type2Names = getType2NamesFromGalleries(matchingCategoryIds);
    
    if (!type2Names.length) {
      console.log('❌ No type2 names found for the category IDs');
      return [];
    }
    
    // Step 3: Generate links
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

// Enhanced AI Chat Functionality with CSV Integration
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    const messages = [];
    
    // Get product links from CSV based on user message
    const productLinks = getProductLinksFromCSV(userMessage);
    let csvContext = "";
    
    if (productLinks.length > 0) {
      csvContext = `\n\nPRODUCT LINKS FROM DATABASE:\n${productLinks.map(link => `• ${link}`).join('\n')}`;
      console.log(`🤖 Providing ${productLinks.length} product links to AI`);
    }
    
    // System message with enhanced CSV integration
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${companyInfo}

      IMPORTANT RESPONSE GUIDELINES:
      1. **Use product links from database** when available in the context below
      2. **For product inquiries**, check if there are product links provided and include them naturally
      3. **If no specific links match**, provide general category guidance
      4. **Keep responses conversational** and helpful
      5. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      6. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
      7. **Use emojis** to make it engaging but professional
      8. **Keep responses under 400 characters** for WhatsApp compatibility
      9. **Be enthusiastic and helpful** - we're excited about our products!

      ${csvContext ? `CURRENT PRODUCT LINKS FOR USER QUERY:${csvContext}\n\nUse these links when responding about products.` : 'No specific product links found for this query. Provide general assistance.'}

      Remember: Always be helpful and guide users to the best shopping experience!
      `
    };
    
    messages.push(systemMessage);
    
    // Add conversation history if available
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
      max_tokens: 350,
      temperature: 0.7
    });
    
    let response = completion.choices[0].message.content.trim();
    
    // Fallback: If AI doesn't include product links but we have them, append them
    if (productLinks.length > 0 && !response.includes('app.zulu.club')) {
      console.log('🤖 AI missed product links, adding them...');
      response += `\n\n🛍️ *Quick Links Based on Your Search:*\n`;
      productLinks.slice(0, 5).forEach(link => { // Limit to 5 links to avoid overwhelming
        response += `• ${link}\n`;
      });
      if (productLinks.length > 5) {
        response += `• ... and ${productLinks.length - 5} more\n`;
      }
      response += `\nVisit these links to explore products! 🚀`;
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    
    // Fallback to CSV-based response for product queries
    const productLinks = getProductLinksFromCSV(userMessage);
    if (productLinks.length > 0) {
      let fallbackResponse = `I found these products matching your search:\n\n`;
      productLinks.slice(0, 5).forEach(link => {
        fallbackResponse += `• ${link}\n`;
      });
      if (productLinks.length > 5) {
        fallbackResponse += `• ... and ${productLinks.length - 5} more\n`;
      }
      fallbackResponse += `\nVisit these links to explore! 🛍️`;
      return fallbackResponse;
    }
    
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! What would you like to know about our products? 🛍️";
  }
}

// Handle user message with AI
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
    
    // Get AI response
    const aiResponse = await getChatGPTResponse(
      userMessage, 
      conversations[sessionId].history
    );
    
    // Add AI response to history
    conversations[sessionId].history.push({
      role: "assistant",
      content: aiResponse
    });
    
    // Keep history manageable (last 10 messages)
    if (conversations[sessionId].history.length > 10) {
      conversations[sessionId].history = conversations[sessionId].history.slice(-10);
    }
    
    return aiResponse;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    
    // Fallback to CSV-based response
    const productLinks = getProductLinksFromCSV(userMessage);
    if (productLinks.length > 0) {
      let fallbackResponse = `I found these products for you:\n\n`;
      productLinks.slice(0, 5).forEach(link => {
        fallbackResponse += `• ${link}\n`;
      });
      return fallbackResponse;
    }
    
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our premium lifestyle products with 100-minute delivery in Gurgaon!";
  }
}

// Webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // Extract message and contact info from Gallabox webhook
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    
    console.log(`💬 Received message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      // Use phone number as session ID
      const sessionId = userPhone;
      
      // Get AI response
      const aiResponse = await handleMessage(sessionId, userMessage);
      
      // Send response via Gallabox
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '4.2 - Fixed CSV Integration',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      csv_integration: 'Dynamic product links from GitHub CSVs',
      smart_matching: 'Keyword-based category matching',
      fallback_system: 'Static categories when CSV fails',
      whatsapp_integration: 'Gallabox API integration'
    },
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length,
      status: csvInitialized ? 'Active' : 'Fallback Mode',
      csv_urls: {
        categories: process.env.CATEGORIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv',
        galleries: process.env.GALLERIES_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv'
      }
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      csv_status: 'GET /csv-status',
      search_products: 'GET /search-products',
      refresh_data: 'POST /refresh-csv-data'
    },
    timestamp: new Date().toISOString()
  });
});

// CSV data status endpoint
app.get('/csv-status', (req, res) => {
  res.json({
    initialized: csvInitialized,
    categories: {
      count: categoriesData.length,
      sample: categoriesData.slice(0, 2),
      source: process.env.CATEGORIES_CSV_URL || 'Using default URL'
    },
    galleries: {
      count: galleriesData.length,
      sample: galleriesData.slice(0, 2),
      source: process.env.GALLERIES_CSV_URL || 'Using default URL'
    },
    static_fallback: !csvInitialized,
    last_updated: new Date().toISOString()
  });
});

// Test product search endpoint
app.get('/search-products', async (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ 
      error: 'Missing query parameter "q"',
      example: '/search-products?q=dress' 
    });
  }
  
  try {
    const productLinks = getProductLinksFromCSV(query);
    
    res.json({
      query: query,
      matching_links: productLinks,
      total_found: productLinks.length,
      data_sources: {
        categories_used: categoriesData.length,
        galleries_used: galleriesData.length,
        using_fallback: !csvInitialized
      },
      search_process: {
        step1: 'Find matching category IDs in categories1.csv',
        step2: 'Look up type2 names in galleries1.csv using cat1 column',
        step3: 'Generate links with app.zulu.club/ prefix and %20 for spaces'
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Search failed',
      details: error.message 
    });
  }
});

// Test endpoint to send a message manually
app.post('/send-test-message', async (req, res) => {
  try {
    const { to, name, message } = req.body;
    
    if (!to) {
      return res.status(400).json({ 
        error: 'Missing "to" in request body',
        example: { 
          "to": "918368127760", 
          "name": "Rishi",
          "message": "What products do you have?" 
        }
      });
    }
    
    const result = await sendMessage(
      to, 
      name || 'Test User', 
      message || 'Hello! This is a test message from Zulu Club AI Assistant. 🚀'
    );
    
    res.json({ 
      status: 'success', 
      message: 'Test message sent successfully',
      data: result 
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to send test message',
      details: error.message
    });
  }
});

// Refresh CSV data endpoint
app.post('/refresh-csv-data', async (req, res) => {
  try {
    await initializeWithRetry();
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully',
      data: {
        categories_count: categoriesData.length,
        galleries_count: galleriesData.length,
        csv_initialized: csvInitialized
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to refresh CSV data',
      details: error.message
    });
  }
});

// Export for Vercel
module.exports = app;

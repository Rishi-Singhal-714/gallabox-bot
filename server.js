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

// Function to load CSV data from GitHub
async function loadCSVFromGitHub(csvUrl) {
  try {
    console.log(`📥 Loading CSV from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    const results = [];
    
    return new Promise((resolve, reject) => {
      const stream = Readable.from(response.data);
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} rows from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ CSV parsing error:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading CSV from GitHub:', error.message);
    return [];
  }
}

// Initialize CSV data
async function initializeCSVData() {
  try {
    console.log('🔄 Initializing CSV data from GitHub...');
    
    // Load categories1.csv
    const categoriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/blob/main/categories1.csv';
    categoriesData = await loadCSVFromGitHub(categoriesUrl);
    
    // Load galleries1.csv
    const galleriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/blob/main/galleries1.csv';
    galleriesData = await loadCSVFromGitHub(galleriesUrl);
    
    console.log(`📊 Categories data loaded: ${categoriesData.length} rows`);
    console.log(`📊 Galleries data loaded: ${galleriesData.length} rows`);
  } catch (error) {
    console.error('❌ Error initializing CSV data:', error);
  }
}

// Initialize on startup
initializeCSVData();

// Function to find matching category IDs based on user message
function findMatchingCategoryIds(userMessage) {
  if (!categoriesData.length) return [];
  
  const message = userMessage.toLowerCase();
  const matchingIds = new Set();
  
  categoriesData.forEach(row => {
    // Check if any column contains keywords that match the user message
    Object.values(row).forEach(value => {
      if (value && typeof value === 'string') {
        const keywords = value.toLowerCase().split(/[,\s]+/);
        keywords.forEach(keyword => {
          if (keyword.length > 2 && message.includes(keyword)) {
            if (row.id) {
              matchingIds.add(row.id.toString());
            }
          }
        });
      }
    });
  });
  
  return Array.from(matchingIds);
}

// Function to get type2 names from galleries based on category IDs
function getType2NamesFromGalleries(categoryIds) {
  if (!galleriesData.length || !categoryIds.length) return [];
  
  const type2Names = new Set();
  
  galleriesData.forEach(row => {
    if (row.cat1 && categoryIds.includes(row.cat1.toString()) && row.type2) {
      type2Names.add(row.type2.trim());
    }
  });
  
  return Array.from(type2Names);
}

// Function to generate links from type2 names
function generateLinksFromType2(type2Names) {
  return type2Names.map(name => {
    // Replace spaces with %20 and create link
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// NEW LOGIC: Function to get product links based on user message
function getProductLinksFromCSV(userMessage) {
  try {
    console.log('🔍 Searching for products in CSV data...');
    
    // Step 1: Find matching category IDs
    const matchingCategoryIds = findMatchingCategoryIds(userMessage);
    console.log(`📋 Matching category IDs:`, matchingCategoryIds);
    
    if (!matchingCategoryIds.length) {
      console.log('❌ No matching category IDs found');
      return [];
    }
    
    // Step 2: Get type2 names from galleries
    const type2Names = getType2NamesFromGalleries(matchingCategoryIds);
    console.log(`📝 Found type2 names:`, type2Names);
    
    if (!type2Names.length) {
      console.log('❌ No type2 names found for the category IDs');
      return [];
    }
    
    // Step 3: Generate links
    const links = generateLinksFromType2(type2Names);
    console.log(`🔗 Generated links:`, links);
    
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
    
    // NEW: Get product links from CSV based on user message
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
      productLinks.forEach(link => {
        response += `• ${link}\n`;
      });
      response += `\nVisit these links to explore products! 🚀`;
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    
    // Fallback to CSV-based response for product queries
    const productLinks = getProductLinksFromCSV(userMessage);
    if (productLinks.length > 0) {
      let fallbackResponse = `I found these products matching your search:\n\n`;
      productLinks.forEach(link => {
        fallbackResponse += `• ${link}\n`;
      });
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
      productLinks.forEach(link => {
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
    version: '4.0 - CSV Integration',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      csv_integration: 'Dynamic product links from GitHub CSVs',
      smart_matching: 'Keyword-based category matching',
      whatsapp_integration: 'Gallabox API integration'
    },
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length,
      status: categoriesData.length > 0 ? 'Active' : 'Loading'
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      csv_status: 'GET /csv-status',
      search_products: 'GET /search-products'
    },
    timestamp: new Date().toISOString()
  });
});

// New endpoint: CSV data status
app.get('/csv-status', (req, res) => {
  res.json({
    categories: {
      count: categoriesData.length,
      sample: categoriesData.slice(0, 3)
    },
    galleries: {
      count: galleriesData.length,
      sample: galleriesData.slice(0, 3)
    },
    last_updated: new Date().toISOString()
  });
});

// New endpoint: Test product search
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
    await initializeCSVData();
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully',
      data: {
        categories_count: categoriesData.length,
        galleries_count: galleriesData.length
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

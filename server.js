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

// Store conversations and CSV data
let conversations = {};
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

// Load galleries CSV data
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv');
    
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(response.data);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Map CSV columns to our expected format
          const mappedData = {
            type2: data.type2 || data.Type2 || '',
            cat_id: data.cat_id || data.cat_id || '',
            cat1: data.cat1 || data.Cat1 || ''
          };
          results.push(mappedData);
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

// Initialize CSV data on server start
loadGalleriesData().then(data => {
  galleriesData = data;
}).catch(error => {
  console.error('Failed to load galleries data:', error);
});

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

// Enhanced AI Chat Functionality with Intent Detection
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // First, detect intent
    const intent = await detectIntent(userMessage);
    console.log(`🎯 Detected intent: ${intent}`);
    
    // If product intent, find relevant categories and generate links
    if (intent === 'product' && galleriesData.length > 0) {
      const productResponse = await handleProductIntent(userMessage);
      return productResponse;
    }
    
    // Otherwise, use company response logic
    return await generateCompanyResponse(userMessage, conversationHistory, companyInfo);
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! Visit zulu.club to explore our products or ask me anything! 🛍️";
  }
}

// Intent Detection Function
async function detectIntent(userMessage) {
  try {
    const prompt = `
    Analyze the following user message and determine if the intent is:
    - "company": Asking about Zulu Club as a company, services, delivery, returns, general information
    - "product": Asking about specific products, categories, items, shopping, browsing, what's available

    User Message: "${userMessage}"

    Respond with ONLY one word: either "company" or "product"
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are an intent classifier. Analyze the user's message and determine if they're asking about the company in general or about specific products. Respond with only one word: 'company' or 'product'."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    });

    const intent = completion.choices[0].message.content.trim().toLowerCase();
    return intent === 'product' ? 'product' : 'company';
    
  } catch (error) {
    console.error('Error in intent detection:', error);
    return 'company'; // Default to company intent on error
  }
}

// Product Intent Handler
async function handleProductIntent(userMessage) {
  try {
    // Extract product keywords using GPT
    const productKeywords = await extractProductKeywords(userMessage);
    console.log(`🔍 Extracted product keywords:`, productKeywords);
    
    // Find matching categories
    const matchingCategories = findMatchingCategories(productKeywords);
    console.log(`📋 Found ${matchingCategories.length} matching categories`);
    
    // Generate response with links
    return generateProductResponse(matchingCategories, userMessage);
    
  } catch (error) {
    console.error('Error handling product intent:', error);
    return generateFallbackProductResponse();
  }
}

// Extract Product Keywords using GPT
async function extractProductKeywords(userMessage) {
  try {
    const prompt = `
    Extract product-related keywords from the user's message. Focus on:
    - Product types (shirts, dresses, shoes, home decor, etc.)
    - Categories (fashion, beauty, home, kids, etc.)
    - Specific items they might be looking for

    User Message: "${userMessage}"

    Return the keywords as a comma-separated list. Be broad and inclusive in your interpretation.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a keyword extractor for shopping queries. Extract relevant product keywords from the user's message and return them as a comma-separated list."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0.3
    });

    const keywordsText = completion.choices[0].message.content.trim();
    const keywords = keywordsText.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
    
    return keywords;
    
  } catch (error) {
    console.error('Error extracting keywords:', error);
    // Fallback: simple keyword extraction
    return userMessage.toLowerCase().split(' ').filter(word => 
      word.length > 3 && !['what', 'where', 'when', 'how', 'show', 'looking', 'want', 'need'].includes(word)
    );
  }
}

// Find Matching Categories in CSV Data
function findMatchingCategories(keywords) {
  const matches = [];
  
  galleriesData.forEach(item => {
    const cat1 = item.cat1?.toLowerCase() || '';
    const type2 = item.type2?.toLowerCase() || '';
    
    // Check if any keyword matches cat1 or type2
    const hasMatch = keywords.some(keyword => 
      cat1.includes(keyword) || 
      type2.includes(keyword) ||
      keyword.includes(cat1) ||
      keyword.includes(type2)
    );
    
    if (hasMatch && item.cat1 && item.type2) {
      matches.push({
        category: item.cat1,
        type2: item.type2,
        cat_id: item.cat_id
      });
    }
  });
  
  // Sort by cat_id (men, women, kids, home, etc.)
  matches.sort((a, b) => {
    const idA = parseInt(a.cat_id) || 0;
    const idB = parseInt(b.cat_id) || 0;
    return idA - idB;
  });
  
  // Remove duplicates based on type2
  const uniqueMatches = [];
  const seenType2 = new Set();
  
  matches.forEach(match => {
    if (!seenType2.has(match.type2)) {
      seenType2.add(match.type2);
      uniqueMatches.push(match);
    }
  });
  
  return uniqueMatches.slice(0, 5); // Return top 5 matches
}

// Generate Product Response with Links
function generateProductResponse(matchingCategories, userMessage) {
  if (matchingCategories.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Great! Based on your interest in "${userMessage}", here are some perfect categories for you: 🛍️\n\n`;
  
  matchingCategories.forEach(category => {
    const link = `app.zulu.club/${category.type2.replace(/ /g, '%20')}`;
    response += `• ${category.category}: ${link}\n`;
  });
  
  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;
  
  // Ensure response is within WhatsApp limits
  if (response.length > 1500) {
    response = response.substring(0, 1500) + '...\n\nVisit zulu.club for more categories!';
  }
  
  return response;
}

// Fallback Product Response
function generateFallbackProductResponse() {
  return `🎉 Exciting news! Zulu Club offers amazing products across all categories:\n\n• 👗 Women's Fashion\n• 👔 Men's Fashion\n• 👶 Kids & Toys\n• 🏠 Home Decor\n• 💄 Beauty & Self-Care\n• 👠 Footwear\n• 👜 Accessories\n• 🎁 Lifestyle Gifting\n\nExperience 100-minute delivery in Gurgaon! 🚀\n\nBrowse all categories at: zulu.club\nOr tell me what specific products you're looking for!`;
}

// Company Response Generator (existing logic)
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  const messages = [];
  
  // System message with Zulu Club information
  const systemMessage = {
    role: "system",
    content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
    
    ZULU CLUB INFORMATION:
    ${companyInfo}

    IMPORTANT RESPONSE GUIDELINES:
    1. **Keep responses conversational** and helpful
    2. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
    3. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
    4. **Use emojis** to make it engaging but professional
    5. **Keep responses under 400 characters** for WhatsApp compatibility
    6. **Be enthusiastic and helpful** - we're excited about our products!
    7. **Direct users to our website** zulu.club for more information and shopping
    8. **Focus on our service experience** rather than specific categories

    Remember: Be a helpful guide to Zulu Club's overall shopping experience and service.
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
  
  return completion.choices[0].message.content.trim();
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
    
    // Get AI response with intent detection
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
    version: '4.0 - Enhanced with Intent Detection & Product Links',
    features: {
      intent_detection: 'AI-powered company vs product intent classification',
      product_matching: 'CSV-based product category matching',
      link_generation: 'Dynamic app.zulu.club link generation',
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      whatsapp_integration: 'Gallabox API integration',
      conversation_memory: 'Session-based conversation history'
    },
    stats: {
      product_categories_loaded: galleriesData.length,
      active_conversations: Object.keys(conversations).length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      refresh_csv: 'GET /refresh-csv'
    },
    timestamp: new Date().toISOString()
  });
});

// Endpoint to refresh CSV data
app.get('/refresh-csv', async (req, res) => {
  try {
    const newData = await loadGalleriesData();
    galleriesData = newData;
    
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully',
      categories_loaded: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: error.message
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

// Export for Vercel
module.exports = app;

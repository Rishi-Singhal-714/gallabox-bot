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

// NEW: Sellers data store
let sellersData = []; // { store_name, user_id }

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
            cat_id: data.cat_id || data.cat_id || data.CAT_ID || '',
            cat1: data.cat1 || data.Cat1 || data.CAT1 || ''
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

// NEW: Load Sellers CSV data
async function loadSellersData() {
  try {
    const sellersUrl = process.env.SELLERS_CSV_URL || 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv';
    console.log('📥 Loading sellers CSV data from:', sellersUrl);
    const response = await axios.get(sellersUrl, { timeout: 60000 });

    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('❌ Empty Sellers CSV data received');
        resolve([]);
        return;
      }

      const stream = Readable.from(response.data);

      stream
        .pipe(csv())
        .on('data', (data) => {
          const store_name = data.store_name || data.Store_Name || data.store || data.STORE_NAME || '';
          const user_id = data.user_id || data.User_Id || data.UserID || data.USER_ID || '';
          if (store_name && user_id) {
            results.push({ store_name: String(store_name).trim(), user_id: String(user_id).trim() });
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} sellers from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ Error parsing Sellers CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading Sellers CSV data:', error.message);
    return [];
  }
}

// Initialize CSV data on server start
loadGalleriesData().then(data => {
  galleriesData = data;
}).catch(error => {
  console.error('Failed to load galleries data:', error);
});

// NEW: Initialize Sellers CSV on server start
loadSellersData().then(data => {
  sellersData = data;
}).catch(error => {
  console.error('Failed to load sellers data:', error);
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

// NEW: Keyword matching function for cat1 column
function findKeywordMatchesInCat1(userMessage) {
  if (!userMessage || !galleriesData.length) return [];
  
  const searchTerms = userMessage.toLowerCase().split(/\s+/).filter(term => term.length > 2);
  console.log(`🔍 Searching for keywords in cat1:`, searchTerms);
  
  const matches = [];
  const clothingKeywords = ['clothing', 'apparel', 'wear', 'shirt', 'pant', 'dress', 'top', 'bottom', 'jacket', 'sweater'];
  
  galleriesData.forEach(item => {
    if (!item.cat1) return;
    
    const cat1Categories = item.cat1.toLowerCase().split(',').map(cat => cat.trim());
    
    for (const searchTerm of searchTerms) {
      for (const category of cat1Categories) {
        // Skip if it's a clothing-related category
        const isClothing = clothingKeywords.some(clothing => category.includes(clothing));
        if (isClothing) continue;
        
        // Check for exact match or high similarity
        if (category === searchTerm) {
          // Exact match
          if (!matches.some(m => m.type2 === item.type2)) {
            matches.push({
              ...item,
              matchType: 'exact',
              matchedTerm: searchTerm,
              score: 1.0
            });
          }
        } else if (calculateSimilarity(category, searchTerm) >= 0.9) {
          // 90%+ similarity match
          if (!matches.some(m => m.type2 === item.type2)) {
            matches.push({
              ...item,
              matchType: 'similar',
              matchedTerm: searchTerm,
              score: calculateSimilarity(category, searchTerm)
            });
          }
        }
      }
    }
  });
  
  console.log(`🎯 Found ${matches.length} keyword matches in cat1`);
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// NEW: Calculate string similarity (simple Levenshtein-based)
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  // Check if one string contains the other
  if (longer.includes(shorter)) return 0.95;
  
  // Simple character-based similarity
  const commonChars = [...shorter].filter(char => longer.includes(char)).length;
  return commonChars / longer.length;
}

// NEW: Check if user message contains men/women/kids
function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men', 'women', 'kids', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
  const message = userMessage.toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

// NEW: Find similar sellers for a given type2 against sellers.store_name
function findSimilarSellersByType2(type2) {
  if (!type2 || !sellersData.length) return [];
  const t = String(type2).toLowerCase().trim();

  const scored = sellersData.map(s => {
    const name = String(s.store_name || '').toLowerCase().trim();
    let score = 0;
    if (!name) return null;

    // prioritize substring and similarity
    if (name.includes(t) || t.includes(name)) {
      score = 0.95;
    } else {
      score = calculateSimilarity(name, t);
    }
    return { ...s, _score: score };
  }).filter(Boolean);

  const matches = scored
    .filter(s => s._score >= 0.9)
    .sort((a, b) => b._score - a._score)
    .slice(0, 2); // up to 2 sellers per category

  return matches;
}

// NEW: Build seller links text block for a given type2
function buildSellerLinksSection(type2) {
  const sellers = findSimilarSellersByType2(type2);
  if (!sellers.length) return '';

  const lines = sellers.map(s => `      • Seller: ${s.store_name} — app.zulu.club/sellerassets/${s.user_id}`).join('\n');
  return `\n   🛍️ You can also shop directly from:\n${lines}\n`;
}

// Enhanced AI Chat Functionality with Dual Matching Strategy
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // First, detect intent
    const intent = await detectIntent(userMessage);
    console.log(`🎯 Detected intent: ${intent}`);
    
    // If product intent, use appropriate matching strategy
    if (intent === 'product' && galleriesData.length > 0) {
      // Check if user is looking for clothing items
      const isClothingQuery = containsClothingKeywords(userMessage);
      
      if (isClothingQuery) {
        console.log('👕 Clothing-related query detected, using GPT matching');
        const productResponse = await handleProductIntentWithGPT(userMessage);
        return productResponse;
      } else {
        console.log('🛍️ Non-clothing query, trying keyword matching first');
        // First try keyword matching in cat1
        const keywordMatches = findKeywordMatchesInCat1(userMessage);
        
        if (keywordMatches.length > 0) {
          console.log(`✅ Found ${keywordMatches.length} keyword matches, using them`);
          return generateProductResponseFromMatches(keywordMatches, userMessage);
        } else {
          console.log('🔍 No keyword matches found, falling back to GPT matching');
          const productResponse = await handleProductIntentWithGPT(userMessage);
          return productResponse;
        }
      }
    }
    
    // Otherwise, use company response logic
    return await generateCompanyResponse(userMessage, conversationHistory, companyInfo);
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! Visit zulu.club to explore our products or ask me anything! 🛍️";
  }
}

// NEW: Generate response from keyword matches
function generateProductResponseFromMatches(matches, userMessage) {
  if (matches.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Perfect! Based on your search for "${userMessage}", I found these matching categories: 🛍️\n\n`;
  
  matches.forEach((match, index) => {
    const link = `app.zulu.club/${match.type2.replace(/ /g, '%20')}`;
    const displayCategories = match.type2.split(',').slice(0, 2).join(', ');
    const matchInfo = match.matchType === 'exact' ? '✅ Exact match' : '🔍 Similar match';
    
    response += `${index + 1}. ${displayCategories}\n   ${matchInfo}\n   🔗 ${link}`;
    // NEW: Append seller links (if any) for this type2
    response += buildSellerLinksSection(match.type2);
    response += `\n`;
  });
  
  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;
  
  if (response.length > 1500) {
    response = response.substring(0, 1500) + '...\n\nVisit zulu.club for more categories!';
  }
  
  return response;
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
    return 'company';
  }
}

// GPT-Powered Product Intent Handler
async function handleProductIntentWithGPT(userMessage) {
  try {
    // Prepare CSV data for GPT
    const csvDataForGPT = galleriesData.map(item => ({
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id
    }));

    const prompt = `
    USER MESSAGE: "${userMessage}"

    AVAILABLE PRODUCT CATEGORIES (from CSV):
    ${JSON.stringify(csvDataForGPT, null, 2)}

    TASK:
    1. Understand what product the user is looking for (even if misspelled or incomplete like "tshir" for "t-shirt")
    2. Find the BEST matching categories from the CSV data
    3. Return the top 5 most relevant matches in JSON format

    MATCHING RULES:
    - Be intelligent about matching: "tshir" → "T Shirts", "fountain" → "Home Decor", "makeup" → "Beauty"
    - Consider synonyms and related products
    - Look for any match in the cat1 field (which contains multiple categories separated by commas)
    - Prioritize closer matches

    RESPONSE FORMAT:
    {
      "matches": [
        {
          "type2": "exact-type2-value-from-csv",
          "reason": "brief explanation why this matches",
          "relevance_score": 0.9
        }
      ]
    }

    Only return JSON, no additional text.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product matching expert for Zulu Club. You match user queries to product categories intelligently. 
          You understand misspellings, abbreviations, and related terms. Always return valid JSON with matches array.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('🤖 GPT Product Matching Response:', responseText);
    
    let matches;
    try {
      matches = JSON.parse(responseText).matches;
    } catch (parseError) {
      console.error('Error parsing GPT response:', parseError);
      matches = [];
    }

    if (!matches || matches.length === 0) {
      return generateFallbackProductResponse();
    }

    // Get the actual category data for the matched type2 values
    const matchedCategories = matches
      .map(match => {
        const category = galleriesData.find(item => item.type2 === match.type2);
        return category ? { ...category, reason: match.reason } : null;
      })
      .filter(Boolean)
      .slice(0, 5);

    console.log(`🎯 Final matched categories:`, matchedCategories);
    return generateProductResponseWithGPT(matchedCategories, userMessage);
    
  } catch (error) {
    console.error('Error in GPT product matching:', error);
    return generateFallbackProductResponse();
  }
}

// Generate Product Response with GPT-Matched Categories
function generateProductResponseWithGPT(matchedCategories, userMessage) {
  if (matchedCategories.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Perfect! Based on your interest in "${userMessage}", I found these great categories for you: 🛍️\n\n`;
  
  matchedCategories.forEach((category, index) => {
    const link = `app.zulu.club/${category.type2.replace(/ /g, '%20')}`;
    // Clean up the category display
    const displayCategories = category.type2.split(',').slice(0, 2).join(', ');
    response += `${index + 1}. ${displayCategories}\n   🔗 ${link}`;
    // NEW: Append seller links (if any) for this type2
    response += buildSellerLinksSection(category.type2);
    response += `\n`;
  });
  
  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;
  
  if (response.length > 1500) {
    response = response.substring(0, 1500) + '...\n\nVisit zulu.club for more categories!';
  }
  
  return response;
}

// Fallback Product Response
function generateFallbackProductResponse() {
  return `🎉 Exciting news! Zulu Club offers amazing products across all categories:\n\n• 👗 Women's Fashion (Dresses, Jewellery, Handbags)\n• 👔 Men's Fashion (Shirts, T-Shirts, Kurtas)\n• 👶 Kids & Toys\n• 🏠 Home Decor\n• 💄 Beauty & Self-Care\n• 👠 Footwear & Sandals\n• 👜 Accessories\n• 🎁 Lifestyle Gifting\n\nExperience 100-minute delivery in Gurgaon! 🚀\n\nBrowse all categories at: zulu.club\nOr tell me what specific products you're looking for!`;
}

// Company Response Generator
async function generateCompanyResponse(userMessage, conversationHistory, companyInfo) {
  const messages = [];
  
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
    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [] };
    }
    
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage
    });
    
    const aiResponse = await getChatGPTResponse(
      userMessage, 
      conversations[sessionId].history
    );
    
    conversations[sessionId].history.push({
      role: "assistant",
      content: aiResponse
    });
    
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
    
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    
    console.log(`💬 Received message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      const sessionId = userPhone;
      const aiResponse = await handleMessage(sessionId, userMessage);
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
    version: '6.0 - Enhanced Keyword + GPT Matching',
    features: {
      keyword_matching: 'Exact/90% matches in cat1 column (non-clothing)',
      clothing_detection: 'Automatically detects men/women/kids queries',
      gpt_matching: 'GPT-powered intelligent product matching',
      dual_strategy: 'Keyword first, GPT fallback for non-clothing queries',
      intelligent_matching: 'Understands misspellings and related terms',
      link_generation: 'Dynamic app.zulu.club link generation',
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      whatsapp_integration: 'Gallabox API integration',
      // NEW:
      seller_linking: 'Match type2 to seller store_name and append seller asset links'
    },
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length, // NEW
      active_conversations: Object.keys(conversations).length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      refresh_csv: 'GET /refresh-csv',
      refresh_sellers: 'GET /refresh-sellers', // NEW
      test_keyword_matching: 'GET /test-keyword-matching',
      test_gpt_matching: 'GET /test-gpt-matching'
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

// NEW: Endpoint to refresh Sellers CSV
app.get('/refresh-sellers', async (req, res) => {
  try {
    const newData = await loadSellersData();
    sellersData = newData;

    res.json({
      status: 'success',
      message: 'Sellers CSV data refreshed successfully',
      sellers_loaded: sellersData.length
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// NEW: Test keyword matching endpoint
app.get('/test-keyword-matching', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const isClothing = containsClothingKeywords(query);
    const keywordMatches = findKeywordMatchesInCat1(query);
    const response = generateProductResponseFromMatches(keywordMatches, query);
    
    res.json({
      query,
      is_clothing_query: isClothing,
      keyword_matches: keywordMatches,
      response_preview: response,
      categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length // NEW
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test GPT matching endpoint
app.get('/test-gpt-matching', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const result = await handleProductIntentWithGPT(query);
    
    res.json({
      query,
      result: result,
      categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length // NEW
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

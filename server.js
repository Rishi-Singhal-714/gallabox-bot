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

// Enhanced AI Chat Functionality with GPT-Powered Product Matching
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // First, detect intent
    const intent = await detectIntent(userMessage);
    console.log(`🎯 Detected intent: ${intent}`);
    
    // If product intent, use traditional matching FIRST for exact/80% matches in BOTH cat1 AND type2
    if (intent === 'product' && galleriesData.length > 0) {
      console.log(`🔍 Checking for exact/80% matches in BOTH cat1 AND type2 from ${galleriesData.length} categories`);
      
      // FIRST: Try traditional exact/80% matching in BOTH cat1 AND type2
      const traditionalMatches = await handleProductIntentTraditional(userMessage);
      
      // If we found exact or 80% matches in EITHER cat1 OR type2, return ALL related galleries
      const exactOrHighMatches = traditionalMatches.filter(match => 
        match.relevance_score >= 2.0 // Exact or high confidence matches in either field
      );
      
      if (exactOrHighMatches.length > 0) {
        console.log(`🎯 Found ${exactOrHighMatches.length} exact/high matches in cat1/type2, returning ALL related galleries`);
        return generateResponseForExactMatches(exactOrHighMatches, userMessage);
      }
      
      // SECOND: If no exact matches, use GPT for intelligent matching
      console.log(`🔍 No exact matches found, using GPT for intelligent matching`);
      const productResponse = await handleProductIntentWithGPT(userMessage);
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
    return 'company';
  }
}

// UPDATED: Traditional keyword-based matching with EXACT/80% priority for BOTH cat1 AND type2
async function handleProductIntentTraditional(userMessage) {
  console.log('🔍 Using traditional keyword matching with BOTH cat1 AND type2 priority...');
  
  const searchTerms = userMessage.toLowerCase().split(/\s+/).filter(term => term.length > 2);
  const matches = [];

  // If no meaningful search terms, return empty
  if (searchTerms.length === 0) {
    return matches;
  }

  // Search through galleries data
  galleriesData.forEach(item => {
    let score = 0;
    let matchedField = '';
    let reason = '';
    let matchedTerm = '';

    // PRIORITY 1: Exact or 80% matches in cat1 (comma-separated categories)
    if (item.cat1) {
      const cat1Categories = item.cat1.toLowerCase().split(',').map(cat => cat.trim());
      
      searchTerms.forEach(term => {
        cat1Categories.forEach(catTerm => {
          // Exact match in cat1 - HIGHEST SCORE
          if (catTerm === term) {
            score += 3.0;
            matchedField = 'cat1';
            matchedTerm = term;
            reason = `Exact match for "${term}" in categories: ${item.cat1}`;
          }
          // 80% match (contains the term) in cat1 - HIGH SCORE
          else if (catTerm.includes(term)) {
            score += 2.5;
            matchedField = 'cat1';
            matchedTerm = term;
            reason = `High match for "${term}" in categories: ${item.cat1}`;
          }
          // Partial match in cat1 - MEDIUM SCORE
          else if (term.includes(catTerm.substring(0, 4)) || catTerm.includes(term.substring(0, 4))) {
            score += 1.5;
            if (!matchedField) {
              matchedField = 'cat1';
              matchedTerm = term;
              reason = `Partial match for "${term}" in categories: ${item.cat1}`;
            }
          }
        });
      });
    }

    // PRIORITY 2: Exact or 80% matches in type2
    if (item.type2) {
      const type2Lower = item.type2.toLowerCase();
      
      searchTerms.forEach(term => {
        // Exact match in type2 - HIGH SCORE (same as cat1 80% match)
        if (type2Lower === term) {
          score += 2.5;
          matchedField = 'type2';
          matchedTerm = term;
          reason = `Exact match for "${term}" in category: ${item.type2}`;
        }
        // 80% match (contains term) in type2 - GOOD SCORE
        else if (type2Lower.includes(term)) {
          score += 2.0;
          if (!matchedField || matchedField === 'type2') {
            matchedField = 'type2';
            matchedTerm = term;
            reason = `High match for "${term}" in category: ${item.type2}`;
          }
        }
        // Partial match in type2 - LOWER SCORE
        else if (term.includes(type2Lower.substring(0, 4)) || type2Lower.includes(term.substring(0, 4))) {
          score += 1.0;
          if (!matchedField) {
            matchedField = 'type2';
            matchedTerm = term;
            reason = `Partial match for "${term}" in category: ${item.type2}`;
          }
        }
      });
    }

    if (score > 0) {
      matches.push({
        ...item,
        relevance_score: score,
        matched_field: matchedField,
        reason: reason,
        matched_term: matchedTerm
      });
    }
  });

  // Sort by relevance score (highest first) - exact matches will be at top
  matches.sort((a, b) => b.relevance_score - a.relevance_score);
  
  console.log(`📊 Traditional matching found ${matches.length} matches, top scores:`, 
    matches.slice(0, 5).map(m => ({ 
      type2: m.type2, 
      score: m.relevance_score, 
      field: m.matched_field,
      term: m.matched_term 
    }))
  );
  
  return matches;
}

// UPDATED: Generate response for EXACT matches in BOTH cat1 AND type2 - return ALL related galleries
function generateResponseForExactMatches(matches, userMessage) {
  // Group by matched field and term to organize the response
  const categoryMap = new Map();
  
  matches.forEach(match => {
    const key = `${match.matched_field}:${match.matched_term || 'general'}`;
    if (!categoryMap.has(key)) {
      categoryMap.set(key, []);
    }
    categoryMap.get(key).push(match);
  });

  let response = `🎉 Perfect! I found excellent matches for "${userMessage}" in our catalog. Here are ALL related galleries:\n\n`;

  let galleryCount = 0;
  const maxGalleries = 15; // Increased limit for comprehensive results
  const displayedGalleries = new Set(); // Track unique galleries to avoid duplicates

  // Display cat1 matches first (higher priority)
  const cat1Matches = [];
  const type2Matches = [];
  
  categoryMap.forEach((galleries, key) => {
    if (key.startsWith('cat1:')) {
      cat1Matches.push({ key, galleries });
    } else {
      type2Matches.push({ key, galleries });
    }
  });

  // Process cat1 matches
  if (cat1Matches.length > 0) {
    response += `📂 Category Matches:\n`;
    
    cat1Matches.forEach(({ key, galleries }) => {
      const matchedTerm = key.replace('cat1:', '');
      response += `\n🔍 Based on "${matchedTerm}":\n`;
      
      // Take unique type2 entries (avoid duplicates)
      const uniqueGalleries = [...new Map(galleries.map(item => [item.type2, item])).values()];
      
      uniqueGalleries.slice(0, 8).forEach((gallery, index) => {
        if (galleryCount < maxGalleries && !displayedGalleries.has(gallery.type2)) {
          const link = `app.zulu.club/${gallery.type2.replace(/ /g, '%20')}`;
          response += `   ${galleryCount + 1}. ${gallery.type2}\n      🔗 ${link}\n`;
          displayedGalleries.add(gallery.type2);
          galleryCount++;
        }
      });
    });
  }

  // Process type2 matches (if we have space and they're not already displayed)
  if (type2Matches.length > 0 && galleryCount < maxGalleries) {
    response += `\n📂 Direct Category Matches:\n`;
    
    type2Matches.forEach(({ key, galleries }) => {
      const matchedTerm = key.replace('type2:', '');
      
      // Take unique type2 entries (avoid duplicates)
      const uniqueGalleries = [...new Map(galleries.map(item => [item.type2, item])).values()];
      
      uniqueGalleries.slice(0, 5).forEach((gallery, index) => {
        if (galleryCount < maxGalleries && !displayedGalleries.has(gallery.type2)) {
          const link = `app.zulu.club/${gallery.type2.replace(/ /g, '%20')}`;
          response += `   ${galleryCount + 1}. ${gallery.type2}\n      🔗 ${link}\n`;
          displayedGalleries.add(gallery.type2);
          galleryCount++;
        }
      });
    });
  }

  response += `\n✨ With Zulu Club, enjoy:\n• 100-minute delivery in Gurgaon\n• Try products at home\n• Easy returns\n• Premium quality\n\nClick any link above to start shopping! 🚀`;

  // If we found many galleries, show count
  if (galleryCount >= maxGalleries) {
    response += `\n\n📚 And ${matches.length - maxGalleries} more galleries available! Visit zulu.club for complete catalog.`;
  }

  // If message is too long, truncate intelligently
  if (response.length > 1500) {
    response = response.substring(0, 1500) + `\n\n... and ${galleryCount - 10} more galleries! Visit zulu.club for complete catalog.`;
  }

  return response;
}

// GPT-Powered Product Intent Handler (for non-exact matches)
async function handleProductIntentWithGPT(userMessage) {
  try {
    // Prepare CSV data for GPT with BOTH cat1 and type2
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
    1. Understand what product the user is looking for (even if misspelled or incomplete)
    2. Find the BEST matching categories from the CSV data by searching BOTH fields:
       - PRIMARY SEARCH: "cat1" field (contains multiple categories separated by commas) - HIGHEST PRIORITY
       - SECONDARY SEARCH: "type2" field (single category name) - SECOND PRIORITY
    3. Return the top 5 most relevant matches in JSON format

    MATCHING RULES (PRIORITY ORDER):
    1. FIRST check "cat1" field (contains comma-separated categories) - HIGHEST PRIORITY
    2. THEN check "type2" field - SECOND PRIORITY
    3. Be intelligent about matching: "tshir" → "T Shirts", "fountain" → "Home Decor", "makeup" → "Beauty"
    4. Consider synonyms and related products
    5. Prioritize closer matches in cat1 over type2

    RESPONSE FORMAT:
    {
      "matches": [
        {
          "type2": "exact-type2-value-from-csv",
          "cat1": "exact-cat1-value-from-csv",
          "reason": "brief explanation why this matches and which field matched (cat1 or type2)",
          "relevance_score": 0.9,
          "matched_field": "cat1" // or "type2"
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
          You understand misspellings, abbreviations, and related terms. You search BOTH cat1 (priority 1) and type2 (priority 2) fields.
          Always return valid JSON with matches array.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1500,
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
        const category = galleriesData.find(item => 
          item.type2 === match.type2 && item.cat1 === match.cat1
        );
        return category ? { 
          ...category, 
          reason: match.reason,
          matched_field: match.matched_field,
          relevance_score: match.relevance_score 
        } : null;
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

// Generate Product Response with GPT-Matched Categories (for non-exact matches)
function generateProductResponseWithGPT(matchedCategories, userMessage) {
  if (matchedCategories.length === 0) {
    return generateFallbackProductResponse();
  }
  
  let response = `Perfect! Based on your interest in "${userMessage}", I found these great categories for you: 🛍️\n\n`;
  
  matchedCategories.forEach((category, index) => {
    const link = `app.zulu.club/${category.type2.replace(/ /g, '%20')}`;
    // Clean up the category display - show both cat1 and type2 info
    const displayInfo = category.matched_field === 'cat1' 
      ? `${category.cat1.split(',')[0].trim()} (${category.type2})` 
      : category.type2;
    
    response += `${index + 1}. ${displayInfo}\n   🔗 ${link}\n`;
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
    version: '8.0 - Dual Field Exact Matching (cat1 + type2)',
    features: {
      intent_detection: 'AI-powered company vs product intent classification',
      exact_match_priority: 'Exact/80% matches in BOTH cat1 AND type2 return ALL related galleries',
      product_matching: 'GPT-powered intelligent product matching for non-exact queries',
      dual_field_search: 'Priority: cat1 (primary), type2 (secondary)',
      intelligent_matching: 'Understands misspellings, abbreviations, and related terms',
      link_generation: 'Dynamic app.zulu.club link generation',
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      whatsapp_integration: 'Gallabox API integration'
    },
    stats: {
      product_categories_loaded: galleriesData.length,
      active_conversations: Object.keys(conversations).length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      refresh_csv: 'GET /refresh-csv',
      test_matching: 'GET /test-gpt-matching',
      test_traditional: 'GET /test-traditional-matching',
      test_exact_match: 'GET /test-exact-match'
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
      categories_loaded: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test traditional matching endpoint
app.get('/test-traditional-matching', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const matches = await handleProductIntentTraditional(query);
    
    res.json({
      query,
      matches: matches.slice(0, 10), // Show top 10
      total_matches: matches.length,
      exact_matches: matches.filter(m => m.relevance_score >= 2.0).length,
      cat1_matches: matches.filter(m => m.matched_field === 'cat1').length,
      type2_matches: matches.filter(m => m.matched_field === 'type2').length,
      categories_loaded: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test exact match endpoint
app.get('/test-exact-match', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  
  try {
    const matches = await handleProductIntentTraditional(query);
    const exactMatches = matches.filter(match => match.relevance_score >= 2.0);
    const response = exactMatches.length > 0 
      ? generateResponseForExactMatches(exactMatches, query)
      : "No exact matches found";
    
    res.json({
      query,
      exact_matches_count: exactMatches.length,
      cat1_exact_matches: exactMatches.filter(m => m.matched_field === 'cat1').length,
      type2_exact_matches: exactMatches.filter(m => m.matched_field === 'type2').length,
      response: response,
      all_matches_count: matches.length
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

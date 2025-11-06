const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const fs = require('fs');
const csv = require('csv-parser');

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
let categoriesData = []; // {id, name}
let galleriesData = []; // {cat_id, type2, cat1}

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love.

And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.

Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on zulu.club
`;

// Load CSV files
function loadCSVData() {
  return new Promise((resolve, reject) => {
    // Load categories1.csv
    const categories = [];
    fs.createReadStream('categories1.csv')
      .pipe(csv())
      .on('data', (row) => {
        if (row.id && row.name) {
          categories.push({
            id: row.id.trim(),
            name: row.name.trim()
          });
        }
      })
      .on('end', () => {
        console.log(`✅ Loaded ${categories.length} categories`);
        categoriesData = categories;
        
        // Load galleries1.csv
        const galleries = [];
        fs.createReadStream('galleries1.csv')
          .pipe(csv())
          .on('data', (row) => {
            // Skip rows with null values in any of the three columns
            if (row.cat_id && row.type2 && row.cat1) {
              // Parse cat1 from string format to array
              let cat1Array = [];
              try {
                // Handle formats like ["1908", "1916"] or [1908, 1916]
                const cat1Str = row.cat1.trim();
                if (cat1Str.startsWith('[') && cat1Str.endsWith(']')) {
                  const cleanStr = cat1Str.slice(1, -1).replace(/"/g, '');
                  cat1Array = cleanStr.split(',').map(id => id.trim()).filter(id => id);
                }
              } catch (error) {
                console.warn(`⚠️ Could not parse cat1: ${row.cat1}`);
              }
              
              galleries.push({
                cat_id: row.cat_id.trim(),
                type2: row.type2.trim(),
                cat1: cat1Array
              });
            }
          })
          .on('end', () => {
            console.log(`✅ Loaded ${galleries.length} galleries (after filtering)`);
            galleriesData = galleries;
            resolve();
          })
          .on('error', reject);
      })
      .on('error', reject);
  });
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

// Find top 3 category matches for a query
function findTopCategoryMatches(query, genderContext = null) {
  const queryLower = query.toLowerCase();
  const scoredCategories = [];
  
  // Score each category based on relevance to query
  categoriesData.forEach(category => {
    const categoryNameLower = category.name.toLowerCase();
    let score = 0;
    
    // Exact match
    if (categoryNameLower === queryLower) {
      score += 100;
    }
    
    // Contains query
    if (categoryNameLower.includes(queryLower)) {
      score += 50;
    }
    
    // Query contains category name
    if (queryLower.includes(categoryNameLower)) {
      score += 30;
    }
    
    // Word overlap
    const queryWords = queryLower.split(/\s+/);
    const categoryWords = categoryNameLower.split(/\s+/);
    const commonWords = queryWords.filter(word => 
      categoryWords.some(catWord => catWord.includes(word) || word.includes(catWord))
    );
    score += commonWords.length * 10;
    
    // Gender context matching
    if (genderContext) {
      const genderLower = genderContext.toLowerCase();
      if (categoryNameLower.includes(genderLower)) {
        score += 20;
      }
    }
    
    if (score > 0) {
      scoredCategories.push({
        id: category.id,
        name: category.name,
        score: score
      });
    }
  });
  
  // Sort by score and return top 3
  return scoredCategories
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// Get galleries for category IDs
function getGalleriesForCategories(categoryIds) {
  const galleries = [];
  
  categoryIds.forEach(categoryId => {
    // Find galleries where cat_id matches OR cat1 array contains the categoryId
    const matchingGalleries = galleriesData.filter(gallery => 
      gallery.cat_id === categoryId || 
      gallery.cat1.includes(categoryId)
    );
    
    galleries.push(...matchingGalleries);
  });
  
  // Remove duplicates by type2
  const uniqueGalleries = [];
  const seenType2 = new Set();
  
  galleries.forEach(gallery => {
    if (!seenType2.has(gallery.type2)) {
      seenType2.add(gallery.type2);
      uniqueGalleries.push(gallery);
    }
  });
  
  return uniqueGalleries.slice(0, 6); // Return max 6 galleries
}

// Generate gallery links
function generateGalleryLinks(galleries) {
  return galleries.map(gallery => {
    const encodedType2 = gallery.type2.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedType2}`;
  });
}

// Check if product needs gender clarification
function needsGenderClarification(productQuery) {
  const productLower = productQuery.toLowerCase();
  
  // Gender-specific products that don't need clarification
  const genderSpecificProducts = [
    'lehenga', 'saree', 'sari', 'blouse', 'bra', 'lingerie', 'bikini',
    'dress', 'skirt', 'heels', 'handbag', 'purse', 'makeup', 'lipstick',
    'shirt', 'tie', 'brief', 'boxer', 'shaving', 'razor', 'cologne',
    'diaper', 'pacifier', 'rattle', 'onesie'
  ];
  
  // Ambiguous products that need gender clarification
  const ambiguousProducts = [
    't-shirt', 'tshirt', 'shirt', 'top', 'jeans', 'pants', 'trousers',
    'shoes', 'footwear', 'sneakers', 'jacket', 'sweater', 'hoodie',
    'perfume', 'fragrance', 'watch', 'jewelry', 'accessory'
  ];
  
  const isGenderSpecific = genderSpecificProducts.some(product => 
    productLower.includes(product)
  );
  
  const isAmbiguous = ambiguousProducts.some(product => 
    productLower.includes(product)
  );
  
  return isAmbiguous && !isGenderSpecific;
}

// Handle product inquiry with dynamic category matching
async function handleProductInquiry(userMessage, conversationHistory = []) {
  try {
    let processedMessage = userMessage;
    let genderContext = null;
    
    // Check if gender is already mentioned in conversation
    const recentHistory = conversationHistory.slice(-4);
    const genderKeywords = {
      men: ['men', 'man', 'male', 'boys', 'gents'],
      women: ['women', 'woman', 'female', 'ladies', 'girls'],
      kids: ['kids', 'children', 'child', 'boy', 'girl']
    };
    
    for (const [gender, keywords] of Object.entries(genderKeywords)) {
      if (keywords.some(keyword => 
        userMessage.toLowerCase().includes(keyword) ||
        recentHistory.some(msg => 
          msg.content && msg.content.toLowerCase().includes(keyword)
        )
      )) {
        genderContext = gender;
        break;
      }
    }
    
    // If gender is not clear and product needs clarification, ask for gender
    if (!genderContext && needsGenderClarification(userMessage)) {
      return {
        response: `Great! I'd love to help you find ${userMessage}. Is this for men, women, or kids? 👕👗👶`,
        needsGenderClarification: true,
        originalQuery: userMessage
      };
    }
    
    // Add gender context to message for better matching
    if (genderContext) {
      processedMessage = `${userMessage} for ${genderContext}`;
    }
    
    // Find top 3 category matches
    const topCategories = findTopCategoryMatches(processedMessage, genderContext);
    
    if (topCategories.length === 0) {
      return {
        response: `I couldn't find specific categories for "${userMessage}". Could you try different keywords or browse our general collection at app.zulu.club? 🛍️`,
        categories: [],
        galleries: []
      };
    }
    
    // Get galleries for these categories
    const categoryIds = topCategories.map(cat => cat.id);
    const galleries = getGalleriesForCategories(categoryIds);
    const galleryLinks = generateGalleryLinks(galleries);
    
    // Build response
    let response = `🛍️ *Found ${topCategories.length} relevant categories for you:*\n\n`;
    
    topCategories.forEach((category, index) => {
      response += `${index + 1}. *${category.name}*\n`;
    });
    
    if (galleryLinks.length > 0) {
      response += `\n🎨 *Browse related galleries:*\n`;
      galleryLinks.forEach(link => {
        response += `• ${link}\n`;
      });
    } else {
      response += `\n💫 *Explore all products:* app.zulu.club\n`;
    }
    
    response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`;
    
    return {
      response,
      categories: topCategories,
      galleries: galleries,
      genderContext
    };
    
  } catch (error) {
    console.error('❌ Error in handleProductInquiry:', error);
    return {
      response: `I'm having trouble finding products right now. Please visit app.zulu.club to browse our collection! 🛍️`,
      categories: [],
      galleries: []
    };
  }
}

// AI Chat Functionality
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    const messages = [];
    
    // System message with dynamic category context
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${companyInfo}

      DYNAMIC CATEGORIES AVAILABLE:
      We have ${categoriesData.length} dynamic categories loaded from our database. When users ask about products, you'll use our category matching system to find the most relevant options.

      IMPORTANT RESPONSE GUIDELINES:
      1. **First determine intent**: Is this company info, product inquiry, or general chat?
      2. **For product inquiries**: Let the category matching system handle finding relevant categories and galleries
      3. **For gender-ambiguous products**: Ask "For men, women, or kids?" unless it's obviously gender-specific
      4. **Keep responses conversational** and under 400 characters for WhatsApp
      5. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      6. **Use emojis** to make it engaging but professional
      7. **Be enthusiastic and helpful** - we're excited about our products!

      PRODUCT INQUIRY FLOW:
      - User asks about products → Use category matching system
      - If gender is unclear for ambiguous products → Ask for clarification
      - Once gender is clear → Show relevant categories and gallery links

      Remember: You have access to dynamic category data, so you don't need to know specific categories in advance!
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
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery! What would you like to know? 🛍️";
  }
}

// Handle user message with AI and dynamic categories
async function handleMessage(sessionId, userMessage) {
  try {
    // Initialize conversation if not exists
    if (!conversations[sessionId]) {
      conversations[sessionId] = { 
        history: [],
        pendingGenderClarification: null
      };
    }
    
    const conversation = conversations[sessionId];
    
    // Check if we're waiting for gender clarification
    if (conversation.pendingGenderClarification) {
      const genderKeywords = {
        men: ['men', 'man', 'male', 'boys', 'gents'],
        women: ['women', 'woman', 'female', 'ladies', 'girls'],
        kids: ['kids', 'children', 'child', 'boy', 'girl']
      };
      
      let detectedGender = null;
      for (const [gender, keywords] of Object.entries(genderKeywords)) {
        if (keywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
          detectedGender = gender;
          break;
        }
      }
      
      if (detectedGender) {
        // Reformulate the query with gender context
        const originalQuery = conversation.pendingGenderClarification;
        const reformulatedQuery = `${originalQuery} for ${detectedGender}`;
        
        // Add both messages to history
        conversation.history.push({
          role: "user",
          content: originalQuery
        });
        conversation.history.push({
          role: "assistant",
          content: `Great! I'd love to help you find ${originalQuery}. Is this for men, women, or kids? 👕👗👶`
        });
        conversation.history.push({
          role: "user",
          content: userMessage
        });
        
        // Process the product inquiry with gender context
        const productResult = await handleProductInquiry(reformulatedQuery, conversation.history);
        
        conversation.history.push({
          role: "assistant",
          content: productResult.response
        });
        
        conversation.pendingGenderClarification = null;
        return productResult.response;
      } else {
        // Still no clear gender, ask again
        conversation.history.push({
          role: "user",
          content: userMessage
        });
        
        const response = "I'm not sure I understood. Is this for men, women, or kids? Please specify so I can show you the right products! 👕👗👶";
        
        conversation.history.push({
          role: "assistant",
          content: response
        });
        
        return response;
      }
    }
    
    // Add user message to history
    conversation.history.push({
      role: "user",
      content: userMessage
    });
    
    // First, let AI determine intent
    const aiResponse = await getChatGPTResponse(userMessage, conversation.history);
    
    // Check if this is likely a product inquiry
    const productKeywords = [
      'buy', 'shop', 'product', 'item', 'looking for', 'want', 'need',
      't-shirt', 'shirt', 'dress', 'jeans', 'shoes', 'fashion',
      'home', 'decor', 'beauty', 'accessory', 'gift'
    ];
    
    const isProductInquiry = productKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword)
    );
    
    let finalResponse = aiResponse;
    
    // If it's a product inquiry, use our dynamic category system
    if (isProductInquiry) {
      const productResult = await handleProductInquiry(userMessage, conversation.history);
      
      if (productResult.needsGenderClarification) {
        conversation.pendingGenderClarification = userMessage;
        finalResponse = productResult.response;
      } else {
        finalResponse = productResult.response;
      }
    }
    
    // Add final response to history
    conversation.history.push({
      role: "assistant",
      content: finalResponse
    });
    
    // Keep history manageable (last 10 messages)
    if (conversation.history.length > 10) {
      conversation.history = conversation.history.slice(-10);
    }
    
    return finalResponse;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our premium lifestyle products with 100-minute delivery!";
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
      
      // Get AI response with dynamic category handling
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
    version: '4.0 - Dynamic CSV-Based Categories',
    features: {
      dynamic_categories: 'CSV-based category system',
      gender_detection: 'Automatic gender context handling',
      gallery_links: 'Dynamic gallery link generation',
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      csv_loading: 'Real-time CSV data processing'
    },
    data_loaded: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      categories: 'GET /categories',
      refresh_data: 'POST /refresh-data'
    },
    timestamp: new Date().toISOString()
  });
});

// Get all loaded categories
app.get('/categories', (req, res) => {
  res.json({
    categories: categoriesData,
    galleries: galleriesData.slice(0, 50), // First 50 galleries
    totals: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    }
  });
});

// Refresh CSV data
app.post('/refresh-data', async (req, res) => {
  try {
    await loadCSVData();
    res.json({
      status: 'success',
      message: 'CSV data refreshed successfully',
      data_loaded: {
        categories: categoriesData.length,
        galleries: galleriesData.length
      }
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

// Test category matching
app.get('/test-match/:query', (req, res) => {
  const query = req.params.query;
  const topMatches = findTopCategoryMatches(query);
  const galleries = getGalleriesForCategories(topMatches.map(cat => cat.id));
  const links = generateGalleryLinks(galleries);
  
  res.json({
    query,
    top_matches: topMatches,
    galleries_found: galleries.length,
    gallery_links: links,
    needs_gender_clarification: needsGenderClarification(query)
  });
});

// Initialize server by loading CSV data
async function initializeServer() {
  try {
    console.log('📊 Loading CSV data...');
    await loadCSVData();
    console.log('✅ Server initialized with CSV data');
  } catch (error) {
    console.error('❌ Failed to initialize server:', error);
    process.exit(1);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  initializeServer();
});

// Export for Vercel
module.exports = app;

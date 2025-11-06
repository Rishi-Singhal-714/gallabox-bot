const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const fs = require('fs');
const csv = require('csv-parser');

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

// Store conversations and CSV data
let conversations = {};
let categoriesData = [];
let galleriesData = [];

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

// Get category data for GPT
function getCategoriesForGPT() {
  return categoriesData.map(cat => `${cat.id}: ${cat.name}`).join('\n');
}

// Get galleries data for GPT
function getGalleriesForGPT() {
  return galleriesData.map(gallery => 
    `cat_id: ${gallery.cat_id}, type2: ${gallery.type2}, cat1: [${gallery.cat1.join(', ')}]`
  ).join('\n');
}

// Find galleries by category IDs
function findGalleriesByCategoryIds(categoryIds) {
  const matchingGalleries = galleriesData.filter(gallery => {
    return categoryIds.some(catId => 
      gallery.cat_id === catId || gallery.cat1.includes(catId)
    );
  });
  
  // Remove duplicates by type2
  const uniqueGalleries = [];
  const seenType2 = new Set();
  
  matchingGalleries.forEach(gallery => {
    if (!seenType2.has(gallery.type2)) {
      seenType2.add(gallery.type2);
      uniqueGalleries.push(gallery);
    }
  });
  
  return uniqueGalleries.slice(0, 6);
}

// Generate gallery links
function generateGalleryLinks(galleries) {
  return galleries.map(gallery => {
    const encodedType2 = gallery.type2.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedType2}`;
  });
}

// MAIN GPT FUNCTION - HANDLES EVERYTHING
async function getGPTResponseWithCategories(userMessage, conversationHistory = []) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club for assistance.";
  }
  
  try {
    // Prepare category and gallery data for GPT
    const categoryData = getCategoriesForGPT();
    const galleryData = getGalleriesForGPT();
    
    const messages = [];
    
    // System message with ALL data and processing instructions
    const systemMessage = {
      role: "system",
      content: `You are Zulu Club's AI shopping assistant. You have access to our complete product catalog and category system.

ZULU CLUB INFORMATION:
${ZULU_CLUB_INFO}

CATEGORIES DATA (id: name):
${categoryData}

GALLERIES DATA (cat_id, type2, cat1):
${galleryData}

PROCESSING INSTRUCTIONS - FOLLOW THESE EXACTLY:

1. **ANALYZE EVERY USER MESSAGE** - Determine if it's about products, company info, or general chat

2. **FOR PRODUCT INQUIRIES**:
   - First identify the product type (tshirt, dress, shoes, etc.)
   - Determine if gender context is needed
   - If gender is ambiguous (tshirt, shoes, etc.), ask "For men, women, or kids?"
   - If gender is clear (lehenga = women, etc.), proceed directly

3. **CATEGORY MATCHING**:
   - Search through categories and find the TOP 3 most relevant category IDs
   - Use semantic matching - don't just look for exact words
   - Consider gender context when matching
   - Return category IDs in this format: [ID1, ID2, ID3]

4. **GALLERY LINK GENERATION**:
   - Use the category IDs to find matching galleries
   - Generate gallery links in format: app.zulu.club/{type2} (replace spaces with %20)
   - Return 3-6 most relevant gallery links

5. **RESPONSE FORMAT**:
   - Keep responses under 400 characters for WhatsApp
   - Use emojis to make it engaging
   - Include relevant gallery links when showing products
   - Be conversational and helpful

6. **GENDER HANDLING EXAMPLES**:
   - "I need tshirt" → Ask "For men, women, or kids?"
   - "I want lehenga" → Directly show women's fashion categories
   - "shoes for men" → Directly show men's footwear

ALWAYS RESPOND IN THIS EXACT FORMAT:
{
  "response": "Your friendly response to the user",
  "category_ids": ["id1", "id2", "id3"],
  "needs_gender_clarification": true/false,
  "gallery_links": ["link1", "link2", "link3"]
}

IMPORTANT: You MUST return valid JSON with these exact fields.`
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
    
    console.log('🤖 Sending to GPT with categories and galleries data...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });
    
    const gptResponse = completion.choices[0].message.content.trim();
    
    console.log('🤖 Raw GPT response:', gptResponse);
    
    // Parse GPT's JSON response
    try {
      const parsedResponse = JSON.parse(gptResponse);
      
      // If GPT found category IDs, get the actual galleries
      if (parsedResponse.category_ids && parsedResponse.category_ids.length > 0) {
        const galleries = findGalleriesByCategoryIds(parsedResponse.category_ids);
        const galleryLinks = generateGalleryLinks(galleries);
        
        // Add gallery links to the response
        if (galleryLinks.length > 0 && !parsedResponse.needs_gender_clarification) {
          let enhancedResponse = parsedResponse.response;
          
          // Add gallery links to the response text
          if (!enhancedResponse.includes('app.zulu.club')) {
            enhancedResponse += `\n\n🎨 *Browse related products:*\n`;
            galleryLinks.forEach(link => {
              enhancedResponse += `• ${link}\n`;
            });
          }
          
          return {
            response: enhancedResponse,
            needs_gender_clarification: parsedResponse.needs_gender_clarification || false,
            category_ids: parsedResponse.category_ids,
            gallery_links: galleryLinks
          };
        }
      }
      
      return parsedResponse;
      
    } catch (parseError) {
      console.error('❌ GPT returned invalid JSON, using fallback:', parseError);
      // Fallback: GPT didn't return proper JSON, use the response as is
      return {
        response: gptResponse,
        category_ids: [],
        needs_gender_clarification: false,
        gallery_links: []
      };
    }
    
  } catch (error) {
    console.error('❌ GPT API error:', error);
    return {
      response: "Hi! I'm here to help you with Zulu Club products. What are you looking for today? 🛍️",
      category_ids: [],
      needs_gender_clarification: false,
      gallery_links: []
    };
  }
}

// Handle user message - EVERYTHING goes through GPT
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
      // Combine the original query with the gender response
      const combinedMessage = `${conversation.pendingGenderClarification} - ${userMessage}`;
      
      // Add to history
      conversation.history.push({
        role: "user", 
        content: conversation.pendingGenderClarification
      });
      conversation.history.push({
        role: "assistant",
        content: "Great! Is this for men, women, or kids? 👕👗👶"
      });
      conversation.history.push({
        role: "user",
        content: userMessage
      });
      
      // Process with GPT
      const gptResult = await getGPTResponseWithCategories(combinedMessage, conversation.history);
      
      // Add GPT response to history
      conversation.history.push({
        role: "assistant",
        content: gptResult.response
      });
      
      conversation.pendingGenderClarification = null;
      return gptResult.response;
    }
    
    // Add user message to history
    conversation.history.push({
      role: "user",
      content: userMessage
    });
    
    // ALWAYS send to GPT with all data
    const gptResult = await getGPTResponseWithCategories(userMessage, conversation.history);
    
    console.log('🤖 GPT Result:', {
      needsGender: gptResult.needs_gender_clarification,
      categoryIds: gptResult.category_ids,
      galleryLinks: gptResult.gallery_links
    });
    
    // If GPT says we need gender clarification, store the original query
    if (gptResult.needs_gender_clarification) {
      conversation.pendingGenderClarification = userMessage;
    }
    
    // Add GPT response to history
    conversation.history.push({
      role: "assistant",
      content: gptResult.response
    });
    
    // Keep history manageable
    if (conversation.history.length > 10) {
      conversation.history = conversation.history.slice(-10);
    }
    
    return gptResult.response;
    
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
      
      // Get AI response - EVERYTHING goes through GPT
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
    version: '5.0 - GPT-First Everything',
    features: {
      gpt_first: 'ALL messages processed by GPT',
      dynamic_categories: 'CSV-based category system',
      automatic_galleries: 'GPT finds galleries from categories',
      gender_handling: 'GPT determines when to ask for gender',
      json_structured: 'GPT returns structured responses'
    },
    data_loaded: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      categories: 'GET /categories'
    },
    timestamp: new Date().toISOString()
  });
});

// Get all loaded categories
app.get('/categories', (req, res) => {
  res.json({
    categories: categoriesData,
    galleries: galleriesData.slice(0, 50),
    totals: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    }
  });
});

// Test GPT with a query
app.post('/test-gpt', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Missing "query" in request body'
      });
    }
    
    const result = await getGPTResponseWithCategories(query);
    
    res.json({
      query,
      result
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Test failed',
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
          "message": "I need tshirt" 
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

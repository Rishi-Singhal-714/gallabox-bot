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

// Get ACTUAL category names for GPT reference
function getActualCategoryNames() {
  return categoriesData.map(cat => `- ${cat.name} (ID: ${cat.id})`).join('\n');
}

// Find categories by search term
function searchCategories(searchTerm) {
  const term = searchTerm.toLowerCase();
  return categoriesData.filter(cat => 
    cat.name.toLowerCase().includes(term)
  ).slice(0, 3); // Return top 3 matches
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

// Generate gallery links from ACTUAL galleries
function generateGalleryLinks(galleries) {
  return galleries.map(gallery => {
    const encodedType2 = gallery.type2.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedType2}`;
  });
}

// MAIN GPT FUNCTION - WITH STRICT CATEGORY ENFORCEMENT
async function getGPTResponseWithCategories(userMessage, conversationHistory = []) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      response: "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club for assistance.",
      category_ids: [],
      needs_gender_clarification: false
    };
  }
  
  try {
    // Get ACTUAL category data
    const actualCategories = getActualCategoryNames();
    
    const messages = [];
    
    // STRICT system message - GPT MUST use only actual categories
    const systemMessage = {
      role: "system",
      content: `You are Zulu Club's AI shopping assistant. You MUST use ONLY the actual categories and galleries from our database.

ZULU CLUB INFORMATION:
${ZULU_CLUB_INFO}

ACTUAL CATEGORIES AVAILABLE (YOU MUST USE ONLY THESE):
${actualCategories}

CRITICAL RULES - YOU MUST FOLLOW THESE:

1. **USE ONLY ACTUAL CATEGORIES**: You can ONLY use the categories listed above. Do NOT invent or create new category names.

2. **CATEGORY MATCHING PROCESS**:
   - Analyze the user's query and find the MOST RELEVANT categories from the actual list above
   - Return the EXACT category IDs from the list
   - If no exact match, find the closest relevant categories

3. **GENDER HANDLING**:
   - If the product is gender-ambiguous (tshirt, shoes, etc.), set needs_gender_clarification: true
   - If gender is clear (lehenga = women, etc.), proceed with category matching

4. **RESPONSE FORMAT - YOU MUST RETURN VALID JSON**:
{
  "response": "Your response text here - be helpful and mention you'll show relevant categories",
  "category_ids": ["123", "456", "789"],
  "needs_gender_clarification": false
}

5. **GALLERY LINKS**: Do NOT generate gallery links in your response. We will automatically add them based on the category IDs you provide.

6. **IF NO MATCHES FOUND**: If you cannot find relevant categories, return empty category_ids and suggest browsing the main site.

EXAMPLES OF PROPER RESPONSES:

User: "I need tshirt"
{
  "response": "I'd love to help you find t-shirts! Could you let me know if this is for men, women, or kids? 👕",
  "category_ids": [],
  "needs_gender_clarification": true
}

User: "I want tshirt for men"
{
  "response": "Great! Let me find men's t-shirts for you from our available categories.",
  "category_ids": ["123", "456", "789"],
  "needs_gender_clarification": false
}

User: "Show me home decor"
{
  "response": "I'll help you explore our home decor collection!",
  "category_ids": ["101", "102", "103"],
  "needs_gender_clarification": false
}

REMEMBER: You MUST return valid JSON and use ONLY the actual category IDs from the list above.`
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
    
    console.log('🤖 Sending to GPT with strict category enforcement...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 500,
      temperature: 0.3  // Lower temperature for more consistent responses
    });
    
    const gptResponse = completion.choices[0].message.content.trim();
    
    console.log('🤖 Raw GPT response:', gptResponse);
    
    // Try to parse JSON response
    try {
      // Clean the response - remove any non-JSON text
      const jsonMatch = gptResponse.match(/\{[\s\S]*\}/);
      const cleanJson = jsonMatch ? jsonMatch[0] : gptResponse;
      
      const parsedResponse = JSON.parse(cleanJson);
      
      // Validate that category_ids are from our actual data
      if (parsedResponse.category_ids && parsedResponse.category_ids.length > 0) {
        const validCategoryIds = parsedResponse.category_ids.filter(catId => 
          categoriesData.some(cat => cat.id === catId)
        );
        
        // If GPT returned invalid category IDs, log warning and use only valid ones
        if (validCategoryIds.length !== parsedResponse.category_ids.length) {
          console.warn('⚠️ GPT returned invalid category IDs, filtering to valid ones only');
          parsedResponse.category_ids = validCategoryIds;
        }
      }
      
      return parsedResponse;
      
    } catch (parseError) {
      console.error('❌ GPT returned invalid JSON, using category search fallback:', parseError);
      
      // FALLBACK: Search categories directly from user message
      const searchTerm = userMessage.toLowerCase();
      const matchedCategories = searchCategories(searchTerm);
      
      let fallbackResponse = "I'd love to help you find products! ";
      
      if (matchedCategories.length > 0) {
        fallbackResponse += "Here are some relevant categories I found:\n";
        matchedCategories.forEach(cat => {
          fallbackResponse += `• ${cat.name}\n`;
        });
        fallbackResponse += "\nLet me get the gallery links for you!";
        
        return {
          response: fallbackResponse,
          category_ids: matchedCategories.map(cat => cat.id),
          needs_gender_clarification: false
        };
      } else {
        return {
          response: "I'd love to help you browse our products! Please visit app.zulu.club to explore our full collection, or tell me more specifically what you're looking for. 🛍️",
          category_ids: [],
          needs_gender_clarification: false
        };
      }
    }
    
  } catch (error) {
    console.error('❌ GPT API error:', error);
    return {
      response: "Hi! I'm here to help you with Zulu Club products. What are you looking for today? 🛍️",
      category_ids: [],
      needs_gender_clarification: false
    };
  }
}

// Handle user message
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
      const combinedMessage = `${userMessage} for ${conversation.pendingGenderClarification}`;
      
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
      
      // Add gallery links if we have category IDs
      let finalResponse = gptResult.response;
      if (gptResult.category_ids && gptResult.category_ids.length > 0 && !gptResult.needs_gender_clarification) {
        const galleries = findGalleriesByCategoryIds(gptResult.category_ids);
        const galleryLinks = generateGalleryLinks(galleries);
        
        if (galleryLinks.length > 0) {
          finalResponse += `\n\n🛍️ *Browse these galleries:*\n`;
          galleryLinks.forEach(link => {
            finalResponse += `• ${link}\n`;
          });
        }
        
        finalResponse += `\n🚀 *100-minute delivery* | 💫 *Try at home*`;
      }
      
      // Add to history
      conversation.history.push({
        role: "assistant",
        content: finalResponse
      });
      
      conversation.pendingGenderClarification = null;
      return finalResponse;
    }
    
    // Add user message to history
    conversation.history.push({
      role: "user",
      content: userMessage
    });
    
    // Get GPT response
    const gptResult = await getGPTResponseWithCategories(userMessage, conversation.history);
    
    console.log('🤖 GPT Result:', {
      needsGender: gptResult.needs_gender_clarification,
      categoryIds: gptResult.category_ids,
      validCategories: gptResult.category_ids ? gptResult.category_ids.map(id => {
        const cat = categoriesData.find(c => c.id === id);
        return cat ? `${id}: ${cat.name}` : `${id}: INVALID`;
      }) : []
    });
    
    let finalResponse = gptResult.response;
    
    // If GPT says we need gender clarification, store the original query
    if (gptResult.needs_gender_clarification) {
      conversation.pendingGenderClarification = userMessage;
    } else if (gptResult.category_ids && gptResult.category_ids.length > 0) {
      // Add actual gallery links from our data
      const galleries = findGalleriesByCategoryIds(gptResult.category_ids);
      const galleryLinks = generateGalleryLinks(galleries);
      
      if (galleryLinks.length > 0) {
        finalResponse += `\n\n🛍️ *Browse these galleries:*\n`;
        galleryLinks.forEach(link => {
          finalResponse += `• ${link}\n`;
        });
        finalResponse += `\n🚀 *100-minute delivery* | 💫 *Try at home*`;
      }
    }
    
    // Add final response to history
    conversation.history.push({
      role: "assistant",
      content: finalResponse
    });
    
    // Keep history manageable
    if (conversation.history.length > 10) {
      conversation.history = conversation.history.slice(-10);
    }
    
    return finalResponse;
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return "Hello! Thanks for reaching out to Zulu Club. Please visit zulu.club to explore our premium lifestyle products!";
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
    version: '6.0 - Strict Category Enforcement',
    features: {
      strict_categories: 'GPT can ONLY use actual categories from CSV',
      actual_galleries: 'Only real gallery links from your data',
      json_validation: 'Automatic JSON parsing and validation',
      category_filtering: 'Filters out invalid category IDs'
    },
    data_loaded: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    },
    sample_categories: categoriesData.slice(0, 5).map(c => `${c.id}: ${c.name}`),
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      categories: 'GET /categories',
      search: 'GET /search/:query'
    },
    timestamp: new Date().toISOString()
  });
});

// Get all loaded categories
app.get('/categories', (req, res) => {
  res.json({
    categories: categoriesData,
    totals: {
      categories: categoriesData.length,
      galleries: galleriesData.length
    }
  });
});

// Search categories
app.get('/search/:query', (req, res) => {
  const query = req.params.query;
  const results = searchCategories(query);
  const galleries = findGalleriesByCategoryIds(results.map(r => r.id));
  const links = generateGalleryLinks(galleries);
  
  res.json({
    query,
    results,
    galleries_found: galleries.length,
    gallery_links: links
  });
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
    console.log('📋 Sample categories:', categoriesData.slice(0, 3));
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

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

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love:

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

// Get category names from categories1.csv
function getCategoryNames() {
  if (!categoriesData.length) {
    console.log('⚠️ No categories data available');
    return [];
  }
  
  const categoryNames = [];
  
  categoriesData.forEach((row) => {
    // Get name from name column
    const name = row.name || row.Name;
    if (name && name.trim()) {
      categoryNames.push(name.trim());
    }
  });
  
  console.log(`📋 Found ${categoryNames.length} category names:`, categoryNames);
  return categoryNames;
}

// Get category ID by name from categories1.csv
function getCategoryIdByName(categoryName) {
  if (!categoriesData.length || !categoryName) {
    return null;
  }
  
  console.log(`🔍 Looking for category ID for: "${categoryName}"`);
  
  for (const row of categoriesData) {
    const name = row.name || row.Name;
    if (name && name.trim() === categoryName) {
      const id = row.id || row.ID;
      if (id) {
        console.log(`✅ Found category ID: ${id} for category: ${categoryName}`);
        return id.toString();
      }
    }
  }
  
  console.log(`❌ No category ID found for: ${categoryName}`);
  return null;
}

// CORRECTED: Get type2 data from galleries1.csv by matching category ID in cat_id column
function getType2DataByCatId(categoryId) {
  if (!galleriesData.length || !categoryId) {
    return [];
  }
  
  console.log(`🔍 Searching galleries1.csv for cat_id = ${categoryId}`);
  
  const type2Data = [];
  
  galleriesData.forEach((row) => {
    // Look for cat_id column specifically
    const rowCatId = row.cat_id;
    
    if (rowCatId && rowCatId.toString() === categoryId.toString()) {
      // Get type2 data from the same row
      const type2 = row.type2;
      if (type2 && type2.trim()) {
        type2Data.push(type2.trim());
        console.log(`✅ Found in galleries: cat_id=${rowCatId} → type2="${type2}"`);
      }
    }
  });
  
  console.log(`📝 Found ${type2Data.length} type2 entries for cat_id ${categoryId}`);
  return type2Data;
}

// Generate links from type2 data
function generateLinksFromType2(type2Data) {
  return type2Data.map(name => {
    // Replace spaces with %20 and create link
    const encodedName = name.replace(/\s+/g, '%20');
    return `app.zulu.club/${encodedName}`;
  });
}

// MAIN LOGIC: Complete flow with corrected galleries search
async function getProductLinksWithAICategory(userMessage) {
  try {
    console.log('\n🔍 STARTING MAIN LOGIC FLOW');
    console.log(`📝 User query: "${userMessage}"`);
    
    // Step 1: Get all category names from categories1.csv
    const categoryNames = getCategoryNames();
    if (categoryNames.length === 0) {
      console.log('❌ No category names found in CSV');
      return [];
    }
    
    // Step 2: Send category names + company info to ChatGPT to find matching category
    const matchedCategoryName = await getAICategoryMatch(userMessage, categoryNames);
    if (!matchedCategoryName) {
      console.log('❌ No category matched by AI');
      return [];
    }
    
    // Step 3: Get category ID for the matched category name from categories1.csv
    const categoryId = getCategoryIdByName(matchedCategoryName);
    if (!categoryId) {
      console.log('❌ No category ID found');
      return [];
    }
    
    // Step 4: CORRECTED - Search galleries1.csv where cat_id = categoryId and get type2 data
    const type2Data = getType2DataByCatId(categoryId);
    if (type2Data.length === 0) {
      console.log('❌ No type2 data found for this category ID');
      return [];
    }
    
    // Step 5: Generate links from type2 data
    const links = generateLinksFromType2(type2Data);
    console.log(`🔗 Generated ${links.length} links:`, links);
    
    return links;
    
  } catch (error) {
    console.error('❌ Error in main logic:', error);
    return [];
  }
}

// ChatGPT function to find matching category
async function getAICategoryMatch(userMessage, categoryNames) {
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OpenAI API key not available');
    return null;
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a customer service assistant for Zulu Club.

${ZULU_CLUB_INFO}

YOUR TASK:
1. Analyze the user's product query
2. Match it to the most relevant category from the available categories below
3. Return ONLY the exact category name from the available list

AVAILABLE CATEGORIES:
${categoryNames.map(name => `- ${name}`).join('\n')}

IMPORTANT:
- Return ONLY the category name, nothing else
- Choose the best matching category
- If no good match, return "no_match"

Examples:
User: "I need tshirt" → "Men's Fashion"
User: "looking for vases" → "Home Decor"
User: "show me dresses" → "Women's Fashion"`
    }, {
      role: "user", 
      content: userMessage
    }];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 50,
      temperature: 0.3
    });
    
    const response = completion.choices[0].message.content.trim();
    console.log(`🤖 AI category match: "${response}"`);
    
    // Check if the response matches any of our category names
    if (response === "no_match") {
      return null;
    }
    
    const matchedCategory = categoryNames.find(cat => cat === response);
    return matchedCategory || null;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return null;
  }
}

// Function to send message via Gallabox API
async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Sending message to ${to}`);
    
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

// Main response handler
async function getChatGPTResponse(userMessage, conversationHistory = []) {
  // Always try the main CSV logic first
  const productLinks = await getProductLinksWithAICategory(userMessage);
  
  // If we found product links, use them
  if (productLinks.length > 0) {
    console.log(`🛍️ Using CSV logic, found ${productLinks.length} links`);
    
    let response = `Great choice! 🎯\n\n`;
    response += `Here are the products you're looking for:\n\n`;
    
    productLinks.slice(0, 8).forEach(link => {
      response += `• ${link}\n`;
    });
    
    if (productLinks.length > 8) {
      response += `• ... and ${productLinks.length - 8} more options\n`;
    }
    
    response += `\n🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
    response += `Click the links above to explore and shop! 🛍️`;
    
    return response;
  }
  
  // Only use AI for general conversation if no products found
  console.log('🤖 No product links found, using AI for general query');
  
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Please visit zulu.club to explore our premium lifestyle products!";
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a friendly customer service assistant for Zulu Club. ${ZULU_CLUB_INFO} Keep responses under 300 characters. Be enthusiastic and highlight 100-minute delivery, try-at-home, and easy returns.`
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
    version: '9.0 - Corrected Cat_ID Logic',
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length,
      categories_columns: categoriesData.length > 0 ? Object.keys(categoriesData[0]) : [],
      galleries_columns: galleriesData.length > 0 ? Object.keys(galleriesData[0]) : []
    }
  });
});

// Test the corrected logic flow
app.get('/test-corrected-logic', async (req, res) => {
  const query = req.query.q || 'tshirt';
  
  try {
    console.log(`\n🧪 TESTING CORRECTED LOGIC FOR: "${query}"`);
    
    // Step 1: Get category names
    const categoryNames = getCategoryNames();
    
    // Step 2: AI category matching with company info
    const matchedCategoryName = await getAICategoryMatch(query, categoryNames);
    
    // Step 3: Get category ID
    const categoryId = getCategoryIdByName(matchedCategoryName);
    
    // Step 4: CORRECTED - Search galleries1.csv using cat_id column
    const type2Data = getType2DataByCatId(categoryId);
    
    // Step 5: Generate links
    const links = generateLinksFromType2(type2Data);
    
    res.json({
      query: query,
      step1_category_names: categoryNames,
      step2_ai_matched_category: matchedCategoryName,
      step3_category_id: categoryId,
      step4_type2_data: type2Data,
      step5_generated_links: links,
      logic: "Search galleries1.csv WHERE cat_id = categoryId, THEN get type2 data"
    });
  } catch (error) {
    res.status(500).json({ error: 'Logic test failed', details: error.message });
  }
});

// Check specific category ID in galleries
app.get('/check-galleries', async (req, res) => {
  const categoryId = req.query.categoryId;
  
  if (!categoryId) {
    return res.status(400).json({ error: 'Missing categoryId parameter' });
  }
  
  try {
    console.log(`🔍 Checking galleries for category ID: ${categoryId}`);
    
    const matchingRows = galleriesData.filter(row => {
      const rowCatId = row.cat_id;
      return rowCatId && rowCatId.toString() === categoryId.toString();
    });
    
    res.json({
      category_id: categoryId,
      total_matching_rows: matchingRows.length,
      matching_rows: matchingRows.map(row => ({
        cat_id: row.cat_id,
        type2: row.type2,
        all_columns: row
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Check failed', details: error.message });
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

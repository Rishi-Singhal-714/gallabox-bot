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

// Parse cat1 column data which might be in array format
function parseCat1Data(cat1Value) {
  if (!cat1Value) return [];
  
  const strValue = cat1Value.toString().trim();
  
  // Handle array format like [1980,1933,1888] or ["25721","25723"]
  if (strValue.startsWith('[') && strValue.endsWith(']')) {
    try {
      // Remove brackets and split by comma
      const cleanStr = strValue.slice(1, -1);
      const items = cleanStr.split(',').map(item => item.trim().replace(/"/g, ''));
      console.log(`📊 Parsed array from cat1: ${items}`);
      return items;
    } catch (error) {
      console.log(`❌ Error parsing cat1 array: ${strValue}`, error);
      return [];
    }
  }
  
  // Handle comma-separated values
  if (strValue.includes(',')) {
    const items = strValue.split(',').map(item => item.trim());
    console.log(`📊 Parsed CSV from cat1: ${items}`);
    return items;
  }
  
  // Handle single value
  return [strValue];
}

// Get type2 data from galleries1.csv by matching category ID in cat1 column
function getType2DataByCat1(categoryId) {
  if (!galleriesData.length || !categoryId) {
    return [];
  }
  
  console.log(`🔍 Searching galleries1.csv for cat1 containing: ${categoryId}`);
  
  const type2Data = [];
  
  galleriesData.forEach((row, index) => {
    // Look for cat1 column specifically
    const cat1Value = row.cat1;
    
    if (cat1Value) {
      // Parse the cat1 data which might be in array format
      const cat1Ids = parseCat1Data(cat1Value);
      
      // Check if our categoryId is in the parsed array
      if (cat1Ids.includes(categoryId.toString())) {
        // Get type2 data from the same row
        const type2 = row.type2;
        if (type2 && type2.trim()) {
          type2Data.push(type2.trim());
          console.log(`✅ Row ${index}: cat1=${cat1Value} → type2="${type2}"`);
        }
      }
    }
  });
  
  console.log(`📝 Found ${type2Data.length} type2 entries for category ID ${categoryId}`);
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

// NEW: Get alternative categories when primary category has no products
async function getAlternativeCategories(userMessage, primaryCategory, allCategories) {
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }
  
  try {
    const messages = [{
      role: "system",
      content: `You are a product categorization assistant. When the primary category doesn't have products, suggest alternative related categories.

AVAILABLE CATEGORIES:
${allCategories.map(name => `- ${name}`).join('\n')}

USER QUERY: "${userMessage}"
PRIMARY CATEGORY: "${primaryCategory}"

INSTRUCTIONS:
1. Suggest 2-3 alternative categories that might have similar products
2. Return ONLY category names as comma-separated values
3. Only use categories from the available list

Examples:
User: "shoes", Primary: "Footwear" (no products) → "Men's Fashion,Women's Fashion,Sports"
User: "vases", Primary: "Home Decor" (no products) → "Home Accessories,Lifestyle Gifting"`
    }];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 100,
      temperature: 0.5
    });
    
    const response = completion.choices[0].message.content.trim();
    console.log(`🤖 AI alternative categories: "${response}"`);
    
    // Parse comma-separated categories
    const alternativeCategories = response.split(',').map(cat => cat.trim()).filter(cat => 
      cat && allCategories.includes(cat) && cat !== primaryCategory
    );
    
    console.log(`🔄 Alternative categories to try:`, alternativeCategories);
    return alternativeCategories;
    
  } catch (error) {
    console.error('❌ ChatGPT API error in alternative categories:', error);
    return [];
  }
}

// NEW: Smart product search with fallback to alternative categories
async function smartProductSearch(userMessage, categoryNames) {
  console.log(`🧠 SMART SEARCH for: "${userMessage}"`);
  
  // Step 1: Get primary category match
  const primaryCategory = await getAICategoryMatch(userMessage, categoryNames);
  if (!primaryCategory) {
    console.log('❌ No primary category matched by AI');
    return { success: false, links: [], triedCategories: [] };
  }
  
  const triedCategories = [primaryCategory];
  
  // Step 2: Try primary category
  console.log(`🔄 Trying primary category: ${primaryCategory}`);
  const primaryCategoryId = getCategoryIdByName(primaryCategory);
  if (primaryCategoryId) {
    const primaryType2Data = getType2DataByCat1(primaryCategoryId);
    if (primaryType2Data.length > 0) {
      const links = generateLinksFromType2(primaryType2Data);
      console.log(`✅ Found ${links.length} products in primary category`);
      return { success: true, links: links, triedCategories: triedCategories, source: 'primary' };
    }
  }
  
  console.log(`❌ No products found in primary category: ${primaryCategory}`);
  
  // Step 3: Get and try alternative categories
  const alternativeCategories = await getAlternativeCategories(userMessage, primaryCategory, categoryNames);
  triedCategories.push(...alternativeCategories);
  
  for (const altCategory of alternativeCategories) {
    console.log(`🔄 Trying alternative category: ${altCategory}`);
    const altCategoryId = getCategoryIdByName(altCategory);
    if (altCategoryId) {
      const altType2Data = getType2DataByCat1(altCategoryId);
      if (altType2Data.length > 0) {
        const links = generateLinksFromType2(altType2Data);
        console.log(`✅ Found ${links.length} products in alternative category: ${altCategory}`);
        return { success: true, links: links, triedCategories: triedCategories, source: 'alternative' };
      }
    }
    console.log(`❌ No products found in alternative category: ${altCategory}`);
  }
  
  // Step 4: If still no products, try generic related categories based on keywords
  const keywordCategories = getCategoriesByKeywords(userMessage, categoryNames);
  const newCategories = keywordCategories.filter(cat => !triedCategories.includes(cat));
  triedCategories.push(...newCategories);
  
  for (const keywordCat of newCategories) {
    console.log(`🔄 Trying keyword-based category: ${keywordCat}`);
    const keywordCatId = getCategoryIdByName(keywordCat);
    if (keywordCatId) {
      const keywordType2Data = getType2DataByCat1(keywordCatId);
      if (keywordType2Data.length > 0) {
        const links = generateLinksFromType2(keywordType2Data);
        console.log(`✅ Found ${links.length} products in keyword category: ${keywordCat}`);
        return { success: true, links: links, triedCategories: triedCategories, source: 'keyword' };
      }
    }
  }
  
  console.log(`💔 No products found in any category for: "${userMessage}"`);
  return { success: false, links: [], triedCategories: triedCategories };
}

// NEW: Get categories by keyword matching (fallback when AI fails)
function getCategoriesByKeywords(userMessage, categoryNames) {
  const message = userMessage.toLowerCase();
  const relatedCategories = [];
  
  // Keyword to category mapping
  const keywordMap = {
    'shoe': ['Footwear', 'Men\'s Fashion', 'Women\'s Fashion', 'Sports'],
    'footwear': ['Footwear', 'Men\'s Fashion', 'Women\'s Fashion'],
    'tshirt': ['Men\'s Fashion', 'Women\'s Fashion'],
    'shirt': ['Men\'s Fashion', 'Women\'s Fashion'],
    'dress': ['Women\'s Fashion'],
    'vase': ['Home Decor', 'Home Accessories'],
    'decor': ['Home Decor', 'Home Accessories'],
    'home': ['Home Decor', 'Home Accessories'],
    'beauty': ['Beauty & Self-Care'],
    'skincare': ['Beauty & Self-Care'],
    'gift': ['Lifestyle Gifting'],
    'accessor': ['Fashion Accessories'],
    'bag': ['Fashion Accessories'],
    'watch': ['Fashion Accessories'],
    'kids': ['Kids'],
    'toy': ['Kids']
  };
  
  // Check each keyword
  Object.entries(keywordMap).forEach(([keyword, categories]) => {
    if (message.includes(keyword)) {
      categories.forEach(cat => {
        if (categoryNames.includes(cat) && !relatedCategories.includes(cat)) {
          relatedCategories.push(cat);
        }
      });
    }
  });
  
  console.log(`🔤 Keyword-based categories for "${userMessage}":`, relatedCategories);
  return relatedCategories;
}

// MAIN LOGIC: Complete flow with smart fallback
async function getProductLinksWithAICategory(userMessage) {
  try {
    console.log('\n🔍 STARTING SMART PRODUCT SEARCH');
    console.log(`📝 User query: "${userMessage}"`);
    
    // Step 1: Get all category names from categories1.csv
    const categoryNames = getCategoryNames();
    if (categoryNames.length === 0) {
      console.log('❌ No category names found in CSV');
      return [];
    }
    
    // Step 2: Use smart search with fallback categories
    const searchResult = await smartProductSearch(userMessage, categoryNames);
    
    if (searchResult.success) {
      console.log(`🎉 Smart search successful! Found ${searchResult.links.length} products via ${searchResult.source} category`);
      return searchResult.links;
    } else {
      console.log(`💔 Smart search failed for: "${userMessage}"`);
      console.log(`🔄 Tried categories:`, searchResult.triedCategories);
      
      // Provide helpful suggestion based on tried categories
      return getHelpfulSuggestion(userMessage, searchResult.triedCategories);
    }
    
  } catch (error) {
    console.error('❌ Error in smart product search:', error);
    return [];
  }
}

// NEW: Get helpful suggestion when no products found
function getHelpfulSuggestion(userMessage, triedCategories) {
  const message = userMessage.toLowerCase();
  
  let suggestion = `I searched for "${userMessage}" in our ${triedCategories.length > 0 ? triedCategories.join(', ') : 'relevant'} categories but couldn't find specific products at the moment. 😔\n\n`;
  
  // Add specific suggestions based on query type
  if (message.includes('shoe') || message.includes('footwear')) {
    suggestion += `👟 For footwear, you might want to check our:\n`;
    suggestion += `• Men's Fashion category for casual shoes\n`;
    suggestion += `• Women's Fashion category for heels and flats\n`;
    suggestion += `• Sports category for athletic footwear\n\n`;
  } else if (message.includes('tshirt') || message.includes('shirt') || message.includes('dress')) {
    suggestion += `👕 For clothing items, explore our:\n`;
    suggestion += `• Men's Fashion for shirts and tees\n`;
    suggestion += `• Women's Fashion for dresses and tops\n\n`;
  } else if (message.includes('vase') || message.includes('decor') || message.includes('home')) {
    suggestion += `🏠 For home items, check our:\n`;
    suggestion += `• Home Decor category\n`;
    suggestion += `• Home Accessories section\n\n`;
  } else {
    suggestion += `🔍 You can explore our main categories:\n`;
    suggestion += `• Men's & Women's Fashion\n`;
    suggestion += `• Home Decor & Accessories\n`;
    suggestion += `• Beauty & Self-Care\n`;
    suggestion += `• Footwear & Accessories\n\n`;
  }
  
  suggestion += `🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*\n`;
  suggestion += `Visit zulu.club to browse our complete collection! 🛍️`;
  
  return [suggestion]; // Return as array to maintain consistency
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
  // Always try the smart CSV logic first
  const productLinks = await getProductLinksWithAICategory(userMessage);
  
  // If we found product links or helpful suggestions, use them
  if (productLinks.length > 0) {
    // Check if the first item is a suggestion (string) or actual links
    if (typeof productLinks[0] === 'string' && productLinks[0].includes('searched for')) {
      // It's a helpful suggestion message
      console.log(`💡 Showing helpful suggestion to user`);
      return productLinks[0];
    } else {
      // It's actual product links
      console.log(`🛍️ Using product links, found ${productLinks.length} items`);
      
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
  }
  
  // Only use AI for general conversation if no products found
  console.log('🤖 No products found, using AI for general query');
  
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
    version: '11.0 - Smart Category Fallback',
    csv_data: {
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length
    }
  });
});

// Test the smart search logic
app.get('/test-smart-search', async (req, res) => {
  const query = req.query.q || 'shoes';
  
  try {
    console.log(`\n🧪 TESTING SMART SEARCH FOR: "${query}"`);
    
    const categoryNames = getCategoryNames();
    const searchResult = await smartProductSearch(query, categoryNames);
    
    res.json({
      query: query,
      search_result: searchResult,
      smart_features: {
        primary_category_search: true,
        alternative_categories_fallback: true,
        keyword_based_fallback: true,
        helpful_suggestions: true
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Smart search test failed', details: error.message });
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

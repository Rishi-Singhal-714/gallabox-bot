const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
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

// Store conversations and product data
let conversations = {};
let productData = [];

// ZULU CLUB INFORMATION with categories and links
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

// Category structure with dummy links - FOR AI TO USE IN RESPONSES
const CATEGORIES = {
  "Women's Fashion": {
    link: "app.zulu.club/categories/womens-fashion",
    subcategories: {
      "Dresses": "app.zulu.club/categories/womens-fashion/dresses",
      "Tops": "app.zulu.club/categories/womens-fashion/tops",
      "Co-ords": "app.zulu.club/categories/womens-fashion/co-ords",
      "Winterwear": "app.zulu.club/categories/womens-fashion/winterwear",
      "Loungewear": "app.zulu.club/categories/womens-fashion/loungewear",
      "Ethnic Wear": "app.zulu.club/categories/womens-fashion/ethnic-wear"
    }
  },
  "Men's Fashion": {
    link: "app.zulu.club/categories/mens-fashion",
    subcategories: {
      "Shirts": "app.zulu.club/categories/mens-fashion/shirts",
      "Tees": "app.zulu.club/categories/mens-fashion/tees",
      "Jackets": "app.zulu.club/categories/mens-fashion/jackets",
      "Athleisure": "app.zulu.club/categories/mens-fashion/athleisure",
      "Formal Wear": "app.zulu.club/categories/mens-fashion/formal-wear",
      "Casual Wear": "app.zulu.club/categories/mens-fashion/casual-wear"
    }
  },
  "Kids": {
    link: "app.zulu.club/categories/kids",
    subcategories: {
      "Clothing": "app.zulu.club/categories/kids/clothing",
      "Toys": "app.zulu.club/categories/kids/toys",
      "Learning Kits": "app.zulu.club/categories/kids/learning-kits",
      "Accessories": "app.zulu.club/categories/kids/accessories",
      "Baby Care": "app.zulu.club/categories/kids/baby-care"
    }
  },
  "Footwear": {
    link: "app.zulu.club/categories/footwear",
    subcategories: {
      "Sneakers": "app.zulu.club/categories/footwear/sneakers",
      "Heels": "app.zulu.club/categories/footwear/heels",
      "Flats": "app.zulu.club/categories/footwear/flats",
      "Sandals": "app.zulu.club/categories/footwear/sandals",
      "Kids Shoes": "app.zulu.club/categories/footwear/kids-shoes",
      "Sports Shoes": "app.zulu.club/categories/footwear/sports-shoes"
    }
  },
  "Home Decor": {
    link: "app.zulu.club/categories/home-decor",
    subcategories: {
      "Showpieces": "app.zulu.club/categories/home-decor/showpieces",
      "Vases": "app.zulu.club/categories/home-decor/vases",
      "Lamps": "app.zulu.club/categories/home-decor/lamps",
      "Aroma Decor": "app.zulu.club/categories/home-decor/aroma-decor",
      "Wall Art": "app.zulu.club/categories/home-decor/wall-art",
      "Home Accessories": "app.zulu.club/categories/home-decor/accessories"
    }
  },
  "Beauty & Self-Care": {
    link: "app.zulu.club/categories/beauty-self-care",
    subcategories: {
      "Skincare": "app.zulu.club/categories/beauty-self-care/skincare",
      "Bodycare": "app.zulu.club/categories/beauty-self-care/bodycare",
      "Fragrances": "app.zulu.club/categories/beauty-self-care/fragrances",
      "Grooming": "app.zulu.club/categories/beauty-self-care/grooming",
      "Makeup": "app.zulu.club/categories/beauty-self-care/makeup",
      "Hair Care": "app.zulu.club/categories/beauty-self-care/hair-care"
    }
  },
  "Fashion Accessories": {
    link: "app.zulu.club/categories/fashion-accessories",
    subcategories: {
      "Bags": "app.zulu.club/categories/fashion-accessories/bags",
      "Jewelry": "app.zulu.club/categories/fashion-accessories/jewelry",
      "Watches": "app.zulu.club/categories/fashion-accessories/watches",
      "Sunglasses": "app.zulu.club/categories/fashion-accessories/sunglasses",
      "Belts": "app.zulu.club/categories/fashion-accessories/belts",
      "Wallets": "app.zulu.club/categories/fashion-accessories/wallets"
    }
  },
  "Lifestyle Gifting": {
    link: "app.zulu.club/categories/lifestyle-gifting",
    subcategories: {
      "Curated Gift Sets": "app.zulu.club/categories/lifestyle-gifting/gift-sets",
      "Home Decor Gifts": "app.zulu.club/categories/lifestyle-gifting/home-decor",
      "Personalized Gifts": "app.zulu.club/categories/lifestyle-gifting/personalized",
      "Occasion Gifts": "app.zulu.club/categories/lifestyle-gifting/occasion",
      "Corporate Gifting": "app.zulu.club/categories/lifestyle-gifting/corporate"
    }
  }
};

// Function to fetch and parse CSV from GitHub
async function loadCSVFromGitHub() {
  try {
    // Replace with your actual GitHub raw CSV URL
    const csvUrl = process.env.CSV_URL || 'https://github.com/Rishi-Singhal-714/gallabox-bot/blob/main/galleries1.csv';
    
    console.log('📥 Fetching CSV from GitHub...');
    const response = await axios.get(csvUrl);
    const csvData = response.data;
    
    // Parse CSV data
    const results = [];
    const lines = csvData.split('\n');
    
    // Get headers (first line)
    const headers = lines[0].split(',').map(header => header.trim());
    
    // Process each line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(value => value.trim());
      const row = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      // Filter out null type1 values and remove deals/offers from type2
      if (row.type1 && row.type1.trim() !== '' && row.type1 !== 'null') {
        // Clean type2 - remove deals/offers keywords
        let cleanType2 = row.type2 || '';
        if (cleanType2) {
          const dealKeywords = ['deal', 'offer', 'discount', 'sale', 'promo', 'special'];
          const hasDeal = dealKeywords.some(keyword => 
            cleanType2.toLowerCase().includes(keyword)
          );
          if (hasDeal) {
            cleanType2 = '';
          }
        }
        
        results.push({
          type1: row.type1.trim(),
          type2: cleanType2,
          category: row.category || '',
          description: row.description || ''
        });
      }
    }
    
    console.log(`✅ Loaded ${results.length} products from CSV`);
    productData = results;
    return results;
    
  } catch (error) {
    console.error('❌ Error loading CSV from GitHub:', error.message);
    return [];
  }
}

// Initialize CSV data on startup
loadCSVFromGitHub();

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

// Function to search products in CSV data
function searchProducts(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  
  if (!term || productData.length === 0) return [];
  
  // Search in type1 (primary) and type2 (secondary)
  const results = productData.filter(product => {
    const type1Match = product.type1.toLowerCase().includes(term);
    const type2Match = product.type2 && product.type2.toLowerCase().includes(term);
    const categoryMatch = product.category && product.category.toLowerCase().includes(term);
    
    return type1Match || type2Match || categoryMatch;
  });
  
  // Remove duplicates based on type1
  const uniqueResults = results.filter((product, index, self) => 
    index === self.findIndex(p => p.type1 === product.type1)
  );
  
  return uniqueResults.slice(0, 5); // Return max 5 results
}

// Function to generate product link
function generateProductLink(productName) {
  // Replace spaces with %20 and create simple link
  const encodedProduct = productName.replace(/\s+/g, '%20');
  return `app.zulu.club/${encodedProduct}`;
}

// Function to format product response
function formatProductResponse(products, searchTerm) {
  if (products.length === 0) {
    return `🔍 Sorry, I couldn't find any products matching "${searchTerm}".\n\nTry searching for different products or categories! 🛍️`;
  }
  
  if (products.length === 1) {
    const product = products[0];
    const productLink = generateProductLink(product.type1);
    
    let response = `🎯 Found: *${product.type1}*\n\n`;
    
    if (product.category) {
      response += `📦 *Category:* ${product.category}\n`;
    }
    if (product.description) {
      response += `📝 *Description:* ${product.description}\n`;
    }
    if (product.type2) {
      response += `🏷️ *Type:* ${product.type2}\n`;
    }
    
    response += `\n🔗 Browse ${product.type1}:\n`;
    response += `${productLink}\n\n`;
    response += `🛒 Happy shopping!`;
    
    return response;
  }
  
  let response = `🔍 I found ${products.length} products matching "${searchTerm}":\n\n`;
  
  products.forEach((product, index) => {
    const productLink = generateProductLink(product.type1);
    response += `${index + 1}. *${product.type1}*`;
    
    if (product.category) {
      response += ` (${product.category})`;
    }
    
    response += `\n   ${productLink}\n\n`;
  });
  
  response += `💡 *Tip:* Tell me which product you're interested in, and I'll show you more details!`;
  
  return response;
}

// Function to detect product intent using AI
async function detectProductIntent(userMessage) {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback simple detection
    const productKeywords = [
      'looking for', 'search for', 'find', 'buy', 'shop', 'product', 
      'item', 'want', 'need', 'get', 'purchase'
    ];
    return productKeywords.some(keyword => userMessage.toLowerCase().includes(keyword));
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product search detection assistant. Analyze if the user is asking about specific products or looking to search for items.
          
          Respond with ONLY "YES" or "NO".
          
          Examples:
          User: "Do you have running shoes?" → YES
          User: "Looking for jeans" → YES  
          User: "I want to buy a watch" → YES
          User: "Search for skincare products" → YES
          User: "What categories do you have?" → NO
          User: "Tell me about your delivery" → NO
          User: "Hello" → NO
          User: "How are you?" → NO`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    });
    
    const response = completion.choices[0].message.content.trim().toUpperCase();
    return response === 'YES';
    
  } catch (error) {
    console.error('❌ Product detection AI error:', error);
    // Fallback to simple detection
    const productKeywords = ['looking for', 'search for', 'find', 'buy', 'shop', 'product'];
    return productKeywords.some(keyword => userMessage.toLowerCase().includes(keyword));
  }
}

// Function to extract search query using AI
async function extractSearchQuery(userMessage) {
  if (!process.env.OPENAI_API_KEY) {
    // Simple extraction - return the message as is for searching
    return userMessage;
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: "g3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Extract the main product or search query from the user's message. Remove greetings and unnecessary words.
          
          Examples:
          User: "Hi, I'm looking for running shoes" → running shoes
          User: "Do you have blue jeans?" → blue jeans
          User: "Search for skincare products" → skincare products
          User: "I want to buy a watch" → watch
          User: "Hello, can you help me find a laptop bag?" → laptop bag
          User: "What do you have?" → NOT_SPECIFIED
          
          Respond with ONLY the search query or "NOT_SPECIFIED".`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 20,
      temperature: 0.1
    });
    
    const response = completion.choices[0].message.content.trim();
    return response === 'NOT_SPECIFIED' ? null : response;
    
  } catch (error) {
    console.error('❌ Search query extraction AI error:', error);
    return userMessage; // Fallback to using the whole message
  }
}

// Function to properly format links for WhatsApp
function formatLinksForWhatsApp(text) {
  if (!text) return text;
  
  const linkPattern = /(app\.zulu\.club\/[^\s]+)/g;
  let formattedText = text;
  
  const links = text.match(linkPattern);
  if (links) {
    links.forEach(link => {
      const linkWithContext = new RegExp(`([^\\n]|^)${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\s]|$)`);
      
      if (linkWithContext.test(formattedText)) {
        formattedText = formattedText.replace(
          new RegExp(`([^\\n])${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `$1\n${link}`
        );
        
        formattedText = formattedText.replace(
          new RegExp(`${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\n])`, 'g'),
          `${link}\n$1`
        );
      }
    });
  }
  
  formattedText = formattedText.replace(/\n\s*\n\s*\n/g, '\n\n');
  return formattedText.trim();
}

// Function to generate category response (for AI to use in its responses)
function generateCategoryResponse(userMessage = '') {
  const msg = userMessage.toLowerCase();
  
  // Check for specific category mentions
  for (const [category, data] of Object.entries(CATEGORIES)) {
    const categoryLower = category.toLowerCase();
    if (msg.includes(categoryLower) || 
        Object.keys(data.subcategories).some(sub => msg.includes(sub.toLowerCase()))) {
      
      // Return specific category with subcategories
      let response = `🛍️ *${category}* \n\n`;
      response += `Explore our ${category.toLowerCase()} collection:\n`;
      response += `🔗 ${data.link}\n\n`;
      response += `*Subcategories:*\n`;
      
      Object.entries(data.subcategories).forEach(([sub, link]) => {
        response += `• ${sub}: ${link}\n`;
      });
      
      response += `\nVisit the links to browse products! 🛒`;
      return response;
    }
  }
  
  // General product query - show all categories
  let response = `🛍️ *Our Product Categories* \n\n`;
  response += `We have an amazing range of lifestyle products! Here are our main categories:\n\n`;
  
  Object.entries(CATEGORIES).forEach(([category, data]) => {
    response += `• *${category}*: ${data.link}\n`;
  });
  
  response += `\n💡 *Pro Tip:* You can ask about specific categories like "women's fashion" or "home decor" and I'll show you the subcategories!\n\n`;
  response += `🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`;
  
  return response;
}

// Function to get category links for AI reference
function getCategoryLinks() {
  let links = "CATEGORY LINKS:\n";
  Object.entries(CATEGORIES).forEach(([category, data]) => {
    links += `- ${category}: ${data.link}\n`;
    Object.entries(data.subcategories).forEach(([sub, link]) => {
      links += `  • ${sub}: ${link}\n`;
    });
  });
  return links;
}

// AI Chat Functionality with Product Search
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // Check if this is a product search query
    const isProductQuery = await detectProductIntent(userMessage);
    
    if (isProductQuery) {
      const searchQuery = await extractSearchQuery(userMessage);
      
      if (searchQuery && searchQuery !== 'NOT_SPECIFIED') {
        // User mentioned a specific product to search for
        const productResults = searchProducts(searchQuery);
        return formatLinksForWhatsApp(formatProductResponse(productResults, searchQuery));
      } else {
        // User asking about products but no specific query mentioned
        return formatLinksForWhatsApp(
          `🔍 *Product Search*\n\nI can help you find specific products! 🛍️\n\n` +
          `Just tell me what you're looking for, for example:\n` +
          `• "Looking for running shoes"\n` +
          `• "Do you have jeans?"\n` +
          `• "Search for skincare products"\n\n` +
          `What product are you looking for?`
        );
      }
    }
    
    // Continue with normal AI response for non-product queries
    const messages = [];
    
    // System message with Zulu Club information and category format guidelines
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${companyInfo}

      PRODUCT SEARCH CAPABILITY:
      - Users can search for specific products from our catalog
      - If users ask about specific items, guide them to use product search
      - We have a wide range of lifestyle products available
      - Product links format: app.zulu.club/ProductName (spaces become %20)

      AVAILABLE CATEGORIES WITH LINKS:
      ${getCategoryLinks()}

      IMPORTANT RESPONSE GUIDELINES:
      1. **Use the category links naturally** in your responses when users ask about products
      2. **For product searches**, help users find specific items from our catalog
      3. **Decide when to show categories** based on the conversation context
      4. **Keep responses conversational** - don't just list categories unless specifically asked
      5. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      6. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
      7. **Use emojis** to make it engaging but professional
      8. **Keep responses under 400 characters** for WhatsApp compatibility
      9. **Be enthusiastic and helpful** - we're excited about our products!

      RESPONSE EXAMPLES:
      - If user asks "What products do you have?" → Briefly describe our range and include main category links
      - If user asks "Do you have dresses?" → "Yes! Check our Women's Fashion collection: app.zulu.club/categories/womens-fashion We have dresses, tops, co-ords and more! 👗"
      - If user asks "Looking for running shoes" → Use product search to find matching items
      - If user asks specifically "Show me all categories" → Provide the full category list with links

      Remember: Integrate category links naturally into the conversation flow. Let the user's interest guide how much category detail to provide.
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
    
    // Fallback: If AI doesn't include categories but user clearly asks for them
    const clearCategoryRequests = [
      'categor', 'what do you sell', 'what do you have', 'products', 'items',
      'show me everything', 'all products', 'your collection', 'what kind of'
    ];
    
    const userMsgLower = userMessage.toLowerCase();
    const shouldShowCategories = clearCategoryRequests.some(term => userMsgLower.includes(term));
    const hasLinks = response.includes('app.zulu.club') || response.includes('zulu.club');
    
    if (shouldShowCategories && !hasLinks) {
      console.log('🤖 AI missed category links, adding fallback...');
      response += `\n\n${generateCategoryResponse(userMessage)}`;
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    // Fallback to category response for clear product queries
    const clearProductQueries = [
      'product', 'categor', 'what do you sell', 'what do you have', 'buy', 'shop'
    ];
    if (clearProductQueries.some(term => userMessage.toLowerCase().includes(term))) {
      return generateCategoryResponse(userMessage);
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
    // Fallback response
    const clearProductQueries = [
      'product', 'categor', 'what do you sell', 'what do you have'
    ];
    if (clearProductQueries.some(term => userMessage.toLowerCase().includes(term))) {
      return generateCategoryResponse(userMessage);
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
    version: '5.0 - GitHub CSV Product Search',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      product_search: 'AI-powered product detection and search',
      csv_integration: 'GitHub CSV data integration',
      data_cleaning: 'Removed null values and deals/offers',
      simple_links: 'Product links: app.zulu.club/ProductName',
      categories: '8 main categories with subcategories',
      whatsapp_integration: 'Gallabox API integration'
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      products: 'GET /products'
    },
    product_count: productData.length,
    timestamp: new Date().toISOString()
  });
});

// Get all products
app.get('/products', async (req, res) => {
  const search = req.query.search;
  
  // Reload CSV data if needed
  if (productData.length === 0) {
    await loadCSVFromGitHub();
  }
  
  if (search) {
    const results = searchProducts(search);
    res.json({
      search_query: search,
      results: results,
      result_count: results.length,
      links: results.map(product => ({
        product: product.type1,
        link: generateProductLink(product.type1),
        category: product.category,
        type2: product.type2
      }))
    });
  } else {
    res.json({
      products: productData.slice(0, 50), // Show first 50 products
      total_products: productData.length,
      link_format: 'app.zulu.club/ProductName (spaces encoded as %20)',
      search_example: 'Use ?search=query to search products'
    });
  }
});

// Export for Vercel
module.exports = app;

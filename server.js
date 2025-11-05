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

// Store conversations
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

// Load CSV data
function loadCSVData() {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream('galleries1.csv')
      .pipe(csv())
      .on('data', (data) => {
        // Filter out null type1 values and remove deals/offers from type2
        if (data.type1 && data.type1.trim() !== '' && data.type1 !== 'null') {
          // Clean type2 - remove deals/offers keywords
          let cleanType2 = data.type2 || '';
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
            type1: data.type1.trim(),
            type2: cleanType2,
            category: data.category || '',
            description: data.description || ''
          });
        }
      })
      .on('end', () => {
        console.log(`✅ Loaded ${results.length} products from CSV`);
        productData = results;
        resolve(results);
      })
      .on('error', (error) => {
        console.error('❌ Error reading CSV file:', error);
        reject(error);
      });
  });
}

// Initialize CSV data
loadCSVData().catch(console.error);

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
  
  if (!term) return [];
  
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
      model: "gpt-3.5-turbo",
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
    
    // System message with product search capability info
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

      IMPORTANT RESPONSE GUIDELINES:
      1. **PROPER LINK FORMATTING**: Always put links on their own line with line breaks
      2. **PRODUCT QUERIES**: If user asks about specific products, suggest they search directly
      3. **Keep responses under 400 characters** for WhatsApp
      4. **Use emojis** to make it engaging but professional
      5. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns

      CORRECT LINK FORMATTING:
      ✅ "Check out our collection:\napp.zulu.club/categories/mens-fashion\n\nLet me know..."
      ✅ "Browse running shoes:\napp.zulu.club/running%20shoes\n\nHappy shopping!"
      ❌ AVOID: "Check: app.zulu.club/categories Let me know..."

      PRODUCT RESPONSE EXAMPLES:
      ✅ "I can help you find specific products! Just tell me what you're looking for. 🛍️"
      ✅ "For running shoes, just ask me 'Looking for running shoes' and I'll search our catalog!"
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
    
    // Post-process for proper link formatting
    response = formatLinksForWhatsApp(response);
    
    return response;
    
  } catch (error) {
    console.error('❌ ChatGPT API error:', error);
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! What would you like to know about our products? 🛍️";
  }
}

// Handle user message with AI and Product Search
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
    version: '5.0 - CSV Product Search',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      product_search: 'AI-powered product detection and search',
      csv_integration: 'Real-time CSV data from galleries1.csv',
      data_cleaning: 'Removed null values and deals/offers',
      simple_links: 'Product links: app.zulu.club/ProductName',
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
app.get('/products', (req, res) => {
  const search = req.query.search;
  
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

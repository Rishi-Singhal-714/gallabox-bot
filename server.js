const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');

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

// AI Chat Functionality - Let AI decide when to show categories
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    const messages = [];
    
    // System message with Zulu Club information and category format guidelines
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${companyInfo}

      AVAILABLE CATEGORIES WITH LINKS:
      ${getCategoryLinks()}

      IMPORTANT RESPONSE GUIDELINES:
      1. **Use the category links naturally** in your responses when users ask about products
      2. **Decide when to show categories** based on the conversation context
      3. **For general product inquiries**, provide a brief overview and include relevant category links
      4. **For specific category questions**, mention that category's link and its subcategories
      5. **Keep responses conversational** - don't just list categories unless specifically asked
      6. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      7. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
      8. **Use emojis** to make it engaging but professional
      9. **Keep responses under 400 characters** for WhatsApp compatibility
      10. **Be enthusiastic and helpful** - we're excited about our products!

      CATEGORY USAGE EXAMPLES:
      - If user asks "What products do you have?" → Briefly describe our range and include main category links
      - If user asks "Do you have dresses?" → "Yes! Check our Women's Fashion collection: app.zulu.club/categories/womens-fashion We have dresses, tops, co-ords and more! 👗"
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
    version: '3.0 - AI-Driven Category Display',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      smart_categories: 'AI decides when to show categories',
      category_links: '8 main categories with 40+ subcategories',
      natural_integration: 'Category links integrated conversationally',
      whatsapp_integration: 'Gallabox API integration'
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

// Get all categories with links
app.get('/categories', (req, res) => {
  res.json({
    categories: CATEGORIES,
    total_categories: Object.keys(CATEGORIES).length,
    total_subcategories: Object.values(CATEGORIES).reduce((acc, cat) => acc + Object.keys(cat.subcategories).length, 0),
    approach: 'AI-driven category display - AI decides when and how to show categories based on conversation context'
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

// Get specific category info
app.get('/categories/:categoryName', (req, res) => {
  const categoryName = req.params.categoryName.toLowerCase();
  const category = Object.entries(CATEGORIES).find(([name]) => 
    name.toLowerCase().replace(/\s+/g, '-') === categoryName
  );
  
  if (!category) {
    return res.status(404).json({ error: 'Category not found' });
  }
  
  res.json({
    category: category[0],
    data: category[1]
  });
});

// Export for Vercel
module.exports = app;

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
  },
  "Men's Fashion": {
    link: "app.zulu.club/categories/mens-fashion",
  },
  "Kids": {
    link: "app.zulu.club/categories/kids"
  },
  "Footwear": {
    link: "app.zulu.club/categories/footwear",
  },
  "Home Decor": {
    link: "app.zulu.club/categories/home-decor",
  },
  "Beauty & Self-Care": {
    link: "app.zulu.club/categories/beauty-self-care",
  },
  "Fashion Accessories": {
    link: "app.zulu.club/categories/fashion-accessories",
  },
  "Lifestyle Gifting": {
    link: "app.zulu.club/categories/lifestyle-gifting",
  }
};

// NEW: CSV Data Storage
let categoriesData = []; // Store categories1.csv data
let galleriesData = [];  // Store galleries1.csv data
let isCSVLoaded = false;
let csvLoadAttempts = 0;
const MAX_CSV_ATTEMPTS = 5;

// NEW: Function to load CSV from GitHub raw content
async function loadCSVFromGitHub(csvUrl, isGalleries = false) {
  try {
    console.log(`📥 Loading CSV from: ${csvUrl}`);
    
    // Use raw GitHub URL directly (no need to convert from blob)
    const rawUrl = csvUrl;
    
    const response = await axios.get(rawUrl, { 
      timeout: 25000, // Increased timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const csvContent = response.data;
    
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(csvContent);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          if (isGalleries) {
            // For galleries1.csv, we need cat1 and type2 columns
            if (data.cat1 && data.type2) {
              // Parse cat1 which can be in different formats:
              // Format 1: ["1921", "1922", "1933", "1936", "1939", "1955"]
              // Format 2: [1921,1922,1989,1993]
              let cat1Array = [];
              
              try {
                // Try to parse as JSON array first
                if (data.cat1.startsWith('[') && data.cat1.endsWith(']')) {
                  // Remove brackets and parse
                  const cleanCat1 = data.cat1.replace(/[\[\]"]/g, '');
                  cat1Array = cleanCat1.split(',').map(item => item.trim()).filter(item => item);
                } else {
                  // Try direct split by comma
                  cat1Array = data.cat1.split(',').map(item => item.trim()).filter(item => item);
                }
              } catch (error) {
                console.log(`❌ Error parsing cat1: ${data.cat1}`, error);
                cat1Array = [];
              }
              
              if (cat1Array.length > 0) {
                results.push({
                  cat1: cat1Array, // Store as array of category IDs
                  type2: data.type2.trim()
                });
              }
            }
          } else {
            // For categories1.csv, we need id and name columns
            if (data.id && data.name) {
              results.push({
                id: data.id.trim(),
                name: data.name.trim()
              });
            }
          }
        })
        .on('end', () => {
          console.log(`✅ Successfully loaded ${results.length} rows from ${isGalleries ? 'galleries' : 'categories'} CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error(`❌ Error parsing CSV:`, error);
          reject(error);
        });
    });
  } catch (error) {
    console.error(`❌ Error loading CSV from ${csvUrl}:`, error.message);
    throw error;
  }
}

// NEW: Function to load all CSV data with retry logic
async function loadAllCSVData() {
  if (isCSVLoaded) {
    console.log('✅ CSV data already loaded');
    return true;
  }

  try {
    csvLoadAttempts++;
    console.log(`🔄 CSV Load Attempt ${csvLoadAttempts}/${MAX_CSV_ATTEMPTS}`);

    // Use direct raw GitHub URLs
    const categoriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/categories1.csv';
    const galleriesUrl = 'https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries1.csv';

    console.log('📥 Loading categories from:', categoriesUrl);
    console.log('📥 Loading galleries from:', galleriesUrl);

    // Load both CSVs in parallel with better error handling
    const [categoriesResult, galleriesResult] = await Promise.allSettled([
      loadCSVFromGitHub(categoriesUrl, false),
      loadCSVFromGitHub(galleriesUrl, true)
    ]);

    // Handle results
    if (categoriesResult.status === 'fulfilled') {
      categoriesData = categoriesResult.value;
      console.log(`✅ Loaded ${categoriesData.length} categories`);
    } else {
      console.error('❌ Failed to load categories:', categoriesResult.reason);
      categoriesData = [];
    }

    if (galleriesResult.status === 'fulfilled') {
      galleriesData = galleriesResult.value;
      console.log(`✅ Loaded ${galleriesData.length} galleries`);
    } else {
      console.error('❌ Failed to load galleries:', galleriesResult.reason);
      galleriesData = [];
    }

    console.log(`📊 CSV Data Summary:`);
    console.log(`   - Categories loaded: ${categoriesData.length}`);
    console.log(`   - Galleries loaded: ${galleriesData.length}`);
    
    // Log sample data to verify parsing
    if (categoriesData.length > 0) {
      console.log('📝 Categories sample:', categoriesData.slice(0, 3));
    }
    if (galleriesData.length > 0) {
      console.log('📝 Galleries sample:', galleriesData.slice(0, 3).map(g => ({
        cat1: g.cat1,
        type2: g.type2
      })));
    }

    // Check if we have enough data - be more flexible about the count
    const hasEnoughData = categoriesData.length > 50 && galleriesData.length > 0; // Reduced threshold for testing
    if (hasEnoughData) {
      isCSVLoaded = true;
      console.log('🎉 Successfully loaded all CSV data!');
      return true;
    } else {
      console.log(`⚠️ Loaded ${categoriesData.length} categories and ${galleriesData.length} galleries`);
      if (csvLoadAttempts < MAX_CSV_ATTEMPTS) {
        const retryDelay = 5000; // 5 seconds
        console.log(`⏳ Retrying in ${retryDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return loadAllCSVData();
      } else {
        console.log('❌ Max retry attempts reached');
        // Still mark as loaded if we have some data
        if (categoriesData.length > 0 && galleriesData.length > 0) {
          isCSVLoaded = true;
          console.log('⚠️ Marking as loaded with limited data');
          return true;
        }
        return false;
      }
    }
  } catch (error) {
    console.error('💥 Error loading CSV data:', error.message);
    if (csvLoadAttempts < MAX_CSV_ATTEMPTS) {
      const retryDelay = 5000; // 5 seconds
      console.log(`⏳ Retrying in ${retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return loadAllCSVData();
    } else {
      console.log('❌ Max retry attempts reached');
      return false;
    }
  }
}

// NEW: Function to detect product category using GPT
async function detectProductCategory(userMessage) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not available for category detection');
      return null;
    }

    // Prepare category names for context
    const categoryNames = categoriesData.map(cat => cat.name).slice(0, 50); // Limit to first 50 for token efficiency

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product category classifier for an e-commerce store. 
          Analyze the user's message and identify which product category they are looking for.
          Available categories include: ${categoryNames.join(', ')}
          
          Respond ONLY with the exact category name that best matches the user's request.
          If no clear category matches, respond with "null".
          
          Examples:
          User: "I need tshirt" -> "Topwear"
          User: "want shoes" -> "Footwear" 
          User: "looking for jeans" -> "Bottomwear"
          User: "show me bags" -> "Bags"
          User: "hello" -> "null"`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    const detectedCategory = completion.choices[0].message.content.trim();
    
    // Clean up response
    if (detectedCategory === 'null' || !detectedCategory) {
      console.log('🤖 No specific category detected');
      return null;
    }

    console.log(`🤖 Detected category: "${detectedCategory}"`);
    return detectedCategory;

  } catch (error) {
    console.error('❌ Error detecting product category:', error);
    return null;
  }
}

// NEW: Function to find category ID and generate link
async function generateProductLink(userMessage) {
  try {
    // Wait for CSV data to be loaded
    if (!isCSVLoaded) {
      console.log('⏳ CSV data not loaded yet, trying to load...');
      const loaded = await loadAllCSVData();
      if (!loaded) {
        console.log('❌ CSV data not available for product linking');
        return null;
      }
    }

    // Detect category using GPT
    const detectedCategory = await detectProductCategory(userMessage);
    
    if (!detectedCategory) {
      console.log('❌ No category detected from user message');
      return null;
    }

    // Find the category in categories1.csv
    const category = categoriesData.find(cat => 
      cat.name.toLowerCase().includes(detectedCategory.toLowerCase()) ||
      detectedCategory.toLowerCase().includes(cat.name.toLowerCase())
    );

    if (!category) {
      console.log(`❌ Category "${detectedCategory}" not found in categories data`);
      return null;
    }

    console.log(`✅ Found category: ${category.name} (ID: ${category.id})`);

    // Find matching gallery entry - now checking if cat1 array includes our category ID
    const gallery = galleriesData.find(g => {
      if (Array.isArray(g.cat1)) {
        return g.cat1.includes(category.id);
      } else {
        return g.cat1 === category.id;
      }
    });
    
    if (!gallery || !gallery.type2) {
      console.log(`❌ No gallery data found for category ID: ${category.id}`);
      console.log(`🔍 Searching through ${galleriesData.length} galleries...`);
      
      // Try to find any gallery that might match
      const potentialMatches = galleriesData.filter(g => 
        Array.isArray(g.cat1) && g.cat1.some(id => id.includes(category.id.substring(0, 3)))
      ).slice(0, 3);
      
      if (potentialMatches.length > 0) {
        console.log(`🔍 Potential matches found:`, potentialMatches);
      }
      
      return null;
    }

    // Generate the link
    const encodedType2 = gallery.type2.replace(/ /g, '%20');
    const productLink = `app.zulu.club/${encodedType2}`;
    
    console.log(`🔗 Generated product link: ${productLink}`);
    console.log(`📊 Gallery match details:`, {
      categoryId: category.id,
      cat1Array: gallery.cat1,
      type2: gallery.type2
    });
    
    return {
      category: category.name,
      link: productLink,
      type2: gallery.type2,
      categoryId: category.id
    };

  } catch (error) {
    console.error('💥 Error generating product link:', error);
    return null;
  }
}

// NEW: Function to create AI response with product link
async function createProductResponse(userMessage, productLinkInfo) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return `Great choice! Check out our ${productLinkInfo.category} collection here: ${productLinkInfo.link} 🛍️`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a friendly Zulu Club shopping assistant. Create a helpful, engaging response that includes the product link.
          
          ZULU CLUB INFORMATION:
          ${ZULU_CLUB_INFO}
          
          Always include these key points:
          - 100-minute delivery in Gurgaon
          - Try at home, easy returns
          - Mention the specific product category
          - Include the provided link
          - Keep it under 300 characters for WhatsApp
          - Use emojis to make it engaging
          
          Product Link: ${productLinkInfo.link}
          Category: ${productLinkInfo.category}`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 150,
      temperature: 0.7
    });

    let response = completion.choices[0].message.content.trim();
    
    // Ensure the link is included
    if (!response.includes(productLinkInfo.link)) {
      response += `\n\nCheck it out here: ${productLinkInfo.link}`;
    }

    return response;

  } catch (error) {
    console.error('❌ Error creating product response:', error);
    return `Perfect! Explore our ${productLinkInfo.category} collection: ${productLinkInfo.link}\n\n🚀 100-min delivery | 💫 Try at home | 🔄 Easy returns`;
  }
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

// Function to generate category response (for AI to use in its responses)
function generateCategoryResponse(userMessage = '') {
  const msg = userMessage.toLowerCase();
  
  // Check for specific category mentions
  for (const [category, data] of Object.entries(CATEGORIES)) {
    const categoryLower = category.toLowerCase();
    if (msg.includes(categoryLower)) {
      
      // Return specific category with subcategories
      let response = `🛍️ *${category}* \n\n`;
      response += `Explore our ${category.toLowerCase()} collection:\n`;
      response += `🔗 ${data.link}\n\n`;
      
      response += `\nVisit the link to browse products! 🛒`;
      return response;
    }
  }
  
  // General product query - show all categories
  let response = `🛍️ *Our Product Categories* \n\n`;
  response += `We have an amazing range of lifestyle products! Here are our main categories:\n\n`;
  
  Object.entries(CATEGORIES).forEach(([category, data]) => {
    response += `• *${category}*: ${data.link}\n`;
  });
  
  response += `\n💡 *Pro Tip:* You can ask about specific categories like "women's fashion" or "home decor"!\n\n`;
  response += `🚀 *100-minute delivery* | 💫 *Try at home* | 🔄 *Easy returns*`;
  
  return response;
}

// Function to get category links for AI reference
function getCategoryLinks() {
  let links = "CATEGORY LINKS:\n";
  Object.entries(CATEGORIES).forEach(([category, data]) => {
    links += `- ${category}: ${data.link}\n`;
  });
  return links;
}

// NEW: Enhanced AI Chat Functionality with Product Detection
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // NEW: Check if this is a product request and handle with new logic
    const productKeywords = [
      'need', 'want', 'looking for', 'show me', 'have', 'buy', 'shop',
      'tshirt', 'shirt', 'jean', 'pant', 'shoe', 'dress', 'top', 'bottom',
      'bag', 'watch', 'jewelry', 'accessory', 'beauty', 'skincare', 'home',
      'decor', 'footwear', 'fashion', 'kids', 'gift', 'lifestyle'
    ];

    const userMsgLower = userMessage.toLowerCase();
    const isProductQuery = productKeywords.some(keyword => userMsgLower.includes(keyword));

    if (isProductQuery) {
      console.log('🔄 Detected product query, using new logic...');
      
      // Generate product link using new logic
      const productLinkInfo = await generateProductLink(userMessage);
      
      if (productLinkInfo) {
        console.log('✅ Product link generated, creating AI response...');
        const productResponse = await createProductResponse(userMessage, productLinkInfo);
        return productResponse;
      } else {
        console.log('❌ New logic failed, falling back to original AI...');
      }
    }

    // Original AI logic continues here...
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
    
    // Get AI response (now includes new product detection logic)
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

// NEW: Endpoint to check CSV data status
app.get('/csv-status', (req, res) => {
  res.json({
    isCSVLoaded: isCSVLoaded,
    csvLoadAttempts: csvLoadAttempts,
    categoriesCount: categoriesData.length,
    galleriesCount: galleriesData.length,
    categoriesSample: categoriesData.slice(0, 5),
    galleriesSample: galleriesData.slice(0, 5)
  });
});

// NEW: Endpoint to manually reload CSV data
app.post('/reload-csv', async (req, res) => {
  try {
    isCSVLoaded = false;
    csvLoadAttempts = 0;
    
    const success = await loadAllCSVData();
    
    res.json({
      success: success,
      isCSVLoaded: isCSVLoaded,
      categoriesCount: categoriesData.length,
      galleriesCount: galleriesData.length
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// NEW: Test product detection endpoint
app.post('/test-product-detection', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const productLinkInfo = await generateProductLink(message);
    const aiResponse = productLinkInfo ? await createProductResponse(message, productLinkInfo) : 'No product link generated';
    
    res.json({
      userMessage: message,
      productLinkInfo: productLinkInfo,
      aiResponse: aiResponse,
      csvStatus: {
        isCSVLoaded: isCSVLoaded,
        categoriesCount: categoriesData.length,
        galleriesCount: galleriesData.length
      }
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// NEW: Debug endpoint to check specific category matching
app.get('/debug-category/:categoryId', (req, res) => {
  const categoryId = req.params.categoryId;
  
  const category = categoriesData.find(cat => cat.id === categoryId);
  const galleries = galleriesData.filter(g => {
    if (Array.isArray(g.cat1)) {
      return g.cat1.includes(categoryId);
    } else {
      return g.cat1 === categoryId;
    }
  });
  
  res.json({
    categoryId,
    category: category || 'Not found',
    matchingGalleries: galleries,
    totalMatches: galleries.length
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '4.1 - Enhanced with Product Detection & CSV Integration',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      smart_categories: 'AI decides when to show categories',
      product_detection: 'New CSV-based product category detection',
      csv_integration: '268+ categories from GitHub CSV files',
      dynamic_links: 'Automated product link generation',
      whatsapp_integration: 'Gallabox API integration'
    },
    csv_status: {
      loaded: isCSVLoaded,
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      csv_status: 'GET /csv-status',
      reload_csv: 'POST /reload-csv',
      test_detection: 'POST /test-product-detection',
      debug_category: 'GET /debug-category/:categoryId',
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
    csv_categories_loaded: categoriesData.length,
    total_categories: Object.keys(CATEGORIES).length,
    approach: 'Dual-mode: AI-driven category display + CSV-based product detection'
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

// NEW: Initialize CSV data loading when server starts (but don't block startup)
console.log('🚀 Starting Zulu Club AI Assistant with Enhanced Product Detection...');
setTimeout(() => {
  loadAllCSVData().then(success => {
    if (success) {
      console.log('🎉 CSV data initialization completed successfully!');
    } else {
      console.log('⚠️ CSV data initialization completed with warnings');
    }
  });
}, 1000); // Delay startup to let server initialize first

// Export for Vercel
module.exports = app;

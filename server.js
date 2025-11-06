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

// Store conversations with gender context
let conversations = {};

// ZULU CLUB INFORMATION
const ZULU_CLUB_INFO = `
We're building a new way to shop and discover lifestyle products online.

Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.

Browse and shop high-quality lifestyle products across categories you love:

- Women's Fashion — dresses, tops, co-ords, winterwear, loungewear & more
- Men's Fashion — shirts, tees, jackets, athleisure & more
- Kids — clothing, toys, learning kits & accessories
- Footwear — sneakers, heels, flats, sandals & kids shoes
- Home Decor — showpieces, vases, lamps, aroma decor, premium home accessories, fountains
- Beauty & Self-Care — skincare, bodycare, fragrances & grooming essentials
- Fashion Accessories — bags, jewelry, watches, sunglasses & belts
- Lifestyle Gifting — curated gift sets & décor-based gifting

And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.

Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on app.zulu.club
We may have other items which not listed 
We don't deliver in Delhi or India, we only deliver in Gurgaon all over for free 
`;

// NEW: Gender mapping for cat_id
const GENDER_MAPPING = {
  'men': ['1921', '1922', '1989', '1993'], // Men's category IDs
  'women': ['1921', '1922', '1933', '1936', '1939', '1955'], // Women's category IDs  
  'kids': ['1921', '1922', '1967', '1970', '1973', '1976'] // Kids category IDs
};

// NEW: CSV Data Storage
let categoriesData = []; // Store categories1.csv data
let galleriesData = [];  // Store galleries1.csv data
let isCSVLoaded = false;
let csvLoadAttempts = 0;
const MAX_CSV_ATTEMPTS = 10;

// NEW: Function to load CSV from GitHub raw content
async function loadCSVFromGitHub(csvUrl, isGalleries = false) {
  try {
    console.log(`📥 Loading CSV from: ${csvUrl}`);
    
    // Convert GitHub blob URL to raw URL
    const rawUrl = csvUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    
    const response = await axios.get(rawUrl, { timeout: 15000 });
    const csvContent = response.data;
    
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(csvContent);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          if (isGalleries) {
            // For galleries1.csv, we need cat1, type2, and cat_id columns
            if (data.cat1 && data.type2 && data.cat_id) {
              // Parse cat1 which can be in different formats
              let cat1Array = [];
              
              try {
                if (data.cat1.startsWith('[') && data.cat1.endsWith(']')) {
                  const cleanCat1 = data.cat1.replace(/[\[\]"]/g, '');
                  cat1Array = cleanCat1.split(',').map(item => item.trim()).filter(item => item);
                } else {
                  cat1Array = data.cat1.split(',').map(item => item.trim()).filter(item => item);
                }
              } catch (error) {
                console.log(`❌ Error parsing cat1: ${data.cat1}`, error);
                cat1Array = [];
              }
              
              if (cat1Array.length > 0) {
                results.push({
                  cat1: cat1Array,
                  type2: data.type2.trim(),
                  cat_id: data.cat_id.trim() // Store cat_id for gender filtering
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

    const categoriesUrl = 'https://github.com/Rishi-Singhal-714/gallabox-bot/blob/main/categories1.csv';
    const galleriesUrl = 'https://github.com/Rishi-Singhal-714/gallabox-bot/blob/main/galleries1.csv';

    const [categoriesResult, galleriesResult] = await Promise.all([
      loadCSVFromGitHub(categoriesUrl, false),
      loadCSVFromGitHub(galleriesUrl, true)
    ]);

    categoriesData = categoriesResult;
    galleriesData = galleriesResult;

    console.log(`📊 CSV Data Summary:`);
    console.log(`   - Categories loaded: ${categoriesData.length}`);
    console.log(`   - Galleries loaded: ${galleriesData.length}`);
    
    // Log unique cat_id values for debugging
    const uniqueCatIds = [...new Set(galleriesData.map(g => g.cat_id))];
    console.log(`   - Unique cat_id values:`, uniqueCatIds);

    const hasEnoughData = categoriesData.length > 200 && galleriesData.length > 0;
    if (hasEnoughData) {
      isCSVLoaded = true;
      console.log('🎉 Successfully loaded all CSV data!');
      return true;
    } else {
      console.log(`⚠️ Loaded ${categoriesData.length} categories (expected 200+) and ${galleriesData.length} galleries`);
      if (csvLoadAttempts < MAX_CSV_ATTEMPTS) {
        console.log(`⏳ Retrying in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        return loadAllCSVData();
      } else {
        console.log('❌ Max retry attempts reached');
        return false;
      }
    }
  } catch (error) {
    console.error('💥 Error loading CSV data:', error.message);
    if (csvLoadAttempts < MAX_CSV_ATTEMPTS) {
      console.log(`⏳ Retrying in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return loadAllCSVData();
    } else {
      console.log('❌ Max retry attempts reached');
      return false;
    }
  }
}

// NEW: Function to detect gender from message
function detectGender(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  
  if (msg.includes(' men') || msg.includes('man') || msg.includes('male') || msg === 'men') {
    return 'men';
  } else if (msg.includes(' women') || msg.includes('woman') || msg.includes('female') || msg.includes('ladies') || msg === 'women') {
    return 'women';
  } else if (msg.includes(' kids') || msg.includes('child') || msg.includes('boy') || msg.includes('girl') || msg === 'kids') {
    return 'kids';
  }
  
  return null;
}

// NEW: Function to detect product category using GPT with gender context
async function detectProductCategory(userMessage, conversationContext = {}) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not available for category detection');
      return { category: null, gender: null };
    }

    // Prepare category names for context
    const categoryNames = categoriesData.map(cat => cat.name).slice(0, 50);

    // Build context with gender information if available
    let systemContext = `You are a product category classifier for an e-commerce store. 
    Analyze the user's message and identify which product category they are looking for.
    Available categories include: ${categoryNames.join(', ')}`;
    
    if (conversationContext.waitingForGender) {
      systemContext += `\n\nCONTEXT: The user was previously asked about gender preference. This message might be their response.`;
    }
    
    if (conversationContext.detectedCategory) {
      systemContext += `\n\nCONTEXT: Previously detected category: ${conversationContext.detectedCategory}`;
    }

    systemContext += `\n\nRespond ONLY with the exact category name that best matches the user's request.
    If no clear category matches, respond with "null".`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemContext
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
    
    if (detectedCategory === 'null' || !detectedCategory) {
      console.log('🤖 No specific category detected');
      return { category: null, gender: null };
    }

    console.log(`🤖 Detected category: "${detectedCategory}"`);
    
    // Also detect gender from the current message
    const detectedGender = detectGender(userMessage);
    
    return { 
      category: detectedCategory, 
      gender: detectedGender 
    };

  } catch (error) {
    console.error('❌ Error detecting product category:', error);
    return { category: null, gender: null };
  }
}

// NEW: Function to filter galleries by gender using cat_id
function filterGalleriesByGender(galleries, gender) {
  if (!gender) return galleries;
  
  const genderCategoryIds = GENDER_MAPPING[gender];
  if (!genderCategoryIds) return galleries;
  
  console.log(`🎯 Filtering galleries for gender: ${gender} with category IDs:`, genderCategoryIds);
  
  return galleries.filter(gallery => {
    // Check if gallery's cat_id matches any of the gender-specific category IDs
    return genderCategoryIds.includes(gallery.cat_id);
  });
}

// NEW: Enhanced function to generate product links with gender filtering
async function generateProductLinks(userMessage, conversationContext = {}) {
  try {
    // Wait for CSV data to be loaded
    if (!isCSVLoaded) {
      console.log('⏳ CSV data not loaded yet, loading now...');
      await loadAllCSVData();
    }

    if (!isCSVLoaded) {
      console.log('❌ CSV data not available for product linking');
      return null;
    }

    // Detect category and gender using GPT
    const detected = await detectProductCategory(userMessage, conversationContext);
    const detectedCategory = detected.category;
    const detectedGender = detected.gender;
    
    if (!detectedCategory) {
      console.log('❌ No category detected from user message');
      return null;
    }

    console.log(`🤖 Detected category: "${detectedCategory}", gender: "${detectedGender}"`);

    // Find ALL potential matching categories
    const potentialCategories = categoriesData.filter(cat => {
      const catNameLower = cat.name.toLowerCase();
      const detectedLower = detectedCategory.toLowerCase();
      
      return (
        catNameLower === detectedLower ||
        catNameLower.includes(detectedLower) ||
        detectedLower.includes(catNameLower) ||
        catNameLower.split(' ').some(word => detectedLower.includes(word)) ||
        detectedLower.split(' ').some(word => catNameLower.includes(word)) ||
        catNameLower.replace(/\s+/g, '') === detectedLower.replace(/\s+/g, '') ||
        (detectedLower.length > 3 && (
          catNameLower.includes(detectedLower) ||
          detectedLower.includes(catNameLower)
        ))
      );
    });

    if (potentialCategories.length === 0) {
      console.log(`❌ No potential categories found for: "${detectedCategory}"`);
      return null;
    }

    console.log(`🎯 Found ${potentialCategories.length} potential categories for "${detectedCategory}":`, 
      potentialCategories.map(cat => `${cat.name} (${cat.id})`));

    // Try each potential category until we find one with galleries
    let successfulCategory = null;
    let matchingGalleries = [];
    let triedCategories = [];

    for (const category of potentialCategories) {
      triedCategories.push(category.name);
      console.log(`🔄 Trying category: ${category.name} (ID: ${category.id})`);
      
      // Find galleries for this category
      let galleriesForCategory = galleriesData.filter(g => {
        if (Array.isArray(g.cat1)) {
          return g.cat1.includes(category.id);
        } else {
          return g.cat1 === category.id;
        }
      });
      
      // Apply gender filtering if gender is detected
      if (detectedGender) {
        const beforeFilter = galleriesForCategory.length;
        galleriesForCategory = filterGalleriesByGender(galleriesForCategory, detectedGender);
        const afterFilter = galleriesForCategory.length;
        console.log(`👕 Gender filtering: ${beforeFilter} → ${afterFilter} galleries for ${detectedGender}`);
      }
      
      if (galleriesForCategory.length > 0) {
        console.log(`✅ Found ${galleriesForCategory.length} galleries for category: ${category.name}`);
        successfulCategory = category;
        matchingGalleries = galleriesForCategory;
        break;
      } else {
        console.log(`❌ No galleries found for category: ${category.name}`);
      }
    }

    if (!successfulCategory) {
      console.log(`💥 No galleries found for any of the ${triedCategories.length} potential categories:`, triedCategories);
      return null;
    }

    console.log(`🎉 Using category: ${successfulCategory.name} with ${matchingGalleries.length} galleries`);

    // Generate multiple links from all matching galleries
    const productLinks = matchingGalleries.map(gallery => {
      const encodedType2 = gallery.type2.replace(/ /g, '%20');
      const productLink = `app.zulu.club/${encodedType2}`;
      
      return {
        category: successfulCategory.name,
        link: productLink,
        type2: gallery.type2,
        categoryId: successfulCategory.id,
        gender: detectedGender
      };
    });

    // Remove duplicate links (same type2)
    const uniqueLinks = productLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.link === link.link)
    );

    console.log(`🔗 Generated ${uniqueLinks.length} unique product links`);
    uniqueLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. ${link.link} (${link.type2})`);
    });
    
    return {
      category: successfulCategory.name,
      gender: detectedGender,
      links: uniqueLinks,
      totalMatches: matchingGalleries.length,
      triedCategories: triedCategories,
      finalCategory: successfulCategory.name
    };

  } catch (error) {
    console.error('💥 Error generating product links:', error);
    return null;
  }
}

// NEW: Function to create AI response with gender context
async function createProductResponse(userMessage, productLinksInfo, conversationContext = {}) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      let response = `Great choice! `;
      
      if (productLinksInfo.gender) {
        response += `For ${productLinksInfo.gender}, `;
      }
      
      if (productLinksInfo.triedCategories && productLinksInfo.triedCategories.length > 1) {
        response += `I found ${productLinksInfo.links.length} collections in our ${productLinksInfo.category} category`;
      } else {
        response += `Check out our ${productLinksInfo.category} collections:\n\n`;
      }
      
      productLinksInfo.links.forEach(link => {
        response += `• ${link.link}\n`;
      });
      response += `\n🚀 100-min delivery | 💫 Try at home | 🔄 Easy returns`;
      return response;
    }

    let systemContext = `You are a friendly Zulu Club shopping assistant. Create a helpful, engaging response that includes multiple product links.
    
    ZULU CLUB INFORMATION:
    ${ZULU_CLUB_INFO}`;

    // Add gender context if available
    if (productLinksInfo.gender) {
      systemContext += `\n\nGENDER CONTEXT: The user is looking for ${productLinksInfo.gender}'s products.`;
    }

    if (conversationContext.waitingForGender && conversationContext.detectedCategory) {
      systemContext += `\n\nCONVERSATION CONTEXT: You just asked the user about gender preference for ${conversationContext.detectedCategory}, and they responded with their preference.`;
    }

    systemContext += `\n\nAlways include these key points:
    - 100-minute delivery in Gurgaon
    - Try at home, easy returns
    - Mention the specific product category
    - Include ALL the provided links naturally in the response
    - Keep it under 400 characters for WhatsApp
    - Use emojis to make it engaging
    - If there are multiple links, mention they are different collections/varieties
    
    Product Links: ${productLinksInfo.links.map(link => link.link).join(', ')}
    Category: ${productLinksInfo.category}
    ${productLinksInfo.gender ? `Gender: ${productLinksInfo.gender}` : ''}
    Total Collections: ${productLinksInfo.links.length}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemContext
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 200,
      temperature: 0.7
    });

    let response = completion.choices[0].message.content.trim();
    
    // Ensure all links are included if AI missed some
    const includedLinks = productLinksInfo.links.filter(link => 
      response.includes(link.link)
    );
    
    if (includedLinks.length < productLinksInfo.links.length) {
      console.log(`⚠️ AI missed some links, adding them manually...`);
      response += `\n\nHere are our ${productLinksInfo.category} collections:\n`;
      productLinksInfo.links.forEach(link => {
        if (!response.includes(link.link)) {
          response += `• ${link.link}\n`;
        }
      });
    }

    return response;

  } catch (error) {
    console.error('❌ Error creating product response:', error);
    let response = `Perfect! `;
    if (productLinksInfo.gender) {
      response += `For ${productLinksInfo.gender}, `;
    }
    response += `explore our ${productLinksInfo.category} collections:\n\n`;
    productLinksInfo.links.forEach(link => {
      response += `• ${link.link}\n`;
    });
    response += `\n🚀 100-min delivery | 💫 Try at home | 🔄 Easy returns`;
    return response;
  }
}

// NEW: Function to ask for gender preference
function createGenderPrompt(category) {
  return `Great! I found ${category} options. Are you looking for:\n• Men's ${category}\n• Women's ${category}\n• Kids' ${category}\n\nPlease reply with "men", "women", or "kids" so I can show you the most relevant collections! 👕👗👶`;
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

// NEW: Enhanced AI Chat Functionality with Gender Context
async function getChatGPTResponse(userMessage, conversationHistory = [], sessionId = null) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // Get conversation context
    const conversationContext = conversations[sessionId]?.context || {};
    
    // Check if we're waiting for gender response
    if (conversationContext.waitingForGender) {
      const genderResponse = detectGender(userMessage);
      
      if (genderResponse) {
        // User provided gender, proceed with product search
        console.log(`🎯 User specified gender: ${genderResponse}`);
        
        // Update conversation context
        conversations[sessionId].context = {
          ...conversationContext,
          waitingForGender: false,
          userGender: genderResponse
        };
        
        // Generate product links with gender context
        const productLinksInfo = await generateProductLinks(userMessage, {
          detectedCategory: conversationContext.detectedCategory,
          userGender: genderResponse
        });
        
        if (productLinksInfo) {
          const productResponse = await createProductResponse(userMessage, productLinksInfo, {
            waitingForGender: true,
            detectedCategory: conversationContext.detectedCategory
          });
          return productResponse;
        }
      }
      // If no gender detected but we were waiting, continue waiting or handle gracefully
    }

    // Check for product queries
    const productKeywords = [
      // ... (same extensive product keywords list as before)
      'need', 'want', 'looking for', 'show me', 'have', 'buy', 'shop', 'order', 'get', 'find',
      'tshirt', 'shirt', 'jean', 'pant', 'shoe', 'dress', 'top', 'bottom',
      'bag', 'watch', 'jewelry', 'accessory', 'beauty', 'skincare', 'home',
      'decor', 'footwear', 'fashion', 'kids', 'gift', 'lifestyle',
      // ... (rest of the extensive list)
    ];

    const userMsgLower = userMessage.toLowerCase();
    const isProductQuery = productKeywords.some(keyword => userMsgLower.includes(keyword));

    if (isProductQuery && isCSVLoaded) {
      console.log('🔄 Detected product query, checking category and gender...');
      
      // First detect category
      const detected = await detectProductCategory(userMessage, conversationContext);
      
      if (detected.category && !detected.gender) {
        // Category detected but no gender - ask for gender preference
        console.log(`🤖 Category detected but no gender, asking for preference...`);
        
        // Store context for next message
        if (sessionId) {
          conversations[sessionId].context = {
            waitingForGender: true,
            detectedCategory: detected.category
          };
        }
        
        return createGenderPrompt(detected.category);
      } else if (detected.category && detected.gender) {
        // Both category and gender detected - proceed directly
        console.log(`🎯 Both category and gender detected, proceeding with search...`);
        const productLinksInfo = await generateProductLinks(userMessage, {
          detectedCategory: detected.category,
          userGender: detected.gender
        });
        
        if (productLinksInfo) {
          const productResponse = await createProductResponse(userMessage, productLinksInfo);
          return productResponse;
        }
      }
    }

    // Original AI logic for non-product queries
    const messages = [];
    
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${ZULU_CLUB_INFO}

      IMPORTANT RESPONSE GUIDELINES:
      1. **For product inquiries without gender specification**, ask if they're looking for men's, women's, or kids' versions
      2. **Use natural conversation flow** - don't force gender questions unnecessarily
      3. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      4. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
      5. **Use emojis** to make it engaging but professional
      6. **Keep responses under 400 characters** for WhatsApp compatibility
      7. **Be enthusiastic and helpful** - we're excited about our products!

      GENDER HANDLING EXAMPLES:
      - User: "I want tshirts" → "Great! Are you looking for men's, women's, or kids' tshirts? 👕"
      - User: "Show me dresses" → "I'd love to help! We have beautiful dresses for women and kids. Which are you looking for? 👗"
      - User: "Need shoes" → "Awesome! We have shoes for men, women, and kids. Which category interests you? 👞👠👟"

      Remember: Always ask for gender preference when products could be for different demographics, but keep it natural.
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
    return "Hi there! I'm excited to tell you about Zulu Club - your premium lifestyle shopping experience with 100-minute delivery in Gurgaon! What would you like to know about our products? 🛍️";
  }
}

// Enhanced Handle user message with gender context
async function handleMessage(sessionId, userMessage) {
  try {
    // Initialize conversation if not exists
    if (!conversations[sessionId]) {
      conversations[sessionId] = { 
        history: [],
        context: {}
      };
    }
    
    // Add user message to history
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage
    });
    
    // Get AI response with conversation context
    const aiResponse = await getChatGPTResponse(
      userMessage, 
      conversations[sessionId].history,
      sessionId
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

// ... (rest of the endpoints remain the same - /csv-status, /reload-csv, /test-product-detection, etc.)

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '7.0 - Gender-Aware Product Detection with Multi-Category Fallback',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      gender_detection: 'Automatic gender detection from user messages',
      gender_prompts: 'Smart gender preference asking',
      gender_filtering: 'Gallery filtering by men/women/kids using cat_id',
      product_detection: 'CSV-based product category detection',
      multi_category_fallback: 'Tries multiple similar categories',
      multi_link_support: 'Finds ALL matching galleries',
      csv_integration: '268+ categories from GitHub CSV files',
      dynamic_links: 'Automated product link generation',
      conversation_context: 'Maintains gender and category context across messages'
    },
    csv_status: {
      loaded: isCSVLoaded,
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length
    },
    timestamp: new Date().toISOString()
  });
});

// NEW: Initialize CSV data loading when server starts
console.log('🚀 Starting Zulu Club AI Assistant with Gender-Aware Product Detection...');
loadAllCSVData().then(success => {
  if (success) {
    console.log('🎉 CSV data initialization completed successfully!');
  } else {
    console.log('⚠️ CSV data initialization completed with warnings');
  }
});

// Export for Vercel
module.exports = app;

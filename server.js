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

// Store conversations with enhanced history tracking
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
- Home Decor — showpieces, vases, lamps, aroma decor, premium home accessories, fountains
- Beauty & Self-Care — skincare, bodycare, fragrances & grooming essentials
- Fashion Accessories — bags, jewelry, watches, sunglasses & belts
- Lifestyle Gifting — curated gift sets & décor-based gifting

And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.

Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on app.zulu.club
we may have other items which not listed 
we dont deliver in delhi or india we only deliver in gurgoan all over for free 
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

// NEW: Clothing categories that need gender/kids filtering
const CLOTHING_CATEGORIES = [
  "women's fashion", "men's fashion", "kids", "footwear",
  "topwear", "bottomwear", "dresses", "shirts", "tshirts", "jeans",
  "jackets", "sweaters", "activewear", "ethnicwear", "western wear",
  "lingerie", "sleepwear", "swimwear", "loungewear"
];

// Gender mapping for category IDs
const GENDER_CATEGORY_IDS = {
  'men': ['1', '2', '3'], // Example category IDs for men
  'women': ['4', '5', '6'], // Example category IDs for women  
  'kids': ['7', '8', '9'] // Example category IDs for kids
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
            if (data.cat1 && data.type2) {
              // Parse cat1 which can be in different formats:
              let cat1Array = [];
              let catId = data.cat_id || ''; // Get cat_id for gender filtering
              
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
                  type2: data.type2.trim(),
                  cat_id: catId.trim() // Store cat_id for gender filtering
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

    // Load both CSVs in parallel
    const [categoriesResult, galleriesResult] = await Promise.all([
      loadCSVFromGitHub(categoriesUrl, false),
      loadCSVFromGitHub(galleriesUrl, true)
    ]);

    categoriesData = categoriesResult;
    galleriesData = galleriesResult;

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
        type2: g.type2,
        cat_id: g.cat_id
      })));
    }

    // Check if we have enough data - be more flexible about the count
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

// NEW: Function to detect product category using GPT
async function detectProductCategory(userMessage) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not available for category detection');
      return null;
    }

    // Prepare category names for context
    const categoryNames = categoriesData.map(cat => cat.name).slice(0, 50);

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

// NEW: Function to detect gender preference from message
function detectGenderPreference(message) {
  const msg = message.toLowerCase();
  
  if (msg.includes(' men') || msg.includes(' men\'s') || msg.includes(' for men') || 
      msg.includes(' male') || msg.includes(' boys') || msg.includes(' gentleman')) {
    return 'men';
  }
  
  if (msg.includes(' women') || msg.includes(' women\'s') || msg.includes(' for women') || 
      msg.includes(' female') || msg.includes(' girls') || msg.includes(' lady') || msg.includes(' ladies')) {
    return 'women';
  }
  
  if (msg.includes(' kids') || msg.includes(' kid\'s') || msg.includes(' for kids') || 
      msg.includes(' children') || msg.includes(' child') || msg.includes(' boys') || msg.includes(' girls')) {
    return 'kids';
  }
  
  return null;
}

// NEW: Function to check if a category is clothing-related
function isClothingCategory(categoryName) {
  const categoryLower = categoryName.toLowerCase();
  return CLOTHING_CATEGORIES.some(clothingCat => 
    categoryLower.includes(clothingCat) || clothingCat.includes(categoryLower)
  );
}

// NEW: Function to filter galleries by gender preference
function filterGalleriesByGender(galleries, gender, categoryName) {
  if (!gender || !isClothingCategory(categoryName)) {
    console.log(`🔍 No gender filter applied (gender: ${gender}, isClothing: ${isClothingCategory(categoryName)})`);
    return galleries;
  }

  console.log(`🔍 Filtering ${galleries.length} galleries for gender: ${gender}`);
  
  const filteredGalleries = galleries.filter(gallery => {
    // If cat_id matches the gender preference, include it
    if (gallery.cat_id && GENDER_CATEGORY_IDS[gender]) {
      const shouldInclude = GENDER_CATEGORY_IDS[gender].includes(gallery.cat_id);
      if (shouldInclude) {
        console.log(`✅ Including gallery with cat_id: ${gallery.cat_id} for gender: ${gender}`);
      }
      return shouldInclude;
    }
    
    // If no cat_id or no gender mapping, include by default
    console.log(`⚠️ No cat_id filter applied for gallery: ${gallery.type2}`);
    return true;
  });

  console.log(`🔍 Gender filtering result: ${filteredGalleries.length} galleries after filtering`);
  return filteredGalleries;
}

// NEW: Enhanced function to generate product links with gender filtering
async function generateProductLinks(userMessage, conversationHistory = []) {
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

    // Detect category using GPT
    const detectedCategory = await detectProductCategory(userMessage);
    
    if (!detectedCategory) {
      console.log('❌ No category detected from user message');
      return null;
    }

    console.log(`🤖 Initially detected category: "${detectedCategory}"`);

    // NEW: Check conversation history for gender preferences
    let genderPreference = detectGenderPreference(userMessage);
    
    // If no gender in current message, check conversation history
    if (!genderPreference && conversationHistory.length > 0) {
      console.log('🕵️ Checking conversation history for gender preferences...');
      
      // Look for gender mentions in recent history (last 5 messages)
      const recentHistory = conversationHistory.slice(-5);
      for (const msg of recentHistory) {
        if (msg.role === 'user') {
          const historyGender = detectGenderPreference(msg.content);
          if (historyGender) {
            genderPreference = historyGender;
            console.log(`🕵️ Found gender preference from history: ${genderPreference}`);
            break;
          }
        }
      }
    }

    if (genderPreference) {
      console.log(`🎯 Gender preference detected: ${genderPreference}`);
    }

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

      // NEW: Apply gender filtering for clothing categories
      if (galleriesForCategory.length > 0 && genderPreference) {
        console.log(`👕 Applying gender filter (${genderPreference}) for clothing category: ${category.name}`);
        galleriesForCategory = filterGalleriesByGender(galleriesForCategory, genderPreference, category.name);
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
        cat_id: gallery.cat_id || 'none'
      };
    });

    // Remove duplicate links (same type2)
    const uniqueLinks = productLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.link === link.link)
    );

    console.log(`🔗 Generated ${uniqueLinks.length} unique product links`);
    uniqueLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. ${link.link} (${link.type2}) - cat_id: ${link.cat_id}`);
    });
    
    return {
      category: successfulCategory.name,
      links: uniqueLinks,
      totalMatches: matchingGalleries.length,
      triedCategories: triedCategories,
      finalCategory: successfulCategory.name,
      genderPreference: genderPreference, // NEW: Include gender preference in response
      isClothing: isClothingCategory(successfulCategory.name) // NEW: Include clothing flag
    };

  } catch (error) {
    console.error('💥 Error generating product links:', error);
    return null;
  }
}

// NEW: Enhanced function to create AI response with context awareness
async function createProductResponse(userMessage, productLinksInfo, conversationHistory = []) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      let response = `Great choice! `;
      
      // Mention gender preference if applicable
      if (productLinksInfo.genderPreference && productLinksInfo.isClothing) {
        response += `For ${productLinksInfo.genderPreference}, `;
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

    // Build context for AI
    let context = `Category: ${productLinksInfo.category}`;
    
    if (productLinksInfo.genderPreference && productLinksInfo.isClothing) {
      context += ` | Gender: ${productLinksInfo.genderPreference}`;
    }
    
    if (productLinksInfo.triedCategories && productLinksInfo.triedCategories.length > 1) {
      context += ` | Found after checking ${productLinksInfo.triedCategories.length} similar categories`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a friendly Zulu Club shopping assistant. Create a helpful, engaging response that includes multiple product links.
          
          ZULU CLUB INFORMATION:
          ${ZULU_CLUB_INFO}
          
          CONTEXT: ${context}
          
          Always include these key points:
          - 100-minute delivery in Gurgaon
          - Try at home, easy returns
          - Mention the specific product category
          - Include ALL the provided links naturally in the response
          - Keep it under 400 characters for WhatsApp
          - Use emojis to make it engaging
          - If there are multiple links, mention they are different collections/varieties
          - If gender preference is specified, acknowledge it naturally
          
          Product Links: ${productLinksInfo.links.map(link => link.link).join(', ')}`
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
    
    if (productLinksInfo.genderPreference && productLinksInfo.isClothing) {
      response += `For ${productLinksInfo.genderPreference}, `;
    }
    
    response += `explore our ${productLinksInfo.category} collections:\n\n`;
    productLinksInfo.links.forEach(link => {
      response += `• ${link.link}\n`;
    });
    response += `\n🚀 100-min delivery | 💫 Try at home | 🔄 Easy returns`;
    return response;
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

// NEW: Enhanced AI Chat Functionality with History Tracking
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // NEW: Enhanced product detection with history context
    const productKeywords = [
      // ... (same product keywords as before)
      'need', 'want', 'looking for', 'show me', 'have', 'buy', 'shop', 'order', 'get', 'find',
      'tshirt', 'shirt', 'jean', 'pant', 'shoe', 'dress', 'top', 'bottom',
      'bag', 'watch', 'jewelry', 'accessory', 'beauty', 'skincare', 'home',
      'decor', 'footwear', 'fashion', 'kids', 'gift', 'lifestyle',
      // ... (rest of the product keywords)
    ];

    const userMsgLower = userMessage.toLowerCase();
    const isProductQuery = productKeywords.some(keyword => userMsgLower.includes(keyword));

    if (isProductQuery && isCSVLoaded) {
      console.log('🔄 Detected product query, using enhanced logic with history...');
      
      // Generate product links using enhanced logic with conversation history
      const productLinksInfo = await generateProductLinks(userMessage, conversationHistory);
      
      if (productLinksInfo) {
        console.log('✅ Product links generated, creating AI response...');
        const productResponse = await createProductResponse(userMessage, productLinksInfo, conversationHistory);
        return productResponse;
      } else {
        console.log('❌ Enhanced logic failed, falling back to original AI...');
      }
    }

    // Original AI logic continues here...
    const messages = [];
    
    // Enhanced system message with history context
    const systemMessage = {
      role: "system",
      content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 
      
      ZULU CLUB INFORMATION:
      ${companyInfo}

      AVAILABLE CATEGORIES WITH LINKS:
      ${getCategoryLinks()}

      CONVERSATION HISTORY CONTEXT: 
      ${conversationHistory.length > 0 ? 
        `Recent conversation history available - use it to understand user preferences like gender (men/women/kids) for clothing items.` 
        : 'No recent history available.'}

      IMPORTANT RESPONSE GUIDELINES:
      1. **Remember user preferences** from conversation history (especially gender for clothing)
      2. **Use the category links naturally** in your responses when users ask about products
      3. **For clothing items**, acknowledge gender preferences if mentioned in history
      4. **Keep responses conversational** - don't just list categories unless specifically asked
      5. **Highlight key benefits**: 100-minute delivery, try-at-home, easy returns
      6. **Mention availability**: Currently in Gurgaon, pop-ups at AIPL Joy Street & AIPL Central
      7. **Use emojis** to make it engaging but professional
      8. **Keep responses under 400 characters** for WhatsApp compatibility
      9. **Be enthusiastic and helpful** - we're excited about our products!

      Remember: Use conversation history to provide personalized responses, especially for clothing categories where gender matters.
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

// NEW: Enhanced handleMessage function with better history tracking
async function handleMessage(sessionId, userMessage) {
  try {
    // Initialize conversation if not exists
    if (!conversations[sessionId]) {
      conversations[sessionId] = { 
        history: [],
        context: {
          lastProduct: null,
          genderPreference: null,
          lastCategory: null
        }
      };
    }
    
    // Add user message to history
    conversations[sessionId].history.push({
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString()
    });
    
    // Get AI response (now includes enhanced product detection with history)
    const aiResponse = await getChatGPTResponse(
      userMessage, 
      conversations[sessionId].history
    );
    
    // Add AI response to history
    conversations[sessionId].history.push({
      role: "assistant",
      content: aiResponse,
      timestamp: new Date().toISOString()
    });
    
    // NEW: Update context based on current interaction
    const genderPreference = detectGenderPreference(userMessage);
    if (genderPreference) {
      conversations[sessionId].context.genderPreference = genderPreference;
      console.log(`💾 Updated context - gender preference: ${genderPreference}`);
    }
    
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

// NEW: Enhanced debug endpoint to see conversation context
app.get('/debug-context/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const conversation = conversations[sessionId];
  
  if (!conversation) {
    return res.json({
      sessionId,
      exists: false,
      message: 'No conversation found for this session'
    });
  }
  
  res.json({
    sessionId,
    exists: true,
    context: conversation.context,
    historyLength: conversation.history.length,
    recentHistory: conversation.history.slice(-3).map(msg => ({
      role: msg.role,
      content: msg.content.substring(0, 100) + '...',
      timestamp: msg.timestamp
    }))
  });
});

// NEW: Test endpoint for gender-aware product detection
app.post('/test-gender-detection', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }
    
    // Simulate conversation history
    let sessionId = 'test-session';
    conversations[sessionId] = { history: [], context: {} };
    
    // Process messages in sequence
    const results = [];
    for (const message of messages) {
      conversations[sessionId].history.push({
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      });
      
      const productLinksInfo = await generateProductLinks(message, conversations[sessionId].history);
      const genderPreference = detectGenderPreference(message);
      
      results.push({
        userMessage: message,
        genderDetected: genderPreference,
        productLinksInfo: productLinksInfo,
        currentContext: { ...conversations[sessionId].context }
      });
      
      // Update context
      if (genderPreference) {
        conversations[sessionId].context.genderPreference = genderPreference;
      }
    }
    
    // Clean up
    delete conversations[sessionId];
    
    res.json({
      testType: 'Gender-aware product detection',
      messageCount: messages.length,
      results: results
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// ... (rest of the endpoints remain the same - health, csv-status, reload-csv, etc.)

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '7.0 - Enhanced History & Gender-Aware Product Detection',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      smart_categories: 'AI decides when to show categories',
      product_detection: 'CSV-based product category detection',
      multi_category_fallback: 'Tries multiple similar categories when no galleries found',
      multi_link_support: 'Finds ALL matching galleries and generates multiple links',
      conversation_history: 'Tracks user preferences across messages',
      gender_aware_filtering: 'Filters clothing items by men/women/kids using cat_id',
      csv_integration: '268+ categories from GitHub CSV files',
      dynamic_links: 'Automated product link generation from all galleries',
      whatsapp_integration: 'Gallabox API integration'
    },
    csv_status: {
      loaded: isCSVLoaded,
      categories_loaded: categoriesData.length,
      galleries_loaded: galleriesData.length
    },
    active_conversations: Object.keys(conversations).length,
    timestamp: new Date().toISOString()
  });
});

// Initialize CSV data loading when server starts
console.log('🚀 Starting Zulu Club AI Assistant with Enhanced History & Gender Filtering...');
loadAllCSVData().then(success => {
  if (success) {
    console.log('🎉 CSV data initialization completed successfully!');
  } else {
    console.log('⚠️ CSV data initialization completed with warnings');
  }
});

// Export for Vercel
module.exports = app;

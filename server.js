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
        type2: g.type2
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

// NEW: Improved function to detect product category using GPT
async function detectProductCategory(userMessage) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not available for category detection');
      return null;
    }

    // Prepare category names for context - use actual categories from CSV
    const categoryNames = categoriesData.map(cat => cat.name).slice(0, 100); // Increase limit

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product category classifier for an e-commerce store. 
          Analyze the user's message and identify which SINGLE product category they are looking for.
          
          AVAILABLE CATEGORIES: ${categoryNames.join(', ')}
          
          IMPORTANT RULES:
          1. Respond ONLY with the EXACT category name from the available categories list
          2. Choose the MOST SPECIFIC category that matches the user's request
          3. If no clear category matches, respond with "null"
          4. Do not add any explanations or additional text
          5. If multiple categories could fit, choose the one that is most commonly associated with the product
          
          EXAMPLES:
          User: "I need tshirt" -> "Topwear"
          User: "want shoes" -> "Footwear" 
          User: "looking for jeans" -> "Bottomwear"
          User: "show me bags" -> "Bags"
          User: "home decoration items" -> "Home Decor"
          User: "gift for friend" -> "Gifting"
          User: "beauty products" -> "Beauty & Personal Care"
          User: "hello" -> "null"
          User: "what products do you have" -> "null"`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 50,
      temperature: 0.1 // Lower temperature for more consistent results
    });

    const detectedCategory = completion.choices[0].message.content.trim();
    
    // Clean up response - remove quotes, periods, etc.
    const cleanCategory = detectedCategory.replace(/["'.]/g, '').trim();
    
    if (cleanCategory === 'null' || !cleanCategory) {
      console.log('🤖 No specific category detected');
      return null;
    }

    console.log(`🤖 Detected category: "${cleanCategory}"`);
    return cleanCategory;

  } catch (error) {
    console.error('❌ Error detecting product category:', error);
    return null;
  }
}

// NEW: Enhanced function to find ALL matching galleries with better relevance scoring
async function generateProductLinks(userMessage) {
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

    // NEW: Enhanced category matching with relevance scoring
    const scoredCategories = categoriesData.map(cat => {
      const catNameLower = cat.name.toLowerCase();
      const detectedLower = detectedCategory.toLowerCase();
      let score = 0;

      // Exact match (highest priority)
      if (catNameLower === detectedLower) {
        score = 100;
      }
      // Contains match (category contains detected term)
      else if (catNameLower.includes(detectedLower)) {
        score = 80;
      }
      // Detected term contains category (second priority)
      else if (detectedLower.includes(catNameLower)) {
        score = 70;
      }
      // Word boundary matches
      else {
        const catWords = catNameLower.split(/\s+/);
        const detectedWords = detectedLower.split(/\s+/);
        
        // Count matching words
        const matchingWords = catWords.filter(catWord => 
          detectedWords.some(detectedWord => 
            catWord.includes(detectedWord) || detectedWord.includes(catWord)
          )
        ).length;
        
        if (matchingWords > 0) {
          score = 50 + (matchingWords * 5); // Base 50 + 5 per matching word
        }
        // Common variations (like "home decor" vs "homedecor")
        else if (catNameLower.replace(/\s+/g, '') === detectedLower.replace(/\s+/g, '')) {
          score = 60;
        }
        // Partial matches for longer terms
        else if (detectedLower.length > 3) {
          if (catNameLower.includes(detectedLower)) {
            score = 40;
          } else if (detectedLower.includes(catNameLower)) {
            score = 35;
          }
        }
      }

      return {
        ...cat,
        score: score,
        name: cat.name // Keep original name
      };
    });

    // Filter out non-matching categories and sort by score
    const potentialCategories = scoredCategories
      .filter(cat => cat.score > 0)
      .sort((a, b) => b.score - a.score);

    if (potentialCategories.length === 0) {
      console.log(`❌ No potential categories found for: "${detectedCategory}"`);
      return null;
    }

    console.log(`🎯 Found ${potentialCategories.length} potential categories for "${detectedCategory}":`, 
      potentialCategories.map(cat => `${cat.name} (score: ${cat.score})`).slice(0, 10)); // Show top 10

    // NEW: Try ALL categories in order of relevance until we find one with galleries
    let successfulCategory = null;
    let matchingGalleries = [];
    let triedCategories = [];

    for (const category of potentialCategories) {
      triedCategories.push(`${category.name} (score: ${category.score})`);
      console.log(`🔄 Trying category: ${category.name} (Score: ${category.score}, ID: ${category.id})`);
      
      // Find galleries for this category
      const galleriesForCategory = galleriesData.filter(g => {
        if (Array.isArray(g.cat1)) {
          return g.cat1.includes(category.id);
        } else {
          return g.cat1 === category.id;
        }
      });
      
      if (galleriesForCategory.length > 0) {
        console.log(`✅ Found ${galleriesForCategory.length} galleries for category: ${category.name}`);
        successfulCategory = category;
        matchingGalleries = galleriesForCategory;
        
        // NEW: Don't break immediately - check if we have a better match with same score?
        // If this is an exact match (score 100), we can break immediately
        if (category.score === 100) {
          console.log(`🎯 Exact match found, stopping search`);
          break;
        }
        // Otherwise continue to see if there's a better match with galleries
      } else {
        console.log(`❌ No galleries found for category: ${category.name}`);
      }
    }

    // NEW: If we found multiple categories with galleries, pick the highest scored one
    if (!successfulCategory && potentialCategories.length > 0) {
      console.log(`💥 No galleries found for any of the ${triedCategories.length} potential categories`);
      
      // NEW: Fallback - try to find any category that might be relevant, even without exact matching
      const fallbackCategories = categoriesData.filter(cat => {
        const catNameLower = cat.name.toLowerCase();
        const userMsgLower = userMessage.toLowerCase();
        
        // Broader matching for fallback
        return userMsgLower.split(/\s+/).some(word => 
          word.length > 3 && catNameLower.includes(word)
        );
      });
      
      console.log(`🔄 Trying ${fallbackCategories.length} fallback categories...`);
      
      for (const category of fallbackCategories.slice(0, 5)) { // Limit to top 5 fallbacks
        const galleriesForCategory = galleriesData.filter(g => {
          if (Array.isArray(g.cat1)) {
            return g.cat1.includes(category.id);
          } else {
            return g.cat1 === category.id;
          }
        });
        
        if (galleriesForCategory.length > 0) {
          console.log(`🎉 Fallback success with category: ${category.name}`);
          successfulCategory = category;
          matchingGalleries = galleriesForCategory;
          break;
        }
      }
    }

    if (!successfulCategory) {
      console.log(`💥 No galleries found after all attempts`);
      return null;
    }

    console.log(`🎉 Final selected category: ${successfulCategory.name} (Score: ${successfulCategory.score}) with ${matchingGalleries.length} galleries`);

    // Generate multiple links from all matching galleries
    const productLinks = matchingGalleries.map(gallery => {
      const encodedType2 = encodeURIComponent(gallery.type2);
      const productLink = `app.zulu.club/${encodedType2}`;
      
      return {
        category: successfulCategory.name,
        link: productLink,
        type2: gallery.type2,
        categoryId: successfulCategory.id,
        relevanceScore: successfulCategory.score
      };
    });

    // Remove duplicate links (same type2)
    const uniqueLinks = productLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.link === l.link)
    );

    console.log(`🔗 Generated ${uniqueLinks.length} unique product links`);
    uniqueLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. ${link.link} (${link.type2})`);
    });
    
    return {
      category: successfulCategory.name,
      links: uniqueLinks,
      totalMatches: matchingGalleries.length,
      triedCategories: triedCategories,
      finalCategory: successfulCategory.name,
      relevanceScore: successfulCategory.score,
      allScores: potentialCategories.map(cat => `${cat.name}: ${cat.score}`)
    };

  } catch (error) {
    console.error('💥 Error generating product links:', error);
    return null;
  }
}

// NEW: Function to create AI response with multiple product links
async function createProductResponse(userMessage, productLinksInfo) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      let response = `Great choice! `;
      
      // Mention if we used a fallback category
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

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a friendly Zulu Club shopping assistant. Create a helpful, engaging response that includes multiple product links.
          
          ZULU CLUB INFORMATION:
          ${ZULU_CLUB_INFO}
          
          Always include these key points:
          - 100-minute delivery in Gurgaon
          - Try at home, easy returns
          - Mention the specific product category
          - Include ALL the provided links naturally in the response
          - Keep it under 400 characters for WhatsApp
          - Use emojis to make it engaging
          - If there are multiple links, mention they are different collections/varieties
          
          Product Links: ${productLinksInfo.links.map(link => link.link).join(', ')}
          Category: ${productLinksInfo.category}
          Total Collections: ${productLinksInfo.links.length}
          ${productLinksInfo.triedCategories && productLinksInfo.triedCategories.length > 1 ? 
            `Note: Found results in category "${productLinksInfo.finalCategory}" after checking multiple similar categories.` : ''}`
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
    let response = `Perfect! Explore our ${productLinksInfo.category} collections:\n\n`;
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

// NEW: Enhanced AI Chat Functionality with Product Detection
async function getChatGPTResponse(userMessage, conversationHistory = [], companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }
  
  try {
    // NEW: Check if this is a product request and handle with new logic
const productKeywords = [
  // Common Buying Intents
  'need', 'want', 'looking for', 'show me', 'have', 'buy', 'shop', 'order', 'get', 'find',

  // General
  'tshirt', 'shirt', 'jean', 'pant', 'shoe', 'dress', 'top', 'bottom',
  'bag', 'watch', 'jewelry', 'accessory', 'beauty', 'skincare', 'home',
  'decor', 'footwear', 'fashion', 'kids', 'gift', 'lifestyle',

  // 👕 MEN
  'men', 'mens', 'menswear', 'men clothing', 't shirts', 'casual shirts', 'formal shirts',
  'co-ord sets', 'sweaters', 'jackets', 'blazers', 'suits', 'rain jackets',
  'trousers', 'jeans', 'shorts', 'track pants', 'joggers',
  'briefs', 'trunks', 'boxers', 'vests', 'loungewear', 'sleepwear', 'thermals',
  'kurta', 'kurta sets', 'sherwani', 'nehru jacket', 'dhoti',
  'casual shoes', 'sports shoes', 'formal shoes', 'sandals', 'floaters',
  'flip flops', 'socks', 'belts', 'ties', 'cufflinks', 'pocket squares',
  'perfume', 'deodorant', 'trimmer', 'grooming kit', 'wallet', 'cap', 'hat',
  'muffler', 'scarf', 'gloves', 'helmet',

  // 👗 WOMEN
  'women', 'womenswear', 'ladies', 'girls', 'tops', 'dresses', 'jeans', 'skirts', 'shorts',
  'co-ords', 'playsuit', 'jumpsuit', 'shrug', 'sweater', 'coat', 'blazer', 'waistcoat',
  'kurta', 'kurti', 'tunic', 'saree', 'ethnicwear', 'leggings', 'salwar', 'churidar',
  'palazzo', 'dress material', 'lehenga', 'choli', 'dupatta', 'shawl',
  'heels', 'flats', 'boots', 'wedges', 'slippers', 'sports shoes', 'floaters',
  'bra', 'briefs', 'shapewear', 'nightwear', 'swimwear', 'maternity wear',
  'handbag', 'wallet', 'jewellery', 'necklace', 'earrings', 'rings', 'bracelet',
  'scarf', 'belt', 'hair accessory', 'sunglasses', 'mask', 'cap',

  // 🧒 KIDS / BOYS / GIRLS
  'kids', 'boys', 'girls', 'infants', 'baby', 't shirt', 'shirt', 'shorts', 'jeans',
  'trousers', 'clothing set', 'ethnicwear', 'kurta set', 'partywear',
  'nightwear', 'thermals', 'jacket', 'sweater', 'school wear',
  'bodysuit', 'romper', 'sleep suit', 'dress', 'dungaree', 'jumpsuit',
  'backpack', 'bag', 'shoes', 'flipflops', 'socks', 'sandals', 'school shoes',
  'caps', 'hair accessories', 'toys', 'stationary', 'lunch box',

  // 🏠 HOME / DECOR
  'home', 'homedecor', 'home decor', 'bed', 'bedsheet', 'pillow', 'pillow cover',
  'blanket', 'quilt', 'comforter', 'bed cover', 'bedding set', 'sofa cover',
  'curtain', 'rug', 'carpet', 'mat', 'bath towel', 'hand towel', 'bathrobe',
  'bathroom accessory', 'shower curtain', 'floor runner',
  'wall decor', 'clock', 'mirror', 'lamp', 'lighting', 'wall lamp', 'table lamp',
  'outdoor lamp', 'string light', 'plant', 'planter', 'candle', 'aroma',
  'vase', 'showpiece', 'pooja essential', 'wall shelf', 'fountain',
  'ottoman', 'furniture', 'table runner', 'table cover', 'cushion', 'diwan set',

  // 🍽️ KITCHEN & STORAGE
  'kitchen', 'kitchenware', 'cookware', 'bakeware', 'serveware', 'dinnerware',
  'cup', 'mug', 'glass', 'plate', 'bowl', 'barware', 'drinkware',
  'storage box', 'organiser', 'hanger', 'bin', 'laundry bag', 'hook', 'holder',

  // 🏋️‍♂️ SPORTS / ACTIVEWEAR
  'sportswear', 'activewear', 'tracksuit', 'trackpant', 'jogger',
  'sports bra', 'active t shirt', 'sports shorts', 'training jacket', 'sweatshirt',
  'gym wear', 'yoga pant', 'running shoe', 'sports sandal', 'swimwear',
  'sports accessory', 'sports equipment', 'fitness', 'athleisure',

  // 🧴 BEAUTY / GROOMING / WELLNESS
  'beauty', 'grooming', 'wellness', 'skin care', 'makeup', 'cosmetics', 'fragrance',
  'perfume', 'deodorant', 'shampoo', 'conditioner', 'face wash', 'cleanser',
  'toner', 'serum', 'moisturizer', 'lipstick', 'lip balm', 'foundation',
  'concealer', 'eyeliner', 'mascara', 'makeup tool', 'comb', 'brush',
  'body lotion', 'body wash', 'sunscreen', 'nail polish', 'spa', 'salon',
  'mens grooming', 'hair care', 'personal care', 'hygiene',
  'health supplement', 'vitamin', 'protein', 'fitness supplement',

  // 💎 JEWELLERY / METALS
  'jewellery', 'gold', 'silver', 'platinum', 'gold coin', 'silver coin',
  'gold bar', 'silver bar', 'necklace', 'ring', 'bracelet', 'chain', 'anklet',
  'earring', 'bangle', 'pendant',

  // 💻 ELECTRONICS / GADGETS
  'electronics', 'mobile', 'smartphone', 'laptop', 'tablet', 'camera', 'gadget',
  'accessory', 'earphones', 'headphones', 'charger', 'smartwatch', 'power bank',

  // 🧸 OTHER LIFESTYLE
  'toy', 'gift', 'flower', 'food', 'snack', 'munchies', 'collectible',
  'stationary', 'book', 'notebook', 'art supply', 'pen', 'pencil',

  // 🌸 FESTIVE
  'festivewear', 'ethnicwear', 'pooja item', 'decorative light', 'diya', 'rangoli'
];


    const userMsgLower = userMessage.toLowerCase();
    const isProductQuery = productKeywords.some(keyword => userMsgLower.includes(keyword));

    if (isProductQuery && isCSVLoaded) {
      console.log('🔄 Detected product query, using new logic...');
      
      // Generate product links using new logic
      const productLinksInfo = await generateProductLinks(userMessage);
      
      if (productLinksInfo) {
        console.log('✅ Product links generated, creating AI response...');
        const productResponse = await createProductResponse(userMessage, productLinksInfo);
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
    
    const productLinksInfo = await generateProductLinks(message);
    const aiResponse = await createProductResponse(message, productLinksInfo);
    
    res.json({
      userMessage: message,
      productLinksInfo: productLinksInfo,
      aiResponse: aiResponse
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// NEW: Debug endpoint to check ALL matching galleries for a category
app.get('/debug-category/:categoryId', (req, res) => {
  const categoryId = req.params.categoryId;
  
  const category = categoriesData.find(cat => cat.id === categoryId);
  const matchingGalleries = galleriesData.filter(g => {
    if (Array.isArray(g.cat1)) {
      return g.cat1.includes(categoryId);
    } else {
      return g.cat1 === categoryId;
    }
  });
  
  // Generate links for all matching galleries
  const generatedLinks = matchingGalleries.map(gallery => {
    const encodedType2 = gallery.type2.replace(/ /g, '%20');
    const productLink = `app.zulu.club/${encodedType2}`;
    
    return {
      gallery: gallery,
      link: productLink,
      type2: gallery.type2
    };
  });
  
  res.json({
    categoryId,
    category: category || 'Not found',
    totalMatches: matchingGalleries.length,
    matchingGalleries: matchingGalleries,
    generatedLinks: generatedLinks
  });
});

// NEW: Endpoint to check all galleries for a specific product
app.get('/debug-product/:productName', async (req, res) => {
  try {
    const productName = req.params.productName;
    
    // Detect category
    const detectedCategory = await detectProductCategory(productName);
    let result = {
      productQuery: productName,
      detectedCategory: detectedCategory
    };
    
    if (detectedCategory) {
      // Find category
      const category = categoriesData.find(cat => 
        cat.name.toLowerCase().includes(detectedCategory.toLowerCase()) ||
        detectedCategory.toLowerCase().includes(cat.name.toLowerCase())
      );
      
      if (category) {
        result.category = category;
        
        // Find ALL matching galleries
        const matchingGalleries = galleriesData.filter(g => {
          if (Array.isArray(g.cat1)) {
            return g.cat1.includes(category.id);
          } else {
            return g.cat1 === category.id;
          }
        });
        
        result.matchingGalleries = matchingGalleries;
        result.totalGalleriesFound = matchingGalleries.length;
        
        // Generate links
        result.generatedLinks = matchingGalleries.map(gallery => {
          const encodedType2 = gallery.type2.replace(/ /g, '%20');
          return {
            link: `app.zulu.club/${encodedType2}`,
            type2: gallery.type2,
            cat1: gallery.cat1
          };
        });
      }
    }
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// NEW: Enhanced debug endpoint to see category scoring
app.get('/debug-category-scoring/:productQuery', async (req, res) => {
  try {
    const productQuery = req.params.productQuery;
    
    // Detect category
    const detectedCategory = await detectProductCategory(productQuery);
    
    if (!detectedCategory) {
      return res.json({
        productQuery,
        detectedCategory: null,
        message: 'No category detected'
      });
    }

    // Use the same scoring logic as generateProductLinks
    const scoredCategories = categoriesData.map(cat => {
      const catNameLower = cat.name.toLowerCase();
      const detectedLower = detectedCategory.toLowerCase();
      let score = 0;

      // Exact match (highest priority)
      if (catNameLower === detectedLower) {
        score = 100;
      }
      // Contains match (category contains detected term)
      else if (catNameLower.includes(detectedLower)) {
        score = 80;
      }
      // Detected term contains category (second priority)
      else if (detectedLower.includes(catNameLower)) {
        score = 70;
      }
      // Word boundary matches
      else {
        const catWords = catNameLower.split(/\s+/);
        const detectedWords = detectedLower.split(/\s+/);
        
        // Count matching words
        const matchingWords = catWords.filter(catWord => 
          detectedWords.some(detectedWord => 
            catWord.includes(detectedWord) || detectedWord.includes(catWord)
          )
        ).length;
        
        if (matchingWords > 0) {
          score = 50 + (matchingWords * 5);
        }
        // Common variations
        else if (catNameLower.replace(/\s+/g, '') === detectedLower.replace(/\s+/g, '')) {
          score = 60;
        }
        // Partial matches for longer terms
        else if (detectedLower.length > 3) {
          if (catNameLower.includes(detectedLower)) {
            score = 40;
          } else if (detectedLower.includes(catNameLower)) {
            score = 35;
          }
        }
      }

      return {
        id: cat.id,
        name: cat.name,
        score: score
      };
    });

    // Filter and sort
    const potentialCategories = scoredCategories
      .filter(cat => cat.score > 0)
      .sort((a, b) => b.score - a.score);

    // Check galleries for top categories
    const topCategoriesWithGalleries = await Promise.all(
      potentialCategories.slice(0, 10).map(async (category) => {
        const galleriesForCategory = galleriesData.filter(g => {
          if (Array.isArray(g.cat1)) {
            return g.cat1.includes(category.id);
          } else {
            return g.cat1 === category.id;
          }
        });
        
        return {
          ...category,
          galleriesFound: galleriesForCategory.length,
          sampleGalleries: galleriesForCategory.slice(0, 3).map(g => g.type2)
        };
      })
    );

    res.json({
      productQuery,
      detectedCategory,
      topCategories: topCategoriesWithGalleries,
      totalPotentialCategories: potentialCategories.length,
      scoringExplanation: {
        '100': 'Exact match',
        '80': 'Category contains detected term',
        '70': 'Detected term contains category', 
        '60': 'Same words, different spacing',
        '50+': 'Word matching (base 50 + 5 per matching word)',
        '40': 'Partial match (category contains detected)',
        '35': 'Partial match (detected contains category)'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// NEW: Debug endpoint to see category matching for any product
app.get('/debug-category-matching/:productQuery', async (req, res) => {
  try {
    const productQuery = req.params.productQuery;
    
    // Detect category
    const detectedCategory = await detectProductCategory(productQuery);
    
    if (!detectedCategory) {
      return res.json({
        productQuery,
        detectedCategory: null,
        message: 'No category detected'
      });
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

    // Check galleries for each potential category
    const categoryResults = potentialCategories.map(category => {
      const galleriesForCategory = galleriesData.filter(g => {
        if (Array.isArray(g.cat1)) {
          return g.cat1.includes(category.id);
        } else {
          return g.cat1 === category.id;
        }
      });
      
      return {
        category: category.name,
        categoryId: category.id,
        galleriesFound: galleriesForCategory.length,
        galleries: galleriesForCategory.slice(0, 5), // First 5 galleries
        links: galleriesForCategory.map(g => `app.zulu.club/${g.type2.replace(/ /g, '%20')}`)
      };
    });

    res.json({
      productQuery,
      detectedCategory,
      potentialCategories: potentialCategories.map(c => `${c.name} (${c.id})`),
      categoryResults,
      successfulCategories: categoryResults.filter(r => r.galleriesFound > 0),
      totalPotentialCategories: potentialCategories.length,
      totalSuccessfulCategories: categoryResults.filter(r => r.galleriesFound > 0).length
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '6.0 - Multi-Category Fallback with Product Detection',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      smart_categories: 'AI decides when to show categories',
      product_detection: 'CSV-based product category detection',
      multi_category_fallback: 'Tries multiple similar categories when no galleries found',
      multi_link_support: 'Finds ALL matching galleries and generates multiple links',
      csv_integration: '268+ categories from GitHub CSV files',
      dynamic_links: 'Automated product link generation from all galleries',
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
      debug_product: 'GET /debug-product/:productName',
      debug_category_matching: 'GET /debug-category-matching/:productQuery',
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
    approach: 'Dual-mode: AI-driven category display + CSV-based multi-category fallback product detection'
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

// NEW: Initialize CSV data loading when server starts
console.log('🚀 Starting Zulu Club AI Assistant with Multi-Category Fallback Product Detection...');
loadAllCSVData().then(success => {
  if (success) {
    console.log('🎉 CSV data initialization completed successfully!');
  } else {
    console.log('⚠️ CSV data initialization completed with warnings');
  }
});

// Export for Vercel
module.exports = app;

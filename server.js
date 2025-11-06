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
// NEW: Improved function to detect TOP 3 product categories using GPT with CSV data - FIXED ORDER
async function detectProductCategories(userMessage) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not available for category detection');
      return null;
    }

    // Prepare category names for context - use ALL categories from CSV
    const categoryNames = categoriesData.map(cat => cat.name);
    
    console.log(`📊 Sending ${categoryNames.length} categories to GPT for matching...`);

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a product category classifier for an e-commerce store. 
          Analyze the user's message and identify the TOP 3 most relevant product categories from the available list.
          
          AVAILABLE CATEGORIES: ${JSON.stringify(categoryNames)}
          
          IMPORTANT RULES:
          1. Return EXACTLY 3 category names in a JSON array
          2. Order MUST be: [MOST_RELEVANT, SECOND_MOST_RELEVANT, THIRD_MOST_RELEVANT]
          3. Use ONLY the exact category names from the available categories list
          4. Most relevant = most specific and direct match to user's request
          5. Second most relevant = broader but still relevant category
          6. Third most relevant = alternative/related category
          7. If fewer than 3 categories are relevant, fill remaining slots with null
          8. Return the array in this exact format: ["Category1", "Category2", "Category3"]
          
          EXAMPLES:
          User: "I need running shoes" -> ["Sports Shoes", "Footwear", "Athleisure"]
          User: "looking for wedding lehenga" -> ["Lehenga Cholis", "Ethnicwear", "Bridal Wear"]
          User: "want tshirt for men" -> ["Topwear", "Men's Fashion", "Casual Wear"]
          User: "home decoration items" -> ["Home Decor", "Home Furnishing", "Home Accessories"]
          User: "gift for friend" -> ["Gifting", "Lifestyle Gifting", "Personalized Gifts"]
          User: "beauty products" -> ["Beauty & Personal Care", "Skincare", "Makeup"]
          User: "sofa for living room" -> ["Furniture", "Home Decor", "Living Room Furniture"]
          User: "hello" -> [null, null, null]
          User: "what products do you have" -> [null, null, null]`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_tokens: 150,
      temperature: 0.1
    });

    const response = completion.choices[0].message.content.trim();
    console.log(`🤖 GPT Raw Response: ${response}`);
    
    try {
      // Parse the JSON response
      const categoriesArray = JSON.parse(response);
      
      if (!Array.isArray(categoriesArray) || categoriesArray.length !== 3) {
        console.log('❌ Invalid response format from GPT');
        return null;
      }
      
      // Filter out null values and return valid categories in order
      const validCategories = categoriesArray.filter(cat => cat !== null && cat !== 'null');
      
      console.log(`🎯 GPT Detected Categories (Ordered by Relevance):`, validCategories);
      return validCategories;
      
    } catch (parseError) {
      console.log('❌ Error parsing GPT response as JSON:', parseError);
      
      // Fallback: try to extract categories from text response
      const categoryMatches = response.match(/"([^"]+)"/g) || response.match(/'([^']+)'/g);
      if (categoryMatches) {
        const extractedCategories = categoryMatches.map(match => 
          match.replace(/["']/g, '').trim()
        ).filter(cat => cat && cat !== 'null');
        
        console.log(`🎯 Extracted Categories:`, extractedCategories);
        return extractedCategories.slice(0, 3); // Return max 3
      }
      
      return null;
    }

  } catch (error) {
    console.error('❌ Error detecting product categories:', error);
    return null;
  }
}

// NEW: Enhanced function to find galleries using GPT's top 3 categories - WITH ALL GALLERIES
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

    // NEW: Get TOP 3 categories from GPT (ordered by relevance)
    const detectedCategories = await detectProductCategories(userMessage);
    
    if (!detectedCategories || detectedCategories.length === 0) {
      console.log('❌ No categories detected from user message');
      return null;
    }

    console.log(`🎯 Will try ${detectedCategories.length} GPT-recommended categories in order of relevance:`, detectedCategories);

    // NEW: Try each GPT-recommended category in order of relevance
    let successfulCategory = null;
    let matchingGalleries = [];
    let triedCategories = [];
    let allGalleriesFromAllCategories = [];

    // First pass: Try each GPT category and collect ALL galleries from successful ones
    for (const categoryName of detectedCategories) {
      // Find the category in our CSV data
      const category = categoriesData.find(cat => 
        cat.name.toLowerCase() === categoryName.toLowerCase()
      );
      
      if (!category) {
        console.log(`❌ Category "${categoryName}" not found in CSV data`);
        triedCategories.push(`${categoryName} (not found in CSV)`);
        continue;
      }

      triedCategories.push(`${category.name} (ID: ${category.id})`);
      console.log(`🔄 Trying GPT-recommended category: ${category.name} (ID: ${category.id})`);
      
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
        
        // Store all galleries from this category
        allGalleriesFromAllCategories.push({
          category: category,
          galleries: galleriesForCategory
        });
        
        // If this is the first category with galleries, use it as primary
        if (!successfulCategory) {
          successfulCategory = category;
          matchingGalleries = galleriesForCategory;
        }
      } else {
        console.log(`❌ No galleries found for GPT category: ${category.name}`);
      }
    }

    // NEW: If we have multiple categories with galleries, combine them for more options
    if (allGalleriesFromAllCategories.length > 1) {
      console.log(`🎉 Found ${allGalleriesFromAllCategories.length} categories with galleries!`);
      
      // Use the first (most relevant) category as primary, but combine galleries
      successfulCategory = allGalleriesFromAllCategories[0].category;
      
      // Combine galleries from all successful categories
      const combinedGalleries = allGalleriesFromAllCategories.flatMap(item => item.galleries);
      
      // Remove duplicates (same type2)
      const uniqueGalleries = combinedGalleries.filter((gallery, index, self) => 
        index === self.findIndex(g => g.type2 === gallery.type2)
      );
      
      matchingGalleries = uniqueGalleries;
      console.log(`🔗 Combined ${uniqueGalleries.length} unique galleries from ${allGalleriesFromAllCategories.length} categories`);
    }

    // NEW: Fallback - if GPT categories don't work, try similarity matching
    if (!successfulCategory) {
      console.log(`💥 No galleries found in GPT recommendations, trying similarity fallback...`);
      
      // Use similarity scoring as fallback
      const userMsgLower = userMessage.toLowerCase();
      
      const scoredCategories = categoriesData.map(cat => {
        const catNameLower = cat.name.toLowerCase();
        let score = 0;

        // Check for word matches
        const userWords = userMsgLower.split(/\s+/).filter(word => word.length > 3);
        const catWords = catNameLower.split(/\s+/);
        
        const matchingWords = userWords.filter(userWord =>
          catWords.some(catWord => 
            catWord.includes(userWord) || userWord.includes(catWord)
          )
        ).length;
        
        score = matchingWords * 10;
        
        // Bonus for exact matches of longer words
        userWords.forEach(userWord => {
          if (userWord.length > 4 && catNameLower.includes(userWord)) {
            score += 15;
          }
        });

        return {
          ...cat,
          score: score
        };
      });

      // Filter and sort by score
      const fallbackCategories = scoredCategories
        .filter(cat => cat.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5); // Top 5 fallback categories

      console.log(`🔄 Trying ${fallbackCategories.length} fallback categories based on similarity...`);
      
      for (const category of fallbackCategories) {
        triedCategories.push(`${category.name} (score: ${category.score})`);
        console.log(`🔄 Fallback: ${category.name} (score: ${category.score})`);
        
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
      console.log(`💥 No galleries found after trying ${triedCategories.length} categories`);
      return null;
    }

    console.log(`🎉 Final selected category: ${successfulCategory.name} with ${matchingGalleries.length} galleries`);

    // Generate multiple links from ALL matching galleries
    const productLinks = matchingGalleries.map(gallery => {
      const encodedType2 = encodeURIComponent(gallery.type2);
      const productLink = `app.zulu.club/${encodedType2}`;
      
      return {
        category: successfulCategory.name,
        link: productLink,
        type2: gallery.type2,
        categoryId: successfulCategory.id
      };
    });

    // Remove duplicate links (same type2) - though we already did this above
    const uniqueLinks = productLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.link === link.link)
    );

    console.log(`🔗 Generated ${uniqueLinks.length} unique product links from ALL available galleries`);
    uniqueLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. ${link.link} (${link.type2})`);
    });
    
    return {
      category: successfulCategory.name,
      links: uniqueLinks,
      totalMatches: matchingGalleries.length,
      triedCategories: triedCategories,
      finalCategory: successfulCategory.name,
      gptCategories: detectedCategories,
      method: successfulCategory ? 'gpt_recommendation' : 'similarity_fallback',
      categoriesWithGalleries: allGalleriesFromAllCategories.length
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
      
      if (productLinksInfo.method === 'gpt_recommendation') {
        response += `Based on your request, I found ${productLinksInfo.links.length} collections in our ${productLinksInfo.category} category:\n\n`;
      } else {
        response += `I found ${productLinksInfo.links.length} collections that might interest you:\n\n`;
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
          GPT Recommended Categories: ${productLinksInfo.gptCategories ? productLinksInfo.gptCategories.join(', ') : 'Not available'}
          Method Used: ${productLinksInfo.method}`
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
      console.log('🔄 Detected product query, using GPT category matching...');
      
      // Generate product links using new GPT category matching logic
      const productLinksInfo = await generateProductLinks(userMessage);
      
      if (productLinksInfo) {
        console.log('✅ Product links generated, creating AI response...');
        const productResponse = await createProductResponse(userMessage, productLinksInfo);
        return productResponse;
      } else {
        console.log('❌ GPT category matching failed, falling back to original AI...');
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

// NEW: Debug endpoint to check GPT category detection
app.post('/debug-gpt-categories', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const detectedCategories = await detectProductCategories(message);
    
    // Check galleries for each detected category
    const categoryDetails = [];
    if (detectedCategories) {
      for (const categoryName of detectedCategories) {
        const category = categoriesData.find(cat => 
          cat.name.toLowerCase() === categoryName.toLowerCase()
        );
        
        if (category) {
          const galleriesForCategory = galleriesData.filter(g => {
            if (Array.isArray(g.cat1)) {
              return g.cat1.includes(category.id);
            } else {
              return g.cat1 === category.id;
            }
          });
          
          categoryDetails.push({
            category: category.name,
            categoryId: category.id,
            galleriesFound: galleriesForCategory.length,
            sampleGalleries: galleriesForCategory.slice(0, 3).map(g => ({
              type2: g.type2,
              link: `app.zulu.club/${encodeURIComponent(g.type2)}`
            }))
          });
        } else {
          categoryDetails.push({
            category: categoryName,
            categoryId: 'Not found in CSV',
            galleriesFound: 0,
            sampleGalleries: []
          });
        }
      }
    }
    
    res.json({
      userMessage: message,
      gptDetectedCategories: detectedCategories,
      categoryDetails: categoryDetails,
      totalCategoriesInCSV: categoriesData.length
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '7.0 - GPT Top 3 Category Detection',
    features: {
      ai_chat: 'OpenAI GPT-3.5 powered responses',
      smart_categories: 'AI decides when to show categories',
      gpt_category_detection: 'GPT analyzes ALL CSV categories to find top 3 matches',
      multi_category_fallback: 'Tries GPT recommendations first, then similarity fallback',
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
      debug_gpt_categories: 'POST /debug-gpt-categories',
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
    approach: 'GPT Top 3 Category Detection: Sends all CSV categories to GPT for intelligent matching'
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
console.log('🚀 Starting Zulu Club AI Assistant with GPT Top 3 Category Detection...');
loadAllCSVData().then(success => {
  if (success) {
    console.log('🎉 CSV data initialization completed successfully!');
  } else {
    console.log('⚠️ CSV data initialization completed with warnings');
  }
});

// Export for Vercel
module.exports = app;

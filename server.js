const express = require('express');
const axios = require('axios');

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

// Function to send message via Gallabox API
async function sendMessage(to, message) {
  try {
    console.log(`📤 Attempting to send message to ${to}: ${message}`);
    
    const response = await axios.post(
      `${gallaboxConfig.baseUrl}/messages/whatsapp`, // ✅ CORRECT ENDPOINT
      {
        channelId: gallaboxConfig.channelId,
        to: to,
        type: "text",
        text: {
          body: message
        }
      },
      {
        headers: {
          'apiKey': gallaboxConfig.apiKey,
          'apiSecret': gallaboxConfig.apiSecret,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Message sent successfully:', response.data);
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

// Webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // Extract message and contact info from Gallabox webhook
    const userMessage = webhookData.whatsapp?.text?.body?.toLowerCase().trim();
    const userPhone = webhookData.whatsapp?.from; // This is the user's phone number
    const userName = webhookData.contact?.name || 'there';
    
    console.log(`💬 Received message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      // Check if user said "hi"
      if (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'hey' || userMessage === 'hii') {
        // Send welcome response
        const welcomeMessage = `Hi ${userName}! 👋 Welcome! How can I help you today?`;
        console.log(`📤 Sending response to ${userPhone}: ${welcomeMessage}`);
        
        await sendMessage(userPhone, welcomeMessage);
        console.log(`✅ Response sent successfully to ${userPhone}`);
      }
      
      // You can add more commands here
      else if (userMessage === 'help') {
        await sendMessage(userPhone, `Here are available commands:\n- hi: Get welcome message\n- help: Show this help`);
      }
      else if (userMessage === 'time') {
        const currentTime = new Date().toLocaleString();
        await sendMessage(userPhone, `🕒 Current time: ${currentTime}`);
      }
      else {
        console.log(`❓ No response configured for message: ${userMessage}`);
        // Optional: Send default response for unknown messages
        // await sendMessage(userPhone, "I'm a simple bot. Try saying 'hi' or 'help'");
      }
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
    service: 'Gallabox WhatsApp Bot',
    version: '2.0',
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /',
      test_message: 'POST /send-test-message',
      webhook_info: 'GET /webhook-info'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint to send a message manually
app.post('/send-test-message', async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to) {
      return res.status(400).json({ 
        error: 'Missing "to" in request body',
        example: { "to": "919876543210", "message": "Hello test" }
      });
    }
    
    const result = await sendMessage(to, message || 'Hello! This is a test message from the Gallabox bot. 🚀');
    
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

// Get webhook info
app.get('/webhook-info', (req, res) => {
  const webhookUrl = `${req.protocol}://${req.get('host')}/webhook`;
  
  res.json({
    webhook_url: webhookUrl,
    method: 'POST',
    content_type: 'application/json',
    setup_instructions: {
      step1: 'Copy the webhook URL above',
      step2: 'Go to Gallabox Dashboard → Settings → Webhooks',
      step3: 'Paste the URL and select message events',
      step4: 'Save and test by sending "hi" to your WhatsApp number'
    }
  });
});

// Get environment info (for debugging)
app.get('/env-info', (req, res) => {
  // Don't expose sensitive info in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.json({
    node_env: process.env.NODE_ENV,
    account_id_set: !!process.env.GALLABOX_ACCOUNT_ID,
    api_key_set: !!process.env.GALLABOX_API_KEY,
    api_secret_set: !!process.env.GALLABOX_API_SECRET,
    channel_id_set: !!process.env.GALLABOX_CHANNEL_ID,
    base_url: gallaboxConfig.baseUrl,
    // Only show partial info in production
    ...(isProduction ? {} : {
      account_id: process.env.GALLABOX_ACCOUNT_ID ? '***' + process.env.GALLABOX_ACCOUNT_ID.slice(-4) : 'not set',
      channel_id: process.env.GALLABOX_CHANNEL_ID ? '***' + process.env.GALLABOX_CHANNEL_ID.slice(-4) : 'not set'
    })
  });
});

// Export for Vercel
module.exports = app;

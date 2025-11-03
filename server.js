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
    const response = await axios.post(
      `${gallaboxConfig.baseUrl}/accounts/${gallaboxConfig.accountId}/messages`,
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
    
    console.log('Message sent successfully');
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

// Webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
  try {
    console.log('Received webhook:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // Extract message and contact info from Gallabox webhook
    const userMessage = webhookData.whatsapp?.text?.body?.toLowerCase().trim();
    const userPhone = webhookData.whatsapp?.from; // This is the user's phone number
    const userName = webhookData.contact?.name || 'there';
    
    console.log(`Received message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      // Check if user said "hi"
      if (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'hey' || userMessage === 'hii') {
        // Send welcome response
        const welcomeMessage = `Hi ${userName}! 👋 Welcome! How can I help you today?`;
        await sendMessage(userPhone, welcomeMessage);
        console.log(`Sent welcome response to ${userPhone}`);
      }
      
      // You can add more commands here
      else if (userMessage === 'help') {
        await sendMessage(userPhone, `Here are available commands:\n- hi: Get welcome message\n- help: Show this help`);
      }
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Gallabox WhatsApp Bot',
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /'
    },
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to send a message manually
app.post('/send-test-message', async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing "to" or "message" in request body' });
    }
    
    const result = await sendMessage(to, message || 'Test message from server');
    res.json({ status: 'success', data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get webhook info
app.get('/webhook-info', (req, res) => {
  res.json({
    webhook_url: `${req.protocol}://${req.get('host')}/webhook`,
    method: 'POST',
    content_type: 'application/json'
  });
});

// Export for Vercel
module.exports = app;

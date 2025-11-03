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
    
    // Gallabox webhook structure ke hisab se data extract karo
    const webhookData = req.body;
    
    // Message type check karo
    if (webhookData.type === 'message' && webhookData.message) {
      const userMessage = webhookData.message.text?.body?.toLowerCase().trim();
      const userPhone = webhookData.contact?.phone;
      
      if (userMessage && userPhone) {
        console.log(`Received message from ${userPhone}: ${userMessage}`);
        
        // Check if user said "hi"
        if (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'hey' || userMessage === 'hii') {
          // Send "hi" response
          await sendMessage(userPhone, 'Hi! 👋 How can I help you today?');
          console.log(`Sent response to ${userPhone}`);
        }
      }
    }
    
    res.status(200).json({ status: 'success' });
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
    }
  });
});

// Test endpoint to send a message manually
app.post('/send-test-message', async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing "to" or "message" in request body' });
    }
    
    const result = await sendMessage(to, message);
    res.json({ status: 'success', data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export for Vercel
module.exports = app;

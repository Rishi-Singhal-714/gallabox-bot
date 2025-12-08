// ============================
// Employee Mode — Stable Queue System
// ============================
const employeeQueue = {};
const isProcessingEmployee = {};
const PROCESS_DELAY = 700;

// Quick auto-responses
function detectQuickReply(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  if (["ok", "done", "yes", "y"].includes(t)) return "Done boss 👍";
  if (["hi", "hello", "hey"].includes(t)) return "Yes boss 👋";
  if (["thanks", "thank you"].includes(t)) return "Always boss 🙌";
  return null;
}

async function logToSheets(sessionId, text, appendUnderColumn) {
  try {
    await appendUnderColumn(sessionId, `EMPLOYEE: ${text}`);
  } catch (err) {
    console.error("⚠️ Failed to log employee msg:", err.message);
  }
}

async function processEmployeeLogic(openai, session, sessionId, text, getSheets, createAgentTicket, appendUnderColumn) {
  await logToSheets(sessionId, text, appendUnderColumn);

  const quick = detectQuickReply(text);
  if (quick) return quick;

  if (text.toLowerCase().includes("call")) {
    const fullHistory = (session?.history) || [];
    const ticketId = await createAgentTicket(sessionId, fullHistory);
    return `📌 Call request noted boss! Ticket: ${ticketId}`;
  }

  return "Noted boss! 🔥";
}

async function runQueue(openai, session, sessionId, getSheets, createAgentTicket, appendUnderColumn) {
  if (isProcessingEmployee[sessionId]) return;
  const queue = employeeQueue[sessionId];
  if (!queue || queue.length === 0) return;
  
  isProcessingEmployee[sessionId] = true;

  while (queue.length > 0) {
    const item = queue.shift();
    const userMsg = item.message;

    let reply;
    try {
      reply = await processEmployeeLogic(openai, session, sessionId, userMsg, getSheets, createAgentTicket, appendUnderColumn);
    } catch (err) {
      console.error("❌ Employee handler error:", err);
      reply = "⚠️ Not able to note, please resend boss.";
    }

    if (!reply || !reply.trim()) reply = "⚠️ Not able to note, please resend boss.";
    item.resolve(reply);

    await new Promise(r => setTimeout(r, PROCESS_DELAY));
  }

  isProcessingEmployee[sessionId] = false;
}

module.exports = async function preIntentFilter(openai, session, sessionId, userMessage, getSheets, createAgentTicket, appendUnderColumn) {
  if (!employeeQueue[sessionId]) employeeQueue[sessionId] = [];

  return new Promise(resolve => {
    employeeQueue[sessionId].push({
      message: userMessage,
      resolve
    });

    runQueue(openai, session, sessionId, getSheets, createAgentTicket, appendUnderColumn);
  });
};

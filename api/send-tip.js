// Send tip storage — stores tips in-memory and writes to a JSON log file
// Also forwards to AgentMail inbox for notification
const https = require('https');
const fs = require('fs');
const path = require('path');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const INBOX_ID = process.env.BELLA_INBOX_ID || 'helpfulseat83@agentmail.to';

// Persistent storage using /tmp on Vercel (serverless writable dir)
const DATA_DIR = '/tmp/find-bella-tips';
const TIPS_FILE = path.join(DATA_DIR, 'tips.json');

function loadTips() {
  try {
    if (fs.existsSync(TIPS_FILE)) {
      const data = fs.readFileSync(TIPS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}
  return [];
}

function saveTips(tips) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TIPS_FILE, JSON.stringify(tips, null, 2));
  } catch (e) {
    console.error('Failed to save tips:', e.message);
  }
}

function agentmailRequest(method, path, body) {
  return new Promise((resolve) => {
    try {
      const payload = body ? JSON.stringify(body) : '';
      const options = {
        hostname: 'api.agentmail.to',
        path: '/v0' + path,
        method: method,
        headers: {
          'Authorization': `Bearer ${AGENTMAIL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
      if (payload) req.write(payload);
      req.end();
    } catch (e) { resolve({ error: e.message }); }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, contact, message } = req.body || {};
  
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const tip = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || 'Anonymous',
    contact: contact || '',
    message: message.trim(),
    received: new Date().toISOString(),
    source: 'find-bella.vercel.app',
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  };

  // Save locally
  const tips = loadTips();
  tips.unshift(tip);
  saveTips(tips);

  // Try to notify via AgentMail (non-blocking)
  if (AGENTMAIL_KEY && INBOX_ID) {
    const tipBody = `NEW TIP - ARABELLA AMBAT\n\nFrom: ${tip.name}\nContact: ${tip.contact || 'N/A'}\n\n${tip.message}\n\n---\nReceived: ${tip.received}`;
    
    try {
      await agentmailRequest('POST', `/inboxes/${INBOX_ID}/messages/send`, {
        to: [INBOX_ID],
        subject: `📨 TIP: Bella - ${tip.name}`,
        text: tipBody
      });
    } catch (e) {
      // Inbox-to-inbox send may fail silently — data is stored locally
      console.error('AgentMail notify failed (non-critical):', e.message);
    }
  }

  res.json({ 
    status: 'ok', 
    message: '✅ Tip sent securely. Thank you for helping bring Bella home.',
    tipId: tip.id
  });
};

// Read tips from local storage — for the admin dashboard
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/tmp/find-bella-tips';
const TIPS_FILE = path.join(DATA_DIR, 'tips.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth check
  const auth = req.headers.authorization || '';
  const validToken = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
  if (!auth || auth !== `Bearer ${validToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Load tips from local storage
  let tips = [];
  try {
    if (fs.existsSync(TIPS_FILE)) {
      const data = fs.readFileSync(TIPS_FILE, 'utf8');
      tips = JSON.parse(data);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to read tips' });
  }

  // Also try to pull from AgentMail inbox for any emailed tips
  const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
  const INBOX_ID = process.env.BELLA_INBOX_ID || 'helpfulseat83@agentmail.to';
  
  if (AGENTMAIL_KEY) {
    try {
      const https = require('https');
      const inboxTips = await new Promise((resolve) => {
        const options = {
          hostname: 'api.agentmail.to',
          path: `/v0/inboxes/${INBOX_ID}/messages`,
          headers: { 'Authorization': `Bearer ${AGENTMAIL_KEY}` },
          timeout: 8000
        };
        https.get(options, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            try { resolve(JSON.parse(d).messages || []); }
            catch { resolve([]); }
          });
        }).on('error', () => resolve([]));
      });

      // Merge AgentMail tips into our list (deduplicate by subject+preview)
      const existingSet = new Set(tips.map(t => t.message.slice(0, 50)));
      for (const msg of inboxTips) {
        const preview = msg.preview || msg.snippet || '';
        if (preview && !existingSet.has(preview.slice(0, 50))) {
          tips.push({
            id: msg.message_id || msg.id,
            name: msg.from?.[0]?.name || msg.from?.[0]?.address || 'Email',
            contact: '',
            message: preview,
            received: msg.received_at || msg.created_at,
            source: 'agentmail'
          });
        }
      }
    } catch (e) {}
  }

  res.json({ 
    tips, 
    count: tips.length, 
    inbox: INBOX_ID || 'local'
  });
};

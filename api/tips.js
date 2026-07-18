// Unified tip API — POST to submit a tip, GET (auth'd) to read tips
const https = require('https');
const fs = require('fs');
const path = require('path');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const INBOX_ID = process.env.BELLA_INBOX_ID || 'helpfulseat83@agentmail.to';
const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const DATA_DIR = '/tmp/find-bella-tips';
const TIPS_FILE = path.join(DATA_DIR, 'tips.json');

function loadTips() {
  try {
    if (fs.existsSync(TIPS_FILE)) {
      return JSON.parse(fs.readFileSync(TIPS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveTips(tips) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TIPS_FILE, JSON.stringify(tips, null, 2));
  } catch (e) {}
}

function agentmailRequest(method, path, body) {
  return new Promise((resolve) => {
    try {
      const payload = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: 'api.agentmail.to', path: '/v0' + path, method,
        headers: { 'Authorization': `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
        timeout: 10000
      };
      if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(opts, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{r.status=r.statusCode;r.data=JSON.parse(d)}catch{r.data=d} resolve(r); }); });
      req.on('error', e => resolve({ error: e.message }));
      if (payload) req.write(payload);
      req.end();
    } catch(e) { resolve({ error: e.message }); }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // === POST: Submit a tip ===
  if (req.method === 'POST') {
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
      source: 'website',
      ip: req.headers['x-forwarded-for'] || ''
    };

    const tips = loadTips();
    tips.unshift(tip);
    // Keep max 500 tips
    if (tips.length > 500) tips.length = 500;
    saveTips(tips);

    // Try AgentMail notification (non-blocking, best-effort)
    if (AGENTMAIL_KEY) {
      try {
        const text = `NEW TIP: Arabella Ambat\n\nFrom: ${tip.name}\nContact: ${tip.contact || 'N/A'}\n\n${tip.message}\n\nReceived: ${tip.received}`;
        await agentmailRequest('POST', `/inboxes/${INBOX_ID}/messages/send`, {
          to: [INBOX_ID], subject: `📨 Tip: ${tip.name}`, text
        });
      } catch(e) {}
    }

    return res.json({ status: 'ok', message: '✅ Tip sent securely. Thank you.', tipId: tip.id });
  }

  // === GET: Read tips (requires auth) ===
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let tips = loadTips();

    // Also pull from AgentMail inbox for emailed tips
    if (AGENTMAIL_KEY) {
      try {
        const inboxResp = await agentmailRequest('GET', `/inboxes/${INBOX_ID}/messages`);
        if (inboxResp.status === 200 && inboxResp.data?.messages) {
          const existingMsgs = new Set(tips.map(t => t.message.slice(0, 60)));
          for (const msg of inboxResp.data.messages) {
            const preview = (msg.preview || msg.snippet || '').slice(0, 60);
            if (preview && !existingMsgs.has(preview)) {
              tips.push({
                id: msg.message_id || msg.id,
                name: msg.from?.[0]?.address || 'Email',
                contact: '',
                message: msg.preview || msg.snippet || '',
                received: msg.received_at || msg.created_at,
                source: 'email'
              });
            }
          }
        }
      } catch(e) {}
    }

    return res.json({ tips, count: tips.length, inbox: INBOX_ID });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

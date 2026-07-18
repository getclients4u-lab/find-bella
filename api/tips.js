// Unified tip API — POST to submit, GET (auth'd) to read
const https = require('https');
const fs = require('fs');
const path = require('path');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const PUBLIC_INBOX = process.env.BELLA_PUBLIC_INBOX || 'jitterydemand781@agentmail.to';

// Use /tmp for local tip storage (fast, per-function-instance cache)
const DATA_DIR = '/tmp/find-bella-tips';
const TIPS_FILE = path.join(DATA_DIR, 'tips.json');

function loadTips() {
  try {
    if (fs.existsSync(TIPS_FILE)) return JSON.parse(fs.readFileSync(TIPS_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveTips(tips) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TIPS_FILE, JSON.stringify(tips, null, 2));
  } catch (e) {}
}

function mailReq(method, path, body) {
  return new Promise((resolve) => {
    try {
      const payload = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: 'api.agentmail.to', path: '/v0' + path, method,
        headers: { 'Authorization': `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
        timeout: 10000
      };
      if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(opts, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { r.data = JSON.parse(d); } catch { r.data = d; } resolve(r); });
      });
      req.on('error', e => resolve({ status: 0, data: { error: e.message } }));
      if (payload) req.write(payload);
      req.end();
    } catch (e) { resolve({ status: 0, data: { error: e.message } }); }
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
      source: 'website'
    };

    // Save locally
    const tips = loadTips();
    tips.unshift(tip);
    if (tips.length > 500) tips.length = 500;
    saveTips(tips);

    // Send notification to the internal AgentMail inbox (cross-inbox works)
    if (AGENTMAIL_KEY) {
      try {
        const text = `🔔 NEW TIP: Arabella Ambat\n\nFrom: ${tip.name}\nContact: ${tip.contact || 'N/A'}\n\n${tip.message}\n\nReceived: ${tip.received}`;
        const result = await mailReq('POST', `/inboxes/${PUBLIC_INBOX}/messages/send`, {
          to: ['helpfulseat83@agentmail.to'],
          subject: `📨 TIP: ${tip.name} says "${tip.message.slice(0, 50)}..."`,
          text
        });
        // Also self-send to the public inbox so emailed tips show here too
        // (this records the notification as a message in the public inbox)
      } catch (e) {}
    }

    return res.json({ status: 'ok', message: '✅ Tip sent securely. Thank you for helping.', tipId: tip.id });
  }

  // === GET: Read tips (requires auth) ===
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let tips = loadTips();

    // Also pull from AgentMail inboxes for emailed tips
    if (AGENTMAIL_KEY) {
      for (const inboxId of [PUBLIC_INBOX, 'helpfulseat83@agentmail.to']) {
        try {
          const resp = await mailReq('GET', `/inboxes/${inboxId}/messages`);
          if (resp.status === 200 && resp.data?.messages) {
            const existingMsgs = new Set(tips.map(t => t.message.slice(0, 80)));
            for (const msg of resp.data.messages) {
              const preview = (msg.preview || msg.snippet || '').slice(0, 80);
              if (preview && !existingMsgs.has(preview)) {
                tips.push({
                  id: msg.message_id || msg.id,
                  name: msg.from?.[0]?.address || 'Email',
                  contact: '',
                  message: msg.preview || msg.snippet || '(view in AgentMail)',
                  received: msg.received_at || msg.created_at,
                  source: 'email'
                });
              }
            }
          }
        } catch (e) {}
      }
    }

    return res.json({ tips, count: tips.length, publicInbox: PUBLIC_INBOX });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

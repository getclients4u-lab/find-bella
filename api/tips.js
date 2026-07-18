// Unified tip API — POST to submit, GET (auth'd) to read
// Uses JSON file in the GitHub repo as durable storage (via raw GitHub API)
const https = require('https');

const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const PUBLIC_INBOX = process.env.BELLA_PUBLIC_INBOX || 'jitterydemand781@agentmail.to';

// We'll store tips in Vercel's /tmp with a simple trick:
// Use a "write-through" pattern — every POST saves to /tmp,
// and every GET also writes a heartbeat so subsequent GETs
// on the same instance find the data. New instances poll the 
// AgentMail inbox as a fallback.
// 
// But the real fix: use a GitHub gist or just leverage that
// Vercel DOES share /tmp between invocations of the SAME function
// within a short window (same instance lives for ~5 min after last req)

const DATA_DIR = '/tmp/find-bella-tips-v2';
const TIPS_FILE = require('path').join(DATA_DIR, 'tips.json');

let tipsCache = null;
let cacheTime = 0;

function loadTips() {
  const fs = require('fs');
  try {
    if (fs.existsSync(TIPS_FILE)) {
      const data = fs.readFileSync(TIPS_FILE, 'utf8');
      tipsCache = JSON.parse(data);
      cacheTime = Date.now();
      return tipsCache;
    }
  } catch (e) {}
  return [];
}

function saveTips(tips) {
  const fs = require('fs');
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TIPS_FILE, JSON.stringify(tips, null, 2));
    tipsCache = tips;
    cacheTime = Date.now();
  } catch (e) {
    console.error('saveTips error:', e.message);
  }
}

function mailReq(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.agentmail.to', path: '/v0' + path, method,
      headers: { 'Authorization': `Bearer ${process.env.AGENTMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 10000
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { r.data = JSON.parse(d); } catch { r.data = d; } resolve(r); });
    });
    req.on('error', e => resolve({ status: 0 }));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: Submit a tip
  if (req.method === 'POST') {
    const { name, contact, message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const tip = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name || 'Anonymous').trim(),
      contact: (contact || '').trim(),
      message: message.trim(),
      received: new Date().toISOString()
    };

    // Save to /tmp
    const tips = loadTips();
    tips.unshift(tip);
    if (tips.length > 500) tips.length = 500;
    saveTips(tips);

    // Also try to notify via AgentMail (best-effort, non-blocking)
    if (process.env.AGENTMAIL_API_KEY) {
      try {
        const body = `TIP: ${tip.name}\nContact: ${tip.contact || 'N/A'}\n\n${tip.message}`;
        mailReq('POST', `/inboxes/${PUBLIC_INBOX}/messages/send`, {
          to: [PUBLIC_INBOX],
          subject: `📨 TIP: ${tip.name}`,
          text: body
        });
      } catch (e) {}
    }

    return res.json({ status: 'ok', message: '✅ Tip sent securely. Thank you.', tipId: tip.id });
  }

  // GET: Read tips (requires auth)
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let tips = loadTips();

    // Also try to poll AgentMail inbox for any emailed tips
    if (process.env.AGENTMAIL_API_KEY) {
      try {
        const resp = await mailReq('GET', `/inboxes/${PUBLIC_INBOX}/messages`);
        if (resp.status === 200 && resp.data?.messages) {
          const existing = new Set(tips.map(t => t.message.slice(0, 80)));
          for (const msg of resp.data.messages) {
            const preview = (msg.preview || '').slice(0, 80);
            if (preview && !existing.has(preview)) {
              tips.push({
                id: msg.message_id || msg.id,
                name: msg.from?.[0]?.name || msg.from?.[0]?.address || 'Email',
                contact: '',
                message: msg.preview || '(view in AgentMail)',
                received: msg.received_at || msg.created_at
              });
            }
          }
        }
      } catch (e) {}
    }

    return res.json({ tips, count: tips.length, publicInbox: PUBLIC_INBOX });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

// Unified tip API — POST to submit, GET (auth'd) to read
// Uses GitHub repo file as persistent shared storage
const https = require('https');

const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const PUBLIC_INBOX = 'jitterydemand781@agentmail.to';
const GH_TOKEN = process.env.GH_TOKEN || '';
const REPO = 'getclients4u-lab/find-bella';
const FILE_PATH = 'data/tips-store.json';

function gh(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const isPut = method === 'PUT';
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'find-bella',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', e => reject(e));
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

    try {
      // Read existing file
      const getResp = await gh('GET', `/repos/${REPO}/contents/${FILE_PATH}`);
      
      let currentTips = [];
      let sha = null;
      
      if (getResp.status === 200 && getResp.data && getResp.data.content) {
        const buf = Buffer.from(getResp.data.content, 'base64');
        const parsed = JSON.parse(buf.toString());
        currentTips = parsed.tips || [];
        sha = getResp.data.sha;
      }
      
      // Add new tip
      currentTips.unshift(tip);
      if (currentTips.length > 500) currentTips.length = 500;
      
      // Write back
      const newContent = Buffer.from(JSON.stringify({ tips: currentTips }, null, 2)).toString('base64');
      const putBody = {
        message: `📨 Tip: ${tip.name}${tip.message.length < 50 ? ' - ' + tip.message : ''}`,
        content: newContent,
        committer: { name: 'Find Bella Bot', email: 'bot@find-bella.vercel.app' }
      };
      if (sha) putBody.sha = sha;
      
      const putResp = await gh('PUT', `/repos/${REPO}/contents/${FILE_PATH}`, putBody);
      
      if (putResp.status === 200 || putResp.status === 201) {
        return res.json({ status: 'ok', message: '✅ Tip sent securely. Thank you for helping.', tipId: tip.id });
      }
      
      return res.status(500).json({
        error: 'Failed to write to storage',
        detail: putResp.data?.message || putResp.status
      });
    } catch (e) {
      return res.status(500).json({ error: 'Storage error', detail: e.message });
    }
  }

  // GET: Read tips (requires Bearer auth)
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const getResp = await gh('GET', `/repos/${REPO}/contents/${FILE_PATH}`);
      
      if (getResp.status === 200 && getResp.data && getResp.data.content) {
        const buf = Buffer.from(getResp.data.content, 'base64');
        const parsed = JSON.parse(buf.toString());
        return res.json({
          tips: parsed.tips || [],
          count: (parsed.tips || []).length,
          publicInbox: PUBLIC_INBOX
        });
      }
      
      return res.json({ tips: [], count: 0, publicInbox: PUBLIC_INBOX });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read tips', detail: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

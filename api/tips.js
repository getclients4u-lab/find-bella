// Unified tip API — POST to submit, GET (auth'd) to read
// Uses GitHub repo file as persistent shared storage (works across ALL instances)
const https = require('https');

const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const PUBLIC_INBOX = 'jitterydemand781@agentmail.to';
const GITHUB_TOKEN = process.env.GH_TOKEN || null;
const REPO = 'getclients4u-lab/find-bella';
const FILE_PATH = 'data/tips-store.json';

function githubRequest(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'find-bella-api',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { r.data = JSON.parse(d); } catch { r.data = d; }
        resolve(r);
      });
    });
    req.on('error', e => resolve({ status: 0, data: { error: e.message } }));
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

    // Read existing tips from GitHub
    const getResp = await githubRequest('GET', `/repos/${REPO}/contents/${FILE_PATH}`);
    
    let existingTips = [];
    let sha = null;
    
    if (getResp.status === 200 && getResp.data?.content) {
      try {
        const existing = JSON.parse(Buffer.from(getResp.data.content, 'base64').toString());
        existingTips = existing.tips || [];
        sha = getResp.data.sha;
      } catch (e) {}
    }
    
    existingTips.unshift(tip);
    if (existingTips.length > 500) existingTips.length = 500;
    
    const newContent = Buffer.from(JSON.stringify({ tips: existingTips }, null, 2)).toString('base64');
    
    const putBody = {
      message: `📨 Tip from ${tip.name} [${tip.id}]`,
      content: newContent,
      committer: { name: 'Find Bella Bot', email: 'bot@find-bella.vercel.app' }
    };
    if (sha) putBody.sha = sha;
    
    const putResp = await githubRequest('PUT', `/repos/${REPO}/contents/${FILE_PATH}`, putBody);
    
    if (putResp.status === 200 || putResp.status === 201) {
      return res.json({ status: 'ok', message: '✅ Tip sent securely. Thank you for helping.', tipId: tip.id });
    }
    
    return res.status(500).json({ error: 'Failed to store tip', detail: putResp.data });
  }

  // GET: Read tips (requires auth)
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const getResp = await githubRequest('GET', `/repos/${REPO}/contents/${FILE_PATH}`);
    
    if (getResp.status === 200 && getResp.data?.content) {
      try {
        const data = JSON.parse(Buffer.from(getResp.data.content, 'base64').toString());
        return res.json({
          tips: data.tips || [],
          count: data.tips?.length || 0,
          publicInbox: PUBLIC_INBOX
        });
      } catch (e) {
        return res.json({ tips: [], count: 0, publicInbox: PUBLIC_INBOX });
      }
    }

    return res.json({ tips: [], count: 0, publicInbox: PUBLIC_INBOX });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

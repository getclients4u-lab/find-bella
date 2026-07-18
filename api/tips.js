// API endpoint to fetch tips from AgentMail inbox and serve them to the admin page
const https = require('https');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;

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
        timeout: 15000
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Simple auth check via query param or header
  const auth = req.headers.authorization || req.query.token;
  const validToken = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
  if (!auth || auth !== `Bearer ${validToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const inboxId = process.env.BELLA_INBOX_ID || 'helpfulseat83@agentmail.to';

  // Fetch messages from AgentMail inbox
  const messages = await agentmailRequest('GET', `/inboxes/${inboxId}/messages`);

  if (messages.error) {
    return res.status(500).json({ error: messages.error });
  }

  // Parse each message to extract structured tip data
  const tips = [];
  for (const msg of messages.data?.messages || []) {
    const from = msg.from?.[0]?.address || msg.from || 'Unknown';
    const subject = msg.subject || '';
    const received = msg.received_at || msg.created_at || msg.timestamp;
    const preview = msg.preview || msg.snippet || '';

    // Try to extract tip body
    let body = '';
    try {
      const raw = await agentmailRequest('GET', `/inboxes/${inboxId}/messages/${encodeURIComponent(msg.message_id || msg.id)}/raw`);
      if (raw.data?.downloadUrl) {
        const dl = await new Promise((resolve) => {
          https.get(raw.data.downloadUrl, (r) => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => resolve(d));
          }).on('error', () => resolve(''));
        });
        body = dl || preview;
      } else {
        body = preview;
      }
    } catch {
      body = preview;
    }

    tips.push({
      id: msg.message_id || msg.id,
      from: from,
      subject: subject,
      received: received,
      preview: preview,
      body: body.slice(0, 2000)
    });
  }

  res.json({ tips, count: tips.length, inbox: inboxId });
};

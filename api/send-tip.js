// Send tip to AgentMail inbox — called from the public site form
const https = require('https');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const INBOX_ID = process.env.BELLA_INBOX_ID || 'helpfulseat83@agentmail.to';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, contact, message } = req.body || {};
  
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!AGENTMAIL_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const tipBody = `TIP RE: ARABELLA AMBAT - MISSING IN GULF BREEZE, FL\n\nFrom: ${name || 'Anonymous'}${contact ? `\nContact: ${contact}` : ''}\n\nMessage:\n${message}\n\n---\nReceived: ${new Date().toISOString()}`;

  const result = await agentmailRequest('POST', `/inboxes/${INBOX_ID}/messages/send`, {
    to: [INBOX_ID],
    subject: `TIP: Arabella Ambat - ${name || 'Anonymous'}${contact ? ` (${contact})` : ''}`,
    text: tipBody
  });

  if (result.status === 200 || result.status === 201) {
    res.json({ status: 'ok', message: 'Tip sent securely' });
  } else {
    console.error('AgentMail error:', JSON.stringify(result));
    res.status(500).json({ error: 'Failed to send tip', detail: result.data });
  }
};

// Unified tip API — POST to submit, GET (auth'd) to read
// Uses AgentMail cross-inbox email as durable storage
const https = require('https');

const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const ADMIN_TOKEN = process.env.BELLA_ADMIN_TOKEN || 'find-bella-2026';
const STORAGE_INBOX = 'helpfulseat83@agentmail.to';    // receives tip emails
const PUBLIC_INBOX = 'jitterydemand781@agentmail.to';   // shown on site for direct email

function mailReq(method, path, body) {
  return new Promise((resolve) => {
    try {
      const payload = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: 'api.agentmail.to', path: '/v0' + path, method,
        headers: { 'Authorization': `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
        timeout: 15000
      };
      if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(opts, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { r.data = JSON.parse(d); } catch { r.data = d; } resolve(r); });
      });
      req.on('error', e => resolve({ status: 0, data: { error: e.message } }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: { error: 'timeout' } }); });
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

  // ========================================
  // POST: Submit a tip
  // ========================================
  if (req.method === 'POST') {
    const { name, contact, message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ts = new Date().toISOString();
    const sanitizedMsg = message.trim();
    const fromName = (name || 'Anonymous').trim();
    const fromContact = (contact || '').trim();

    // Build the tip email body
    const emailBody = [
      `🔔 TIP REPORT - ARABELLA AMBAT`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `From: ${fromName}`,
      fromContact ? `Contact: ${fromContact}` : '',
      ``,
      `Message:`,
      sanitizedMsg,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Received: ${ts}`,
      `Source: find-bella.vercel.app`
    ].filter(Boolean).join('\n');

    const subject = `📨 TIP: ${fromName}${sanitizedMsg.length > 40 ? '' : ' — ' + sanitizedMsg}`.slice(0, 120);

    // Send email FROM public inbox TO storage inbox (cross-inbox = works)
    const result = await mailReq('POST', `/inboxes/${PUBLIC_INBOX}/messages/send`, {
      to: [STORAGE_INBOX],
      subject,
      text: emailBody
    });

    if (result.status === 200 || result.status === 201) {
      return res.json({
        status: 'ok',
        message: '✅ Tip sent securely. Thank you for helping bring Bella home.',
        tipId: result.data?.message_id || Date.now().toString(36)
      });
    } else {
      // Fallback: try sending the other direction
      const fallback = await mailReq('POST', `/inboxes/${STORAGE_INBOX}/messages/send`, {
        to: [PUBLIC_INBOX],
        subject,
        text: emailBody
      });
      if (fallback.status === 200 || fallback.status === 201) {
        return res.json({
          status: 'ok',
          message: '✅ Tip sent securely. Thank you for helping bring Bella home.',
          tipId: fallback.data?.message_id || Date.now().toString(36)
        });
      }
      return res.status(500).json({
        error: 'Could not deliver tip',
        detail: result.data || result.status,
        email: `${PUBLIC_INBOX} → ${STORAGE_INBOX}`
      });
    }
  }

  // ========================================
  // GET: Read tips (requires Bearer auth)
  // ========================================
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allTips = [];

    // Read from storage inbox (where tips are sent)
    for (const inboxId of [STORAGE_INBOX, PUBLIC_INBOX]) {
      try {
        const resp = await mailReq('GET', `/inboxes/${inboxId}/messages`);
        if (resp.status === 200 && resp.data?.messages) {
          for (const msg of resp.data.messages) {
            // Parse the tip from the email
            const body = msg.preview || msg.snippet || '';
            const from = msg.from?.[0]?.address || msg.from?.[0]?.name || 'Unknown';
            
            // Extract structured info from the email body
            let name = 'Email';
            let contact = '';
            let tipMsg = body;
            
            const nameMatch = body.match(/From:\s*(.+)/);
            if (nameMatch) name = nameMatch[1].trim();
            
            const contactMatch = body.match(/Contact:\s*(.+)/);
            if (contactMatch) contact = contactMatch[1].trim();
            
            const msgMatch = body.match(/(?:Message:[\s]*\n?)([\s\S]*?)(?:\n━━━|\nReceived:)/);
            if (msgMatch) tipMsg = msgMatch[1].trim();

            allTips.push({
              id: msg.message_id || msg.id,
              name,
              contact,
              message: tipMsg || body.slice(0, 500),
              received: msg.received_at || msg.created_at,
              source: from.includes('jitterydemand') || from.includes('helpfulseat') ? 'website' : 'email'
            });
          }
        }
      } catch (e) {}
    }

    // Sort by received time, newest first, deduplicate by message content
    const seen = new Set();
    const unique = [];
    for (const tip of allTips.sort((a, b) => new Date(b.received) - new Date(a.received))) {
      const key = (tip.message || '').slice(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(tip);
      }
    }

    return res.json({ tips: unique, count: unique.length, publicInbox: PUBLIC_INBOX });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

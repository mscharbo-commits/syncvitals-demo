// Server-side proxy for the provider-facing AI assistant.
// Keeps the Anthropic API key out of the browser entirely — the client
// (syncvitals-rpm.html) posts a system prompt + conversation history here,
// this function attaches the key and forwards the request, and hands back
// Anthropic's raw response. Mirrors the pattern already used by
// api/nutrition-plan.js.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const system = body && body.system;
  const messages = body && body.messages;
  const maxTokens = (body && body.maxTokens) || 700;

  if (!messages || !Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'Missing "messages" array in request body.' });
    return;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        system: system || undefined,
        messages: messages
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('Anthropic API error', upstream.status, JSON.stringify(data));
      res.status(upstream.status).json({ error: (data && data.error && data.error.message) || 'Upstream API error' });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    console.error('ai-assistant proxy error', err);
    res.status(500).json({ error: (err && err.message) || 'Server error contacting Anthropic API' });
  }
};

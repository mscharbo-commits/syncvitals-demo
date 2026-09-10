// Server-side proxy for AI nutrition plan generation.
// Keeps the Anthropic API key out of the browser entirely — the client
// (syncvitals-rpm.html) posts a prompt here, this function attaches the
// key and forwards the request, and hands back Anthropic's raw response.
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
  const prompt = body && body.prompt;
  const maxTokens = (body && body.maxTokens) || 1500;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body.' });
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
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: (data && data.error && data.error.message) || 'Upstream API error' });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || 'Server error contacting Anthropic API' });
  }
};

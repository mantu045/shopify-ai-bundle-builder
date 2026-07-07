const SYSTEM_PROMPT = `You are a sports nutrition and wellness product bundling assistant.
Return only valid JSON. Recommend complementary PRODUCT TYPES, not brands.
Never recommend the same product as the current product.
Use only short, shopper-friendly names likely to match Shopify catalog titles.
Schema:
{"recommendations":["type 1","type 2"],"reason":"one short sentence"}
The reason must be concise and must not make medical claims.`;

function cleanProduct(product = {}) {
  return {
    title: String(product.title || '').slice(0, 200),
    description: String(product.description || '').slice(0, 1200),
    type: String(product.type || '').slice(0, 150),
    category: String(product.category || '').slice(0, 150),
    tags: Array.isArray(product.tags) ? product.tags.slice(0, 30) : [],
    vendor: String(product.vendor || '').slice(0, 150)
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const allowedOrigin = process.env.SHOPIFY_STORE_ORIGIN;
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'AI is not configured' });

    const product = cleanProduct(req.body?.product);
    const recommendationCount = Math.min(5, Math.max(3, Number(req.body?.recommendationCount || 4)));
    if (!product.title) return res.status(400).json({ error: 'Product title is required' });

    const prompt = `${SYSTEM_PROMPT}
Current product:
${JSON.stringify(product)}
Return exactly ${recommendationCount} recommendations.`;

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      }
    );

    if (!response.ok) {
      console.error('Gemini error:', response.status, await response.text());
      return res.status(502).json({ error: 'AI provider failed' });
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(502).json({ error: 'Empty AI response' });

    const parsed = JSON.parse(text);
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(String).filter(Boolean).slice(0, recommendationCount)
      : [];

    if (!recommendations.length) return res.status(502).json({ error: 'No recommendations returned' });

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({
      recommendations,
      reason: String(parsed.reason || 'Complete your stack with these complementary products.').slice(0, 300)
    });
  } catch (error) {
    console.error('Recommendation endpoint error:', error);
    return res.status(500).json({ error: 'Could not build recommendations' });
  }
}

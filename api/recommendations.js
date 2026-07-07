const SYSTEM_PROMPT = `
You are a product bundling assistant for an ecommerce store.

Return only valid JSON.
Recommend complementary PRODUCT TYPES, not brands.
Never recommend the same product as the current product.
Use short shopper-friendly names likely to match Shopify catalog titles.

Schema:
{
  "recommendations": ["type 1", "type 2"],
  "reason": "one short sentence"
}

The reason must be concise and must not make medical claims.
`;

function cleanProduct(product = {}) {
  return {
    title: String(product.title || '').slice(0, 200),

    description: String(
      product.description || ''
    ).slice(0, 1200),

    type: String(
      product.type || ''
    ).slice(0, 150),

    category: String(
      product.category || ''
    ).slice(0, 150),

    tags: Array.isArray(product.tags)
      ? product.tags.slice(0, 30)
      : [],

    vendor: String(
      product.vendor || ''
    ).slice(0, 150)
  };
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  const allowedOrigins = [
    process.env.SHOPIFY_STORE_ORIGIN
  ].filter(Boolean);

  const isShopifyOrigin =
    origin &&
    (
      origin.endsWith('.myshopify.com') ||
      origin === 'https://admin.shopify.com'
    );

  const isAllowedOrigin =
    origin &&
    (
      allowedOrigins.includes(origin) ||
      isShopifyOrigin
    );

  if (isAllowedOrigin) {
    res.setHeader(
      'Access-Control-Allow-Origin',
      origin
    );
  }

  res.setHeader(
    'Vary',
    'Origin'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept'
  );
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error(
        'GEMINI_API_KEY is missing'
      );

      return res.status(500).json({
        error: 'AI is not configured'
      });
    }

    const product = cleanProduct(
      req.body?.product
    );

    const recommendationCount =
      Math.min(
        5,
        Math.max(
          3,
          Number(
            req.body?.recommendationCount || 4
          )
        )
      );

    if (!product.title) {
      return res.status(400).json({
        error: 'Product title is required'
      });
    }

    const prompt = `
${SYSTEM_PROMPT}

Current product:

${JSON.stringify(product)}

Return exactly ${recommendationCount} recommendations.
`;

    const model =
      process.env.GEMINI_MODEL ||
      'gemini-2.5-flash';

    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(
      geminiUrl,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {
            responseMimeType:
              'application/json',

            temperature: 0.2
          }
        })
      }
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        'Gemini API error:',
        response.status,
        errorText
      );

      return res.status(502).json({
        error: 'AI provider failed'
      });
    }

    const payload =
      await response.json();

    const text =
      payload
        ?.candidates
        ?.[0]
        ?.content
        ?.parts
        ?.[0]
        ?.text;

    if (!text) {
      console.error(
        'Empty Gemini response:',
        payload
      );

      return res.status(502).json({
        error: 'Empty AI response'
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error(
        'Invalid Gemini JSON:',
        text
      );

      return res.status(502).json({
        error: 'Invalid AI response'
      });
    }

    const recommendations =
      Array.isArray(
        parsed.recommendations
      )
        ? parsed.recommendations
            .map(item =>
              String(item).trim()
            )
            .filter(Boolean)
            .slice(
              0,
              recommendationCount
            )
        : [];

    if (!recommendations.length) {
      return res.status(502).json({
        error:
          'No recommendations returned'
      });
    }

    res.setHeader(
      'Cache-Control',
      's-maxage=900, stale-while-revalidate=1800'
    );

    return res.status(200).json({
      recommendations,

      reason: String(
        parsed.reason ||
          'Complete your setup with these complementary products.'
      ).slice(0, 300)
    });
  } catch (error) {
    console.error(
      'Recommendation endpoint error:',
      error
    );

    return res.status(500).json({
      error:
        'Could not build recommendations'
    });
  }
}
# Shopify AI Bundle Builder

AI-powered complementary product recommendations for a Shopify product detail page. Built for Dawn using Shopify Liquid, a theme section, ES6 JavaScript, Shopify predictive search, and the AJAX Cart API.

## Features

- Product-page `AI Recommended Bundle` section
- Configurable title, enable/disable setting, 3/4/5 recommendation count, and fallback collection
- Gemini-powered recommendation workflow
- Matches AI product-type suggestions against real Shopify products
- Shows only available matched/fallback products
- Product image, title, price, available variant selector, and individual Add to Cart
- Selectable products and Add Entire Bundle to Cart
- AI-generated short recommendation reason
- Skeleton loading state and accessible status messages
- Fallbacks for missing endpoint, AI failure, empty response, no product match, network errors, and cart errors
- Responsive Dawn-style layout for desktop, tablet, and mobile
- Lazy-loaded images, deferred JS, 15-minute session cache, parallel product matching, debounced variant UI handling

## Project Structure

```text
shopify-ai-bundle-builder/
├── sections/
│   └── ai-recommended-bundle.liquid
├── assets/
│   ├── ai-recommended-bundle.js
│   └── ai-recommended-bundle.css
├── api/
│   └── recommendations.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Installation

### 1. Add theme files

Open Shopify Admin > Online Store > Themes > your Dawn theme > Edit code.

Copy:

- `sections/ai-recommended-bundle.liquid` to `sections/`
- `assets/ai-recommended-bundle.js` to `assets/`
- `assets/ai-recommended-bundle.css` to `assets/`

Do not paste all files into one Liquid file.

### 2. Add the section to the Product template

Open Shopify Admin > Online Store > Themes > Customize.

Open a product page in the theme editor, click **Add section**, choose **AI Recommended Bundle**, and save.

The section is enabled only for product templates.

### 3. Choose a fallback collection

In the section settings choose a collection containing available complementary products. The fallback is used when AI or product matching fails.

### 4. Deploy the AI endpoint

This repository includes a Vercel-compatible serverless function at `api/recommendations.js`.

1. Push the repository to GitHub.
2. Import the repository into Vercel.
3. Add the environment variables shown below.
4. Deploy.
5. Copy the deployed endpoint, for example `https://YOUR-PROJECT.vercel.app/api/recommendations`.
6. Paste that URL into the section's **AI recommendation endpoint** setting.

## Environment Variables

Create these only on the server/deployment platform. Never put an AI API key in Liquid or browser JavaScript.

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
SHOPIFY_STORE_ORIGIN=https://your-store.myshopify.com
```

`SHOPIFY_STORE_ORIGIN` is used as the allowed CORS origin. Use the exact storefront origin that loads the section.

## AI Integration Workflow

1. Liquid outputs safe product context: title, description, type, category, tags, vendor, and handle.
2. Deferred JavaScript checks the 15-minute `sessionStorage` cache.
3. On a cache miss, the browser sends product context and requested recommendation count to `/api/recommendations`.
4. The serverless endpoint calls Gemini with a strict JSON schema prompt.
5. Gemini returns complementary product types and one short reason.
6. The storefront uses Shopify predictive search to match each AI suggestion to actual catalog products.
7. Duplicate, unavailable, and current products are removed.
8. Matched products are rendered. If no products match or AI fails, Liquid-provided fallback collection products are rendered.
9. Individual products or the main product plus selected recommendations are added using `/cart/add.js`.

Example AI response:

```json
{
  "recommendations": ["Whey Protein", "Creatine", "Peanut Butter", "Shaker Bottle"],
  "reason": "Mass gainers are often paired with protein, creatine and convenient calorie-support products for a complete training stack."
}
```

## AJAX Cart Flow

Individual Add to Cart sends:

```json
{
  "items": [
    { "id": 123456789, "quantity": 1 }
  ]
}
```

Add Entire Bundle sends the current product variant first, followed by all checked recommendation variants in a single request.

## Error Handling

- AI endpoint missing: fallback collection
- AI provider failure: fallback collection
- Empty AI response: fallback collection
- No Shopify product match: fallback collection
- Predictive search/network failure: fallback collection
- No fallback products: meaningful unavailable message
- AJAX cart error: user-friendly retry message
- Unavailable variants: filtered before rendering

## Performance Notes

- Script uses `defer`
- Product images use native `loading="lazy"`
- Recommendations are cached in `sessionStorage` for 15 minutes
- Shopify matching requests run in parallel with `Promise.allSettled`
- AI results are limited before matching
- Serverless response uses CDN cache headers
- Variant UI handling is debounced
- No API request blocks initial page rendering
- Skeleton cards prevent a blank section

## Assumptions

- The theme is Shopify Dawn or a Dawn-compatible theme exposing standard color CSS variables and button classes.
- Predictive search is available at `/search/suggest.json`.
- Product titles/types contain useful words such as Whey Protein, Creatine, Gummies, Shaker, or similar terms so AI suggestions can match the catalog.
- The current product has an available selected/first variant.
- AI keys remain server-side.
- No bonus challenges are implemented: smart cart recommendations, goal detection, bundle discount logic, or recommendation analytics.

## Demo Video Checklist

For a 5 to 10 minute recording:

1. Open a Mass Gainer product page.
2. Show the skeleton loader.
3. Show AI recommendations and the AI reason.
4. Change a variant.
5. Add one recommended product.
6. Select/deselect a bundle product.
7. Click Add Entire Bundle to Cart.
8. Open the cart and show the main product plus selected products.
9. Open Theme Customize and show enable/disable, title, recommendation count, fallback collection, and AI endpoint.
10. Briefly show the Liquid section, ES6 class, AI endpoint, caching, fallback logic, and README.

## Security

The Gemini key is intentionally not stored in the Shopify theme. Calling Gemini directly from storefront JavaScript would expose the secret key to every visitor. The included serverless endpoint keeps the key on the server.

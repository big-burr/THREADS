/* claude-api.js
   Handles client-side calls to the Anthropic API for:
   1. Vision tagging of clothing photos
   2. Outfit suggestions based on closet contents + style + weather
*/

const ClaudeAPI = (() => {
  const MODEL = 'claude-sonnet-4-6';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  function getApiKey() {
    return localStorage.getItem('threads_api_key') || '';
  }

  function ensureApiKey() {
    let key = getApiKey();
    if (!key) {
      key = prompt('Enter your Anthropic API key (stored locally in this browser only):');
      if (key) localStorage.setItem('threads_api_key', key.trim());
    }
    return key;
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function callClaude(messages, systemPrompt, maxTokens = 1000) {
    const apiKey = ensureApiKey();
    if (!apiKey) throw new Error('No API key provided');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const textBlock = data.content.find((c) => c.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  // Tag a clothing photo — returns { category, color, style, season }
  async function tagClothingItem(imageBlob, mediaType, knownCategories) {
    const base64 = await blobToBase64(imageBlob);

    const categoryHint = knownCategories && knownCategories.length
      ? `Existing categories in this closet: ${knownCategories.join(', ')}. Reuse one of these if it fits, otherwise propose a new short category name (e.g. "Pants", "Tees", "Sweaters", "Shoes", "Jackets", "Shorts").`
      : `Propose a short category name (e.g. "Pants", "Tees", "Sweaters", "Shoes", "Jackets", "Shorts").`;

    const systemPrompt = `You are a clothing-tagging assistant. Respond ONLY with valid JSON, no preamble, no markdown fences. The JSON object must have exactly these keys: "category" (string, singular capitalized like "Tees" or "Pants"), "color" (string, primary color(s)), "style" (string, short formality/style descriptor like "casual", "athletic", "business formal"), "season" (string, e.g. "all-season", "winter", "summer").`;

    const userText = `Tag this clothing item. ${categoryHint}`;

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: userText },
        ],
      },
    ];

    const raw = await callClaude(messages, systemPrompt, 300);
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  }

  // Suggest an outfit given closet contents (category markdown text), style, and weather
  async function suggestOutfit(closetData, style, weather, recentOutfits) {
    const systemPrompt = `You are a personal stylist working only from the user's actual closet inventory (provided as markdown). Recommend one complete outfit using ONLY items that appear in the inventory. Respond ONLY with valid JSON, no preamble, no markdown fences. The JSON object must have keys: "items" (array of objects, each with "category" and "description" matching an item from the inventory), "reasoning" (short string, 1-2 sentences explaining the pick given style and weather).`;

    const closetText = Object.entries(closetData)
      .map(([cat, content]) => `## ${cat}\n${content || '(empty)'}`)
      .join('\n\n');

    const recentText = recentOutfits && recentOutfits.length
      ? `\n\nRecently worn (avoid repeating exactly if possible):\n${recentOutfits.join('\n')}`
      : '';

    const userText = `Closet inventory:\n\n${closetText}${recentText}\n\nStyle requested: ${style}\nWeather: ${weather}\n\nPick one outfit.`;

    const messages = [{ role: 'user', content: userText }];
    const raw = await callClaude(messages, systemPrompt, 800);
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  }

  return {
    tagClothingItem,
    suggestOutfit,
    ensureApiKey,
  };
})();

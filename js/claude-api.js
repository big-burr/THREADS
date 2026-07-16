/* claude-api.js
   Handles client-side calls to the Anthropic API for:
   1. Vision tagging of clothing photos
   2. Outfit suggestions based on closet contents + style + weather
*/

const ClaudeAPI = (() => {
  const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  // Reads the model from Settings if available (defined in app.js as a global),
  // falling back to the default. This lets the settings toggle take effect
  // immediately without editing this file.
  function getModel() {
    try {
      if (typeof Settings !== 'undefined' && Settings && typeof Settings.get === 'function') {
        return Settings.get('model') || DEFAULT_MODEL;
      }
    } catch (err) {}
    return DEFAULT_MODEL;
  }

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

  // Resize an image blob down to a max dimension before sending to the API.
  // Tagging only needs enough resolution to identify color/type/style — full
  // camera resolution (often 3-4MB+) wastes a lot of tokens for no accuracy gain.
  async function compressImage(blob, maxDimension = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height / width) * maxDimension);
            width = maxDimension;
          } else {
            width = Math.round((width / height) * maxDimension);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (resizedBlob) => {
            if (resizedBlob) resolve(resizedBlob);
            else reject(new Error('Image compression failed'));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for compression'));
      };
      img.src = url;
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
        model: getModel(),
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
    // Read compression params from Settings if available, else defaults.
    let maxDim = 800;
    let quality = 0.8;
    try {
      if (typeof Settings !== 'undefined' && Settings && typeof Settings.getImageCompressionParams === 'function') {
        const p = Settings.getImageCompressionParams();
        maxDim = p.maxDim;
        quality = p.quality;
      }
    } catch (err) {}

    const compressed = await compressImage(imageBlob, maxDim, quality);
    const base64 = await blobToBase64(compressed);
    const compressedMediaType = 'image/jpeg';

    const categoryHint = knownCategories && knownCategories.length
      ? `Existing categories in this closet: ${knownCategories.join(', ')}. Reuse one of these if it fits, otherwise propose a new short category name (e.g. "Pants", "Tees", "Sweaters", "Shoes", "Jackets", "Shorts").`
      : `Propose a short category name (e.g. "Pants", "Tees", "Sweaters", "Shoes", "Jackets", "Shorts").`;

    const systemPrompt = `You are a clothing-tagging assistant. Respond ONLY with valid JSON, no preamble, no markdown fences. The JSON object must have exactly these keys: "category" (string, singular capitalized like "Tees" or "Pants"), "color" (string, primary color(s)), "styles" (array of strings, choose all that reasonably apply from exactly this list: "casual", "formal", "gym", "date", "outdoor", "loungewear"), "season" (string, e.g. "all-season", "winter", "summer").`;

    const userText = `Tag this clothing item. ${categoryHint}`;

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: compressedMediaType, data: base64 } },
          { type: 'text', text: userText },
        ],
      },
    ];

    const raw = await callClaude(messages, systemPrompt, 300);
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  }

  // Extracts a compact one-line-per-item summary from a category's raw markdown,
  // instead of sending the full file (with images/dates/formatting) to the API.
  // This is the main cost lever for suggestOutfit as the closet grows.
  function compactCategoryText(content) {
    if (!content) return '(empty)';
    const blocks = content.split(/^### /m).slice(1);
    if (blocks.length === 0) return '(empty)';
    return blocks
      .map((block) => {
        const lines = block.split('\n');
        const title = lines[0].trim();
        const colorMatch = block.match(/- color: (.+)/);
        const styleMatch = block.match(/- style: (.+)/);
        const seasonMatch = block.match(/- season: (.+)/);
        const parts = [title];
        if (colorMatch) parts.push(`color: ${colorMatch[1].trim()}`);
        if (styleMatch) parts.push(`style: ${styleMatch[1].trim()}`);
        if (seasonMatch) parts.push(`season: ${seasonMatch[1].trim()}`);
        return '- ' + parts.join(', ');
      })
      .join('\n');
  }

  // Suggest an outfit given closet contents (category markdown text), style, and weather
  async function suggestOutfit(closetData, style, weather, recentOutfits) {
    const systemPrompt = `You are a personal stylist working only from the user's actual closet inventory (provided as a compact list). Recommend one complete outfit using ONLY items that appear in the inventory. Respond ONLY with valid JSON, no preamble, no markdown fences. The JSON object must have keys: "items" (array of objects, each with "category" and "description" matching an item from the inventory), "reasoning" (short string, 1-2 sentences explaining the pick given style and weather).`;

    const closetText = Object.entries(closetData)
      .map(([cat, content]) => `## ${cat}\n${compactCategoryText(content)}`)
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

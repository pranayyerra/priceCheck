const parseCurrency = (priceStr) => {
  return parseFloat(priceStr.replace(/[^0-9.]/g, ""));
};

// Helper function to make HTTP requests with retry logic
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",

          ...options.headers,
        },
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      return response;
    } catch (error) {
      if (i === retries - 1) throw error;

      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Parse weight/quantity from a product name string
function parseWeight(productName) {
  if (!productName) return null;

  const pattern = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms|g|gm|gms|gram|grams|mg|l|lt|ltr|litre|litres|liter|liters|ml|pcs|pc|piece|pieces|pack|dozen|dz)\b/i;
  const match = productName.match(pattern);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const rawUnit = match[2].toLowerCase();

  let unit, grams;
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(rawUnit)) {
    unit = 'kg'; grams = value * 1000;
  } else if (['g', 'gm', 'gms', 'gram', 'grams'].includes(rawUnit)) {
    unit = 'g'; grams = value;
  } else if (['mg'].includes(rawUnit)) {
    unit = 'g'; grams = value / 1000;
  } else if (['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(rawUnit)) {
    unit = 'l'; grams = value * 1000;
  } else if (['ml'].includes(rawUnit)) {
    unit = 'ml'; grams = value;
  } else if (['pcs', 'pc', 'piece', 'pieces', 'pack'].includes(rawUnit)) {
    unit = 'pcs'; grams = null;
  } else if (['dozen', 'dz'].includes(rawUnit)) {
    return { raw: match[0], value: value * 12, unit: 'pcs', grams: null };
  } else {
    return null;
  }

  return { raw: match[0], value, unit, grams };
}

// Detect produce queries (fruits/vegetables) for weight filtering
const PRODUCE_KEYWORDS = new Set([
  'tomato', 'tomatoes', 'onion', 'onions', 'potato', 'potatoes',
  'carrot', 'carrots', 'capsicum', 'brinjal', 'eggplant',
  'cucumber', 'beans', 'cabbage', 'cauliflower', 'spinach',
  'palak', 'methi', 'coriander', 'green chilli', 'chilli',
  'ginger', 'garlic', 'beetroot', 'radish', 'peas',
  'ladies finger', 'okra', 'bhindi', 'drumstick',
  'bitter gourd', 'bottle gourd', 'ridge gourd', 'snake gourd',
  'pumpkin', 'mushroom', 'mushrooms', 'lettuce', 'broccoli',
  'sweet potato', 'corn', 'lemon', 'lemons', 'lime',
  'apple', 'apples', 'banana', 'bananas', 'mango', 'mangoes',
  'grapes', 'grape', 'orange', 'oranges', 'papaya',
  'pomegranate', 'guava', 'watermelon', 'muskmelon',
  'pineapple', 'sapota', 'chikoo', 'pear', 'pears',
  'strawberry', 'strawberries', 'kiwi', 'fig', 'figs',
  'custard apple', 'dragon fruit', 'avocado',
]);

function isProduce(query) {
  const normalized = query.toLowerCase().trim();
  if (PRODUCE_KEYWORDS.has(normalized)) return true;
  for (const keyword of PRODUCE_KEYWORDS) {
    if (normalized.includes(keyword)) return true;
  }
  return false;
}

// Check if a product name is relevant to the search query using keyword matching.
// Uses basic stemming (removes trailing s/es/ies) and substring matching.
function isRelevantToQuery(query, productName) {
  if (!query || !productName) return false;

  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const stem = (word) => {
    if (word.endsWith("ies")) return word.slice(0, -3) + "y"; // berries→berry
    if (word.endsWith("oes")) return word.slice(0, -2);        // tomatoes→tomat
    if (word.endsWith("es")) return word.slice(0, -2);         // potatoes→potato (after oes)
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  };

  const queryWords = normalize(query).split(/\s+/).filter((w) => w.length > 1);
  const nameNorm = normalize(productName);

  // Check if any query word (or its stem) appears in the product name
  for (const word of queryWords) {
    if (nameNorm.includes(word)) return true;
    const stemmed = stem(word);
    if (stemmed !== word && nameNorm.includes(stemmed)) return true;
  }
  return false;
}

// AI-based relevance scoring via Google Gemini (fallback when keyword matching finds nothing)
async function aiPickBestProduct(query, products, apiKey) {
  if (!apiKey || products.length === 0) return null;

  const productList = products
    .map((p, i) => `${i + 1}. ${p.name} — ₹${p.price}`)
    .join("\n");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You pick the most relevant grocery product for a search query. Reply with ONLY the number of the best match, or 0 if none are relevant.\n\nSearch: "${query}"\n\nProducts:\n${productList}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      }),
    });

    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return null;
    }

    const data = await response.json();
    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const idx = parseInt(answer, 10);
    if (idx >= 1 && idx <= products.length) return products[idx - 1];
    return null; // AI said 0 (none relevant) or unparseable
  } catch (e) {
    console.error("AI relevance scoring error:", e);
    return null;
  }
}

// Detect multi-packs and combo deals
function isMultiPack(productName) {
  if (!productName) return false;
  const patterns = /\b(pack\s+of\s+\d+|combo|family\s+pack|value\s+pack|set\s+of\s+\d+|bundle|\d+\s*x\s*\d+\s*(g|gm|ml|kg|l))\b/i;
  return patterns.test(productName);
}

// Cache management
const cache = {
  data: new Map(),

  timeout: 5 * 60 * 1000, // 5 minutes

  set(key, value) {
    this.data.set(key, {
      value,

      timestamp: Date.now(),
    });
  },

  get(key) {
    const item = this.data.get(key);

    if (!item) return null;

    if (Date.now() - item.timestamp > this.timeout) {
      this.data.delete(key);

      return null;
    }

    return item.value;
  },
};

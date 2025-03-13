chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "search") {
    searchProducts(request.query);
    sendResponse({ status: "searching" });
    return true;
  }
});

async function searchProducts(query) {
  const platforms = [
    { name: "BigBasket", fetcher: fetchBigBasketResults },
    { name: "Blinkit", fetcher: fetchBlinkitResults },
    { name: "Zepto", fetcher: fetchZeptoResults },
    { name: "Amazon", fetcher: fetchAmazonResults }
  ];

  // Launch all fetchers in parallel
  platforms.forEach(async (platform) => {
    try {
      const results = await platform.fetcher(query);
      // Send results back to popup as they arrive
      chrome.runtime.sendMessage({
        type: "platformResults",
        platform: platform.name,
        results: results,
      });
    } catch (error) {
      console.error(`Error fetching from ${platform.name}:`, error);
      // Send empty results on error
      chrome.runtime.sendMessage({
        type: "platformResults",
        platform: platform.name,
        results: [],
      });
    }
  });
}

async function fetchAllPlatformResults(query) {
  const searchPromises = {
    bigbasket: fetchBigBasketResults(query),
    blinkit: fetchBlinkitResults(query),
    zepto: fetchZeptoResults(query),
    amazon: fetchAmazonResults(query)
  };

  const results = await Promise.allSettled(
    Object.entries(searchPromises).map(async ([platform, promise]) => {
      try {
        const result = await promise;
        return { platform, result, success: true };
      } catch (error) {
        console.error(`Error fetching from ${platform}:`, error);
        return { platform, result: [], success: false };
      }
    })
  );

  return results
    .filter((result) => result.status === "fulfilled" && result.value.success)
    .map((result) => result.value);
}

async function fetchBigBasketResults(query) {
  const searchUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(
    query
  )}&nc=as`;

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    const products = [];

    // Parse the HTML using regex or DOM parser
    const productMatches = html.match(
      /<div class="product-item">(.*?)<\/div>/gs
    );

    if (productMatches) {
      productMatches.forEach((match) => {
        const nameMatch = match.match(/product-name">(.*?)<\/div>/);
        const priceMatch = match.match(/price">Rs\s*([\d.]+)/);
        const urlMatch = match.match(/href="([^"]+)"/);

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameMatch[1].trim(),
            price: parseFloat(priceMatch[1]),
            url: `https://www.bigbasket.com${urlMatch[1]}`,
            deliveryTime: "2-3 hours",
            platform: "BigBasket",
          });
        }
      });
    }

    return products;
  } catch (error) {
    console.error("BigBasket fetch error:", error);
    return [];
  }
}

async function fetchBlinkitResults(query) {
  const searchUrl = `https://blinkit.com/s/?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    const products = [];

    // Parse the HTML using regex
    const productMatches = html.match(/<div class="Product(?:.*?)<\/div>/gs);

    if (productMatches) {
      productMatches.forEach(match => {
        const nameMatch = match.match(/product-name"[^>]*>([^<]+)/);
        const priceMatch = match.match(/actual-price[^>]*>₹\s*([0-9,.]+)/);
        const urlMatch = match.match(/href="([^"]+)"/);

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameMatch[1].trim(),
            price: parseCurrency(priceMatch[1]),
            url: `https://blinkit.com${urlMatch[1]}`,
            deliveryTime: '10-20 minutes',
            platform: 'Blinkit'
          });
        }
      });
    }

    return products;
  } catch (error) {
    console.error('Blinkit fetch error:', error);
    return [];
  }
}

async function fetchZeptoResults(query) {
  const searchUrl = `https://www.zeptonow.com/search?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    const products = [];

    // Parse the HTML using regex
    const productMatches = html.match(/<div[^>]*class="[^"]*product-card[^"]*"[^>]*>.*?<\/div>/gs);

    if (productMatches) {
      productMatches.forEach(match => {
        const nameMatch = match.match(/product-name[^>]*>([^<]+)/);
        const priceMatch = match.match(/product-price[^>]*>₹\s*([0-9,.]+)/);
        const urlMatch = match.match(/href="([^"]+)"/);

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameMatch[1].trim(),
            price: parseCurrency(priceMatch[1]),
            url: `https://www.zeptonow.com${urlMatch[1]}`,
            deliveryTime: '10-20 minutes',
            platform: 'Zepto'
          });
        }
      });
    }

    return products;
  } catch (error) {
    console.error('Zepto fetch error:', error);
    return [];
  }
}

async function fetchAmazonResults(query) {
  const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(
    query
  )}+grocery`;

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    const products = [];

    // Parse the HTML using regex
    const productMatches = html.match(
      /data-asin="[^"]*"(.*?)(?=data-asin|$)/gs
    );

    if (productMatches) {
      productMatches.forEach((match) => {
        const nameMatch = match.match(/product-title">(.*?)<\/span>/);
        const priceMatch = match.match(/price">(₹|Rs\.)\s*([\d,]+\.?\d*)/);
        const urlMatch = match.match(/href="([^"]+)"/);

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameMatch[1].trim(),
            price: parseCurrency(priceMatch[2]),
            url: `https://www.amazon.in${urlMatch[1]}`,
            deliveryTime: "2-3 days",
            platform: "Amazon",
          });
        }
      });
    }

    return products;
  } catch (error) {
    console.error("Amazon fetch error:", error);
    return [];
  }
}

function organizeResults(platformResults) {
  const productMap = new Map();

  // Process results from each platform
  platformResults.forEach(({ platform, result }) => {
    result.forEach((product) => {
      const normalizedName = normalizeProductName(product.name);

      if (!productMap.has(normalizedName)) {
        productMap.set(normalizedName, {
          name: product.name,
          platforms: {},
        });
      }

      productMap.get(normalizedName).platforms[platform] = {
        price: product.price,
        deliveryTime: product.deliveryTime,
        url: product.url,
      };
    });
  });

  return Array.from(productMap.values());
}

function normalizeProductName(name) {
  // Remove special characters, extra spaces, and convert to lowercase
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Helper function to parse currency strings to numbers
const parseCurrency = (priceStr) => {
  return parseFloat(priceStr.replace(/[^0-9.]/g, ""));
};

// Helper function to make HTTP requests with retry logic
async function fetchWithRetry(url, options = {}, retries = 1) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        mode: "no-cors",
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

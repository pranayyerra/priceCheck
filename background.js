importScripts("./utils.js");

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
    { name: "Amazon", fetcher: fetchAmazonResults },
  ];

  // Launch all fetchers in parallel
  platforms.forEach(async (platform) => {
    try {
      let results = await platform.fetcher(query);

      // Filter out sponsored products
      results = results.filter(
        (product) => !product.name?.toLowerCase().includes("sponsored")
      );

      // Send results back to popup as they arrive
      chrome.runtime.sendMessage({
        type: "platformResults",
        platform: platform.name,
        results: [results[0]],
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
    amazon: fetchAmazonResults(query),
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
  )}`;
  const products = [];

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    console.log("BigBasket HTML:", html.substring(0, 500));

    // Parse the HTML using regex to find product cards
    const productMatches = html.match(
      /<li class="PaginateItems___StyledLi[^>]*>.*?<\/li>/gs
    );
    console.log(
      "BigBasket product matches:",
      productMatches ? productMatches.length : "none found"
    );

    if (productMatches) {
      // Process only the first result
      const firstMatch = productMatches[0];
      console.log("BigBasket first product HTML:", firstMatch);

      // Extract name
      const nameMatch = firstMatch.match(
        /text-darkOnyx-800[^>]*>([^<]+)<\/h3>/
      );
      console.log("BigBasket name match:", nameMatch);

      // Extract brand name
      const brandMatch = firstMatch.match(
        /BrandName___StyledLabel2[^>]*>([^<]+)<\/span>/
      );
      console.log("BigBasket brand match:", brandMatch);

      // Extract price
      const priceMatch = firstMatch.match(
        /Pricing___StyledLabel-sc-pldi2d-1[^>]*>₹([0-9,.]+)<\/span>/
      );
      console.log("BigBasket price match:", priceMatch);

      // Extract URL
      const urlMatch = firstMatch.match(/href="([^"]+)"/);
      console.log("BigBasket URL match:", urlMatch);

      if (nameMatch && priceMatch && urlMatch) {
        const name = brandMatch
          ? `${brandMatch[1].trim()} ${nameMatch[1].trim()}`
          : nameMatch[1].trim();

        products.push({
          name: name,
          price: parseCurrency(priceMatch[1]),
          url: `https://www.bigbasket.com${urlMatch[1]}`,
          platform: "BigBasket",
        });
      }
    }

    console.log("BigBasket processed results:", products);
    return products;
  } catch (error) {
    console.error("BigBasket fetch error:", error);
    return [];
  }
}

async function fetchBlinkitResults(query) {
  const searchUrl = `https://blinkit.com/s/?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchBlinkitHtml(searchUrl);
    const productMatch = extractFirstProductMatch(html);
    if (!productMatch) return [];

    const product = parseBlinkitProduct(productMatch);
    return product ? [product] : [];
  } catch (error) {
    console.error("Blinkit fetch error:", error);
    return [];
  }
}

async function fetchBlinkitHtml(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  return response.text();
}

function extractFirstProductMatch(html) {
  const matches = html.match(
    /<div class="Product__UpdatedPlpProductContainer[^"]*".*?<\/div><\/div><\/a>/gs
  );
  return matches?.[0];
}

function parseBlinkitProduct(productHtml) {
  const nameMatch = productHtml.match(
    /<div class="Product__UpdatedTitle[^"]*">([^<]+)<\/div>/
  );
  const priceContainer = productHtml.match(
    /<div class="Product__UpdatedPriceAndAtcContainer[^"]*">(.*?)<\/div><\/div><\/div>/s
  );
  const priceMatch = priceContainer?.[0].match(/₹(?:<!-- -->)?([0-9,.]+)/);
  const urlMatch = productHtml.match(/href="([^"]+)"/);
  console.log({ urlMatch });
  const quantityMatch = productHtml.match(
    /class="bff_variant_text_only[^"]*">([^<]+)<\/span>/
  );
  const outOfStockMatch = productHtml.match(
    /<div class="AddToCart__UpdatedOutOfStockTag[^"]*">/
  );

  if (!nameMatch || !priceMatch || outOfStockMatch) return null;

  return {
    name: `${nameMatch[1].trim()}${
      quantityMatch ? ` - ${quantityMatch[1].trim()}` : ""
    }`,
    price: parseCurrency(priceMatch[1]),
    url: `https://blinkit.com${urlMatch?.[1] || ""}`,
    platform: "Blinkit",
  };
}

async function fetchAmazonResults(query) {
  const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    console.log("Amazon HTML:", html.substring(0, 500));

    const productMatches = html.match(
      /data-asin="[^"]*"(.*?)(?=data-asin|$)/gs
    );

    const products = [];

    console.log(
      "Amazon product matches:",
      productMatches ? productMatches.length : "none found"
    );

    if (productMatches) {
      productMatches.forEach((match) => {
        const nameMatch = match.match(/title-recipe"(.*?)<\/span>/);
        const nameText = nameMatch
          ? nameMatch[0].match(/>([^<]+)<\/span>$/)?.[1]?.trim()
          : undefined;
        const priceMatch = match.match(
          /<span[^>]*class="a-price-whole"[^>]*>([\d,]+)/i
        );

        const urlMatch = match.match(/href="([^"]+)"/);

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameText,
            price: parseCurrency(priceMatch[1]),
            url: `https://www.amazon.in${urlMatch[1]}`,
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

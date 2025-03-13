importScripts("./utils.js");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "search") {
    searchProducts(request.query);
    sendResponse({ status: "searching" });
    return true;
  }
});

async function searchProducts(query) {
  console.log("Searching for:", query);

  const results = await Promise.all([
    fetchBigBasketResults(query).then((results) => {
      console.log("BigBasket results:", results);
      return results;
    }),
    fetchBlinkitResults(query).then((results) => {
      console.log("Blinkit results:", results);
      return results;
    }),
    fetchZeptoResults(query).then((results) => {
      console.log("Zepto results:", results);
      return results;
    }),
    fetchAmazonResults(query).then((results) => {
      console.log("Amazon results:", results);
      return results;
    }),
  ]);

  console.log("All results:", results.flat());
  return results.flat();
}

async function fetchAllPlatformResults(query) {
  const searchPromises = {
    bigbasket: fetchBigBasketResults(query),
    blinkit: fetchBlinkitResults(query),
    zepto: fetchZeptoResults(query),
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
          deliveryTime: "2-3 days",
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
  const products = []; // Define the products array

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    console.log("Blinkit HTML:", html.substring(0, 500));

    const productMatches = html.match(
      /<div class="Product__UpdatedPlpProductContainer[^>]*>.*?<\/div><\/div>/gs
    );
    console.log(
      "Blinkit product matches:",
      productMatches ? productMatches.length : "none found"
    );

    if (productMatches) {
      const firstMatch = productMatches[0];
      console.log("Blinkit first product HTML:", firstMatch);

      const nameMatch = firstMatch.match(
        /Product__UpdatedTitle[^"]*">([^<]+)<\/div>/
      );
      console.log("Blinkit name match:", nameMatch);

      const priceMatch = firstMatch.match(
        /font-weight: 600; font-size: 12px;">₹([0-9,.]+)<\/div>/
      );
      console.log("Blinkit price match:", priceMatch);

      if (nameMatch && priceMatch) {
        products.push({
          name: nameMatch[1].trim(),
          price: parseCurrency(priceMatch[1]),
          url: searchUrl,
          deliveryTime: "30-40 mins",
          platform: "Blinkit",
        });
      }
    }

    return products;
  } catch (error) {
    console.error("Blinkit fetch error:", error);
    return [];
  }
}

async function fetchZeptoResults(query) {
  const searchUrl = `https://www.zeptonow.com/search?q=${encodeURIComponent(
    query
  )}`;
  const products = []; // Define the products array

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();
    console.log("Zepto HTML:", html.substring(0, 500));

    const productMatches = html.match(
      /<div[^>]*class="[^"]*SKUDeck___StyledDiv[^"]*"[^>]*>.*?<\/div>/gs
    );
    console.log(
      "Zepto product matches:",
      productMatches ? productMatches.length : "none found"
    );

    if (productMatches) {
      const firstMatch = productMatches[0];
      console.log("Zepto first product HTML:", firstMatch);

      const nameMatch = firstMatch.match(/text-darkOnyx-800[^>]*>([^<]+)/);
      console.log("Zepto name match:", nameMatch);

      const priceMatch = firstMatch.match(/₹\s*([0-9,.]+)/);
      console.log("Zepto price match:", priceMatch);

      if (nameMatch && priceMatch) {
        products.push({
          name: nameMatch[1].trim(),
          price: parseCurrency(priceMatch[1]),
          url: searchUrl,
          deliveryTime: "10-20 minutes",
          platform: "Zepto",
        });
      }
    }

    return products;
  } catch (error) {
    console.error("Zepto fetch error:", error);
    return [];
  }
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
      /<div[^>]*class="[^"]*s-result-item[^"]*"[^>]*>.*?<\/div>/gs
    );
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
        console.log({ nameText });
        const priceMatch = match.match(
          /<span[^>]*class="a-price-whole"[^>]*>([\d,]+)/i
        );
        console.log({ priceMatch });
        if (priceMatch && priceMatch[1]) {
          console.log(parseCurrency(priceMatch[1]));
        }

        const urlMatch = match.match(/href="([^"]+)"/);
        console.log({ urlMatch });

        if (nameMatch && priceMatch && urlMatch) {
          products.push({
            name: nameText,
            price: parseCurrency(priceMatch[1]),
            url: `https://www.amazon.in${urlMatch[1]}`,
            deliveryTime: "2-3 days",
            platform: "Amazon",
          });
        }
      });
    }

    console.log({ products });
    return products[0];
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

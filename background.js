importScripts("./utils.js");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "search") {
    searchProducts(request.query);
    sendResponse({ status: "searching" });
    return true;
  }
  if (request.action === "addToCarts") {
    addItemsToCarts(request.items).then((results) => {
      sendResponse({ status: "done", results });
    });
    return true; // keep channel open for async response
  }
  if (request.action === "clearCarts") {
    clearExistingCartsOnPlatforms(request.platforms).then((results) => {
      sendResponse({ status: "done", results });
    });
    return true; // keep channel open for async response
  }
});

// ── Clear Existing Carts ──

const CART_URLS = {
  BigBasket: "https://www.bigbasket.com/basket/?nc=nb",
  "Amazon Fresh": "https://www.amazon.in/gp/cart/view.html",
  "KPN Fresh": "https://www.kpnfresh.com/cart",
};

async function clearExistingCartsOnPlatforms(platforms) {
  const results = [];
  for (const platform of platforms) {
    try {
      const cleared = await clearCartForPlatform(platform);
      results.push({ platform, cleared });
    } catch (e) {
      console.error(`[clearCart] ${platform} error:`, e);
      results.push({ platform, cleared: false, error: e.message });
    }
  }
  return results;
}

async function clearCartForPlatform(platform) {
  const cartUrl = CART_URLS[platform];
  if (!cartUrl) return false;

  // ── BigBasket: must navigate via an existing session tab to avoid 404 ──
  if (platform === "BigBasket") {
    const bbTabs = await chrome.tabs.query({
      url: "https://www.bigbasket.com/*",
    });
    let tabId;
    let ownTab = false; // whether we created the tab (so we can close it later)

    if (bbTabs.length > 0) {
      tabId = bbTabs[0].id;
      // Navigate within the existing session tab
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (url) => {
          window.location.href = url;
        },
        args: [cartUrl],
      });
    } else {
      // Create a blank tab, establish a Cloudflare session, then navigate to cart
      const tab = await chrome.tabs.create({
        url: "about:blank",
        active: true,
      });
      tabId = tab.id;
      ownTab = true;
      await chrome.tabs.update(tabId, { url: "https://www.bigbasket.com/" });
      await waitForTabLoad(tabId);
      await new Promise((r) => setTimeout(r, 2000));
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (url) => {
          window.location.href = url;
        },
        args: [cartUrl],
      });
    }

    await waitForTabLoad(tabId);
    await new Promise((r) => setTimeout(r, 2000));

    const bbResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: async () => {
        const selectors = [
          "[data-qa='btn-delete']",
          "[data-qa='btn-remove']",
          "button[class*='Delete']",
          "button[class*='Remove']",
          "button[aria-label*='Remove']",
          "button[aria-label*='Delete']",
          "button[title*='Remove']",
        ];

        const findBtn = () => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return (
            Array.from(
              document.querySelectorAll("button, [role='button']"),
            ).find((el) => {
              const t = (el.textContent || el.getAttribute("aria-label") || "")
                .toLowerCase()
                .trim();
              return (
                t === "remove" || t === "delete" || t.includes("remove item")
              );
            }) || null
          );
        };

        let removed = 0;
        while (removed < 50) {
          let btn = null,
            waited = 0;
          while (waited < 8000) {
            btn = findBtn();
            if (btn) break;
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }
          if (!btn) break;
          btn.scrollIntoView({ block: "center" });
          btn.click();
          removed++;
          await new Promise((r) => setTimeout(r, 1500));
        }
        return { removed };
      },
    });

    const bbRemoved = bbResults?.[0]?.result?.removed ?? 0;
    console.log(`[clearCart] BigBasket: removed ${bbRemoved} item(s)`);
    if (ownTab) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {}
    }
    return true;
  }

  // ── Amazon Fresh: shared cart page — must click "Go to Fresh Cart" first ──
  if (platform === "Amazon Fresh") {
    const tab = await chrome.tabs.create({ url: cartUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise((r) => setTimeout(r, 2000));

    // Click the "Go to Fresh Cart" button to land on the Fresh-only cart.
    // When the cart is empty this button may not exist — capture the result
    // so we only await navigation if a click actually happened.
    const freshBtnResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: async () => {
        const findFreshCartBtn = () => {
          // Try known selectors
          const byInput = document.querySelector(
            "input[name*='fresh'], input[value*='Fresh Cart'], input[id*='fresh-cart']",
          );
          if (byInput) return byInput;
          // Text fallback across buttons, inputs and links
          return (
            Array.from(
              document.querySelectorAll("button, input[type='submit'], a"),
            ).find((el) => {
              const t = (el.textContent || el.value || "").toLowerCase();
              return t.includes("fresh cart") || t.includes("go to fresh");
            }) || null
          );
        };

        let waited = 0;
        while (waited < 5000) {
          const btn = findFreshCartBtn();
          if (btn) {
            btn.click();
            return { clicked: true };
          }
          await new Promise((r) => setTimeout(r, 500));
          waited += 500;
        }
        return { clicked: false };
      },
    });

    const freshBtnClicked = freshBtnResults?.[0]?.result?.clicked ?? false;

    if (freshBtnClicked) {
      // Button was found and clicked — wait for the navigation to the Fresh cart
      await waitForTabLoad(tab.id);
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      // No button found (cart likely empty or already on Fresh cart) — skip navigation wait
      console.log(
        "[clearCart] Amazon Fresh: 'Go to Fresh Cart' button not found, skipping navigation",
      );
    }

    // Now remove all items from the Fresh cart
    const amzResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: async () => {
        const selectors = [
          "input[data-action='delete']",
          ".sc-action-delete input",
          "input[value='Delete']",
          "[data-feature-id='cart-delete-button'] input",
          "span[data-action='delete']",
          "[data-action='delete']",
        ];

        const findBtn = () => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return (
            Array.from(
              document.querySelectorAll(
                "button, input[type='submit'], input[type='button'], span[role='button'], a",
              ),
            ).find((el) => {
              const t = (
                el.textContent ||
                el.value ||
                el.getAttribute("aria-label") ||
                ""
              )
                .toLowerCase()
                .trim();
              return (
                t === "delete" ||
                t === "remove" ||
                t.includes("remove item") ||
                t.includes("delete item")
              );
            }) || null
          );
        };

        let removed = 0;
        while (removed < 50) {
          let btn = null,
            waited = 0;
          while (waited < 8000) {
            btn = findBtn();
            if (btn) break;
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }
          if (!btn) break;
          btn.scrollIntoView({ block: "center" });
          btn.click();
          removed++;
          await new Promise((r) => setTimeout(r, 1500));
        }
        return { removed };
      },
    });

    const amzRemoved = amzResults?.[0]?.result?.removed ?? 0;
    console.log(`[clearCart] Amazon Fresh: removed ${amzRemoved} item(s)`);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {}
    return true;
  }

  // ── KPN Fresh ──
  if (platform === "KPN Fresh") {
    const tab = await chrome.tabs.create({ url: cartUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise((r) => setTimeout(r, 2500));

    const kpnResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: async () => {
        // KPN Fresh is a Next.js SPA; removal buttons are often small icon-only
        // buttons (SVG trash/×) with little or no text. Cast a wide net.
        const findBtn = () => {
          // 1. data-testid attributes
          const byTestId = document.querySelector(
            "[data-testid*='remove'], [data-testid*='delete'], [data-testid*='trash']",
          );
          if (byTestId) return byTestId;

          // 2. aria-label attributes
          const byAria = document.querySelector(
            "[aria-label*='emove'], [aria-label*='elete'], [aria-label*='rash']",
          );
          if (byAria) return byAria;

          // 3. Class name patterns (covers kebab, camel and Pascal case)
          const byClass = document.querySelector(
            "button[class*='remove'], button[class*='Remove'], " +
              "button[class*='delete'], button[class*='Delete'], " +
              "button[class*='trash'],  button[class*='Trash'], " +
              "[class*='CartItem'] button",
          );
          if (byClass) return byClass;

          // 4. Scan every button/link — accept SVG-only buttons, ×/✕ characters,
          //    or text that contains remove/delete keywords.
          const candidates = Array.from(
            document.querySelectorAll("button, [role='button'], a[href]"),
          );
          const textMatch = candidates.find((el) => {
            const t = (
              el.textContent ||
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              ""
            )
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
            return (
              t === "remove" ||
              t === "delete" ||
              t === "×" ||
              t === "✕" ||
              t === "✖" ||
              t.includes("remove") ||
              t.includes("delete from cart") ||
              t.includes("remove from cart")
            );
          });
          if (textMatch) return textMatch;

          // 5. Last resort: any button that contains ONLY an SVG (icon button)
          //    that sits inside a cart item row
          const cartItemRow = document.querySelector(
            "[class*='CartItem'], [class*='cart-item'], [class*='cartItem'], [class*='LineItem'], [class*='line-item']",
          );
          if (cartItemRow) {
            const svgBtn = Array.from(
              cartItemRow.querySelectorAll("button"),
            ).find(
              (b) =>
                b.querySelector("svg") &&
                !b.querySelector("input") &&
                b.textContent.trim().length < 5,
            );
            if (svgBtn) return svgBtn;
          }

          return null;
        };

        // Debug snapshot to help if nothing is found
        const debugInfo = () => ({
          title: document.title,
          buttons: Array.from(
            document.querySelectorAll("button, [role='button']"),
          )
            .slice(0, 20)
            .map((b) => ({
              text: b.textContent.trim().substring(0, 40),
              aria: b.getAttribute("aria-label") || "",
              testid: b.getAttribute("data-testid") || "",
              cls: (b.className || "").substring(0, 80),
            })),
        });

        let removed = 0;
        while (removed < 50) {
          let btn = null,
            waited = 0;
          while (waited < 8000) {
            btn = findBtn();
            if (btn) break;
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }
          if (!btn) {
            return { removed, debug: debugInfo() };
          }
          btn.scrollIntoView({ block: "center" });
          btn.click();
          removed++;
          await new Promise((r) => setTimeout(r, 1800));
        }
        return { removed };
      },
    });

    const kpnResult = kpnResults?.[0]?.result;
    const kpnRemoved = kpnResult?.removed ?? 0;
    console.log(`[clearCart] KPN Fresh: removed ${kpnRemoved} item(s)`);
    if (kpnResult?.debug) {
      console.warn(
        "[clearCart] KPN Fresh: no remove button found — debug snapshot:",
        kpnResult.debug,
      );
    }
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {}
    return true;
  }

  return false;
}

// ── Add to Carts ──

async function addItemsToCarts(items) {
  // Group items by platform so we batch all items per platform together
  const byPlatform = {};
  for (const item of items) {
    (byPlatform[item.platform] ??= []).push(item);
  }

  // Fixed platform order regardless of search/selection order
  const platformOrder = ["BigBasket", "Amazon Fresh", "KPN Fresh"];

  // Cart page URLs for each platform
  const cartUrls = {
    BigBasket: "https://www.bigbasket.com/basket/?nc=nb",
    "Amazon Fresh": "https://www.amazon.in/gp/cart/view.html",
    "KPN Fresh": "https://www.kpnfresh.com/cart",
  };

  const results = [];
  let prevTabId = null;

  for (const platform of platformOrder) {
    const platformItems = byPlatform[platform] ?? [];
    if (platformItems.length === 0) continue;
    for (const { url } of platformItems) {
      try {
        const { tabId, ...result } = await addToCartForPlatform(
          platform,
          url,
          prevTabId,
        );
        prevTabId = tabId;
        results.push({ platform, url, ...result });
      } catch (e) {
        console.error(`addToCart error for ${platform}:`, e);
        results.push({ platform, url, success: false, error: e.message });
        prevTabId = null;
      }
    }
  }

  // Close the last adding-item tab (no next tab to trigger it automatically)
  if (prevTabId !== null) {
    try {
      const t = await chrome.tabs.get(prevTabId);
      if (!t.active) await chrome.tabs.remove(prevTabId);
    } catch (_) {}
  }

  // Open one cart tab per platform that had items, in platform order.
  // For BigBasket, reuse an existing session tab to avoid 404 on fresh navigation.
  for (const platform of platformOrder) {
    if (!byPlatform[platform]?.length) continue;
    const cartUrl = cartUrls[platform];
    if (platform === "BigBasket") {
      const bbTabs = await chrome.tabs.query({
        url: "https://www.bigbasket.com/*",
      });
      if (bbTabs.length > 0) {
        await chrome.tabs.update(bbTabs[0].id, { url: cartUrl, active: false });
        continue;
      }
    }
    await chrome.tabs.create({ url: cartUrl, active: false });
  }

  return results;
}

async function addToCartForPlatform(platform, url, prevTabId = null) {
  // active: true ensures the tab isn't throttled by browser background-tab policies
  const tab = await chrome.tabs.create({ url, active: true });

  // Now that this tab has taken focus, the previous adding-item tab is inactive — close it
  if (prevTabId !== null) {
    try {
      const prev = await chrome.tabs.get(prevTabId);
      if (!prev.active) await chrome.tabs.remove(prevTabId);
    } catch (_) {}
  }

  await waitForTabLoad(tab.id);

  // Extra settle time for SPAs (React hydration, lazy widgets)
  await new Promise((r) => setTimeout(r, 1500));

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: async (platform) => {
        // Platform-specific ordered list of selectors, most specific first
        const selectorMap = {
          BigBasket: [
            "[data-qa='btn-add']",
            "button[class*='AddToCart']",
            "button[class*='add-to-cart']",
            "button[class*='addToCart']",
            "button[aria-label*='Add']",
          ],
          "Amazon Fresh": [
            "input#add-to-cart-button",
            "#add-to-cart-button",
            "input[name='submit.add-to-cart']",
            "[name='submit.add-to-cart']",
            "#buybox input[type='submit']",
            "#buybox button[type='submit']",
          ],
          "KPN Fresh": [
            "[data-testid*='add-to-cart']",
            "[data-testid*='add_to_cart']",
            "button[class*='add-to-cart']",
            "button[class*='AddToCart']",
            "button[class*='addToCart']",
          ],
        };

        const isRelevantAddButton = (el) => {
          const text = (
            el.textContent ||
            el.value ||
            el.getAttribute("aria-label") ||
            ""
          )
            .toLowerCase()
            .trim();
          return (
            (text.includes("add to cart") ||
              text.includes("add to basket") ||
              text === "add" ||
              text === "add +") &&
            !el.disabled
          );
        };

        const findButton = () => {
          // Try known selectors first
          for (const sel of selectorMap[platform] || []) {
            const el = document.querySelector(sel);
            if (el && !el.disabled) return { el, method: sel };
          }
          // Generic text fallback
          const all = Array.from(
            document.querySelectorAll(
              "button, input[type='button'], input[type='submit']",
            ),
          );
          const btn = all.find(isRelevantAddButton);
          if (btn) return { el: btn, method: "generic-text" };
          return null;
        };

        // Poll up to 15 seconds for the button to appear
        const maxWait = 15000;
        const interval = 500;
        let waited = 0;

        while (waited < maxWait) {
          const found = findButton();
          if (found) {
            found.el.scrollIntoView({ block: "center" });
            found.el.click();
            // Wait for cart update to register
            await new Promise((r) => setTimeout(r, 1200));
            // Collect debug info about final page state
            const pageTitle = document.title;
            const allBtns = Array.from(
              document.querySelectorAll(
                "button, input[type='submit'], input[type='button']",
              ),
            )
              .map((b) =>
                (b.value || b.textContent || "").trim().substring(0, 40),
              )
              .filter(Boolean)
              .slice(0, 10);
            return { success: true, method: found.method, pageTitle, allBtns };
          }
          await new Promise((r) => setTimeout(r, interval));
          waited += interval;
        }

        // Timeout — return debug snapshot to help diagnose
        const pageTitle = document.title;
        const bodyText = document.body?.innerText?.substring(0, 500) || "";
        const allBtns = Array.from(
          document.querySelectorAll(
            "button, input[type='submit'], input[type='button']",
          ),
        )
          .map((b) => (b.value || b.textContent || "").trim().substring(0, 40))
          .filter(Boolean)
          .slice(0, 10);
        return { success: false, method: null, pageTitle, allBtns, bodyText };
      },
      args: [platform],
    });
  } catch (scriptErr) {
    // Propagate so the caller can record the failure; tab cleanup handled by caller
    throw scriptErr;
  }

  const result = results?.[0]?.result ?? { success: false };
  if (!result.success) {
    console.warn(
      `[addToCart] ${platform} FAILED — page: "${result.pageTitle}"`,
    );
    console.warn(`[addToCart] ${platform} buttons found:`, result.allBtns);
    if (result.bodyText)
      console.warn(`[addToCart] ${platform} body preview:`, result.bodyText);
  } else {
    console.log(
      `[addToCart] ${platform} SUCCESS via "${result.method}" — page: "${result.pageTitle}"`,
    );
  }
  return { ...result, tabId: tab.id };
}

// Select the best product from a list of candidates using heuristics:
// 1. Filter by keyword relevance to the search query
// 2. Filter out multi-packs/combos
// 3. For produce queries, prefer 200-500g quantities
// 4. Pick best price-per-unit (₹/100g); fall back to cheapest absolute price
// 5. If no relevant products found by keywords, fall back to AI scoring
async function selectBestProduct(query, products) {
  if (!products || products.length === 0) return null;
  if (products.length === 1) return products[0];

  // Attach parsed weight to each product
  let candidates = products.map((p) => ({
    ...p,
    weight: parseWeight(p.name),
  }));

  // Filter by keyword relevance
  const relevant = candidates.filter((p) => isRelevantToQuery(query, p.name));
  if (relevant.length > 0) {
    candidates = relevant;
  } else {
    // No keyword matches — try AI fallback
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (geminiApiKey) {
      const aiPick = await aiPickBestProduct(query, candidates, geminiApiKey);
      if (aiPick) {
        return aiPick; // AI selected the most relevant product
      }
    }
    // If no AI key or AI returned nothing, continue with all candidates
  }

  // Filter out multi-packs
  const noMulti = candidates.filter((p) => !isMultiPack(p.name));
  if (noMulti.length > 0) candidates = noMulti;

  // For produce, prefer 200-500g range
  if (isProduce(query)) {
    const produceFiltered = candidates.filter((p) => {
      if (!p.weight || p.weight.grams === null) return false;
      return p.weight.grams >= 200 && p.weight.grams <= 500;
    });
    if (produceFiltered.length > 0) candidates = produceFiltered;
  }

  // Pick best price-per-unit if weights are available
  const withWeight = candidates.filter(
    (p) => p.weight && p.weight.grams && p.weight.grams > 0,
  );

  let best;
  if (withWeight.length > 0) {
    // Best value = lowest price per gram
    best = withWeight.reduce((a, b) =>
      a.price / a.weight.grams <= b.price / b.weight.grams ? a : b,
    );
  } else {
    // No weight info — fall back to cheapest absolute price
    best = candidates.reduce((a, b) => (a.price <= b.price ? a : b));
  }

  // Remove the temporary weight field before returning
  const { weight, ...product } = best;
  return product;
}

async function searchProducts(query) {
  const platforms = [
    { name: "BigBasket", fetcher: fetchBigBasketResults },
    { name: "Amazon Fresh", fetcher: fetchAmazonFreshResults },
    { name: "KPN Fresh", fetcher: fetchKPNFreshResults },
  ];

  // Launch all fetchers in parallel
  platforms.forEach(async (platform) => {
    try {
      let results = await platform.fetcher(query);

      // Filter out sponsored products
      results = results.filter(
        (product) => !product.name?.toLowerCase().includes("sponsored"),
      );

      // Select the best product using heuristics
      const best = await selectBestProduct(query, results);

      // Send results back to popup as they arrive
      chrome.runtime.sendMessage({
        type: "platformResults",
        platform: platform.name,
        results: best ? [best] : [],
      });
    } catch (error) {
      console.error(`Error fetching from ${platform.name}:`, error);
      chrome.runtime.sendMessage({
        type: "platformResults",
        platform: platform.name,
        results: [],
      });
    }
  });
}

// ── BigBasket Scraper (DOM-based) ──

async function fetchBigBasketResults(query) {
  try {
    // Use a dedicated background tab for searching
    const searchUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}&nc=as`;

    // Find an existing BigBasket tab, or create one via about:blank then navigate
    const tabs = await chrome.tabs.query({
      url: "https://www.bigbasket.com/*",
    });
    let tabId;

    if (tabs.length > 0) {
      tabId = tabs[0].id;
    } else {
      // Create a blank tab first, then navigate — produces more user-like
      // Sec-Fetch headers than creating a tab directly with the target URL
      const tab = await chrome.tabs.create({
        url: "about:blank",
        active: false,
      });
      tabId = tab.id;
      // Navigate to BigBasket homepage to establish Cloudflare session
      await chrome.tabs.update(tabId, { url: "https://www.bigbasket.com/" });
      await waitForTabLoad(tabId);
      // Brief pause to let Cloudflare challenge resolve if any
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Navigate from within the page via window.location (looks user-initiated
    // to Cloudflare, unlike chrome.tabs.update which is flagged as programmatic)
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (url) => {
        window.location.href = url;
      },
      args: [searchUrl],
    });

    // Wait for the navigation to complete
    await waitForTabLoad(tabId);

    // Wait for SPA client-side rendering to populate product cards
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        try {
          // Poll until product links appear (BigBasket renders via React after API call)
          const maxWait = 12000;
          const interval = 400;
          let waited = 0;

          while (waited < maxWait) {
            const links = document.querySelectorAll('a[href*="/pd/"]');
            if (links.length > 0) break;
            await new Promise((r) => setTimeout(r, interval));
            waited += interval;
          }

          const productLinks = document.querySelectorAll('a[href*="/pd/"]');
          if (productLinks.length === 0) {
            return { products: [], debug: "No product links found" };
          }

          const products = [];
          const MAX_RESULTS = 10;
          const seenUrls = new Set();

          for (const link of productLinks) {
            if (products.length >= MAX_RESULTS) break;

            const url = link.href;
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            // Walk up to find the card container (needs both img and price)
            let card = link.parentElement || link;
            for (let i = 0; i < 12 && card.parentElement; i++) {
              const hasImg = card.querySelector("img") !== null;
              const hasPrice = card.textContent.includes("₹");
              if (hasImg && hasPrice) break;
              card = card.parentElement;
            }

            // Skip out-of-stock items
            const cardText = card.textContent.toLowerCase();
            if (
              cardText.includes("out of stock") ||
              cardText.includes("notify me") ||
              cardText.includes("sold out")
            )
              continue;

            // Extract product name
            let name = "";
            const heading = card.querySelector("h3, h4, h5, h2");
            if (heading) name = heading.textContent.trim();
            if (!name) name = link.textContent.trim();
            if (!name) {
              const nameEl = card.querySelector(
                '[class*="Name"], [class*="name"], [class*="Title"], [class*="title"], [class*="desc"]',
              );
              if (nameEl) name = nameEl.textContent.trim();
            }

            // Extract selling price (skip struck-through MRP)
            let price = null;
            const priceEls = card.querySelectorAll("span, div");
            for (const el of priceEls) {
              const m = el.textContent.match(/^₹\s*([\d,]+(?:\.\d+)?)$/);
              if (
                m &&
                !el.closest(
                  's, del, strike, [class*="strike"], [class*="mrp"], [class*="MRP"]',
                )
              ) {
                price = parseFloat(m[1].replace(/,/g, ""));
                break;
              }
            }
            if (price === null) {
              const allText = card.textContent;
              const pm = allText.match(/₹\s*([\d,]+(?:\.\d+)?)/);
              if (pm) price = parseFloat(pm[1].replace(/,/g, ""));
            }

            // Extract image
            let image = null;
            for (const img of card.querySelectorAll("img")) {
              const cls = (img.className || "").toLowerCase();
              const alt = (img.alt || "").toLowerCase();
              if (
                cls.includes("logo") || alt.includes("logo") ||
                alt.includes("bigbasket")
              )
                continue;
              let candidate =
                img.getAttribute("data-src") || "";
              if (!candidate && img.srcset) {
                candidate = img.srcset.split(",")[0].trim().split(" ")[0];
              }
              if (!candidate && img.src?.startsWith("https://")) {
                candidate = img.src;
              }
              if (
                candidate?.startsWith("http") &&
                !candidate.endsWith(".svg") &&
                !candidate.includes("logo")
              ) {
                image = candidate;
                break;
              }
            }

            if (name && price !== null) {
              products.push({ name, price, url, image, platform: "BigBasket" });
            }
          }

          return { products };
        } catch (e) {
          return { error: e.message };
        }
      },
    });

    const result = results?.[0]?.result;
    if (result?.error) {
      console.error("BigBasket script error:", result.error);
      return [];
    }
    if (result?.debug) {
      console.log("BigBasket debug:", result.debug);
    }

    console.log("BigBasket: products found:", result?.products?.length);
    return result?.products || [];
  } catch (error) {
    console.error("BigBasket fetch error:", error);
    return [];
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Amazon Fresh Scraper ──

async function fetchAmazonFreshResults(query) {
  // The i=nowstore parameter restricts results to Amazon Fresh inventory
  const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(
    query,
  )}&i=nowstore`;

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();

    const productMatches = html.match(
      /data-asin="[^"]*"(.*?)(?=data-asin|$)/gs,
    );

    const products = [];
    const MAX_RESULTS = 10;

    if (productMatches) {
      for (const match of productMatches) {
        if (products.length >= MAX_RESULTS) break;

        const nameMatch = match.match(/title-recipe"(.*?)<\/span>/);
        const nameText = nameMatch
          ? nameMatch[0].match(/>([^<]+)<\/span>$/)?.[1]?.trim()
          : undefined;
        const priceMatch = match.match(
          /<span[^>]*class="a-price-whole"[^>]*>([\d,]+)/i,
        );
        const urlMatch = match.match(/href="([^"]+)"/);

        // Skip out-of-stock items
        const lowerMatch = match.toLowerCase();
        if (
          lowerMatch.includes("currently unavailable") ||
          lowerMatch.includes("out of stock")
        )
          continue;

        // Amazon product images live inside the image container div;
        // they are often in srcset. Target m.media-amazon.com URLs specifically.
        let imageUrl = null;
        const imgSrcsetMatch = match.match(
          /srcset="([^"]+m\.media-amazon\.com[^"]+)"/i,
        );
        if (imgSrcsetMatch) {
          imageUrl = imgSrcsetMatch[1]
            .trim()
            .split(",")[0]
            .trim()
            .split(" ")[0];
        }
        if (!imageUrl) {
          const imgSrcMatch =
            match.match(/src="(https:\/\/[^"]*m\.media-amazon\.com[^"]*)"/i) ||
            match.match(/src="(https:\/\/[^"]*ssl-images-amazon\.com[^"]*)"/i);
          if (imgSrcMatch) imageUrl = imgSrcMatch[1];
        }

        if (nameText && priceMatch && urlMatch) {
          products.push({
            name: nameText,
            price: parseCurrency(priceMatch[1]),
            url: `https://www.amazon.in${urlMatch[1]}`,
            image: imageUrl,
            platform: "Amazon Fresh",
          });
        }
      }
    }

    return products;
  } catch (error) {
    console.error("Amazon Fresh fetch error:", error);
    return [];
  }
}

// ── KPN Fresh Scraper ──

async function fetchKPNFreshResults(query) {
  const searchUrl = `https://www.kpnfresh.com/search?q=${encodeURIComponent(
    query,
  )}`;

  try {
    const response = await fetchWithRetry(searchUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0",
      },
    });

    const html = await response.text();

    // Check if we got a Cloudflare challenge or empty page
    if (html.length < 1000) {
      console.error("KPN Fresh: Response too short, likely blocked");
      return [];
    }

    // Strategy 1: Try __NEXT_DATA__ embedded JSON
    const hasNextData = html.includes("__NEXT_DATA__");
    if (hasNextData) {
      // Use indexOf-based extraction instead of regex (more reliable for large content)
      const startMarker = '<script id="__NEXT_DATA__" type="application/json">';
      let startIdx = html.indexOf(startMarker);
      if (startIdx === -1) {
        // Try without type attribute
        const altMarker = '<script id="__NEXT_DATA__"';
        startIdx = html.indexOf(altMarker);
        if (startIdx !== -1) {
          startIdx = html.indexOf(">", startIdx) + 1;
        }
      } else {
        startIdx += startMarker.length;
      }

      if (startIdx > 0) {
        const endIdx = html.indexOf("</script>", startIdx);
        if (endIdx > startIdx) {
          const jsonStr = html.substring(startIdx, endIdx);
          try {
            const data = JSON.parse(jsonStr);
            const products = extractKPNProductsFromJSON(data);
            if (products.length > 0) return products;
          } catch (e) {
            console.error("KPN Fresh JSON parse error:", e.message);
          }
        }
      }
    }

    // Strategy 2: Regex HTML fallback
    return extractKPNProductsFromHTML(html);
  } catch (error) {
    console.error("KPN Fresh fetch error:", error);
    return [];
  }
}

function extractKPNProductsFromJSON(data) {
  const products = [];
  const MAX_RESULTS = 10;

  try {
    // Path: props.pageProps.pageProps.productResponse.data.products
    // (KPN Fresh has a double-nested pageProps)
    const pageProps =
      data?.props?.pageProps?.pageProps || data?.props?.pageProps;
    const productList = pageProps?.productResponse?.data?.products;

    if (!productList || productList.length === 0) return products;

    for (let idx = 0; idx < Math.min(productList.length, MAX_RESULTS); idx++) {
      const item = productList[idx];
      const name = item.product_title || "";
      const brandName = item.brand_name || "";
      const displayName =
        brandName && !name.startsWith(brandName)
          ? `${brandName} ${name}`
          : name;

      const packList = item.pack_list;
      if (!packList || packList.length === 0) continue;

      const pack = packList[0];

      const priceEntry =
        pack.prices?.find((p) => p.type === "PRICE_INCL_TAX") ||
        pack.prices?.[0];

      if (!priceEntry?.price?.cent_amount) continue;

      // Skip out-of-stock items
      if (item.out_of_stock || pack.out_of_stock) continue;

      const price = priceEntry.price.cent_amount / 100;
      const slug = pack.product_url || "";
      const packSize = pack.display_name || "";

      // Extract image URL
      let imageUrl =
        item.image || item.image_url || item.imageUrl ||
        item.thumbnail || item.thumbnail_url ||
        item.images?.[0]?.url || item.images?.[0]?.src || item.images?.[0] ||
        item.product_images?.[0]?.url || item.product_images?.[0] ||
        item.media?.[0]?.url || item.media?.[0]?.src ||
        pack.image || pack.image_url || pack.imageUrl ||
        pack.images?.[0]?.url || pack.images?.[0]?.src || pack.images?.[0] ||
        null;

      if (
        !imageUrl ||
        typeof imageUrl !== "string" ||
        !imageUrl.startsWith("http")
      ) {
        const rawJson = JSON.stringify(item) + JSON.stringify(pack);
        const imgMatch = rawJson.match(
          /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:[^"]{0,100})?)"/i,
        );
        if (imgMatch) imageUrl = imgMatch[1];
      }

      if (displayName && price) {
        products.push({
          name: packSize ? `${displayName} - ${packSize}` : displayName,
          price: price,
          url: slug.startsWith("http")
            ? slug
            : `https://www.kpnfresh.com/${slug}`,
          image: imageUrl,
          platform: "KPN Fresh",
        });
      }
    }
  } catch (e) {
    console.error("KPN Fresh JSON extraction error:", e);
  }

  return products;
}

function extractKPNProductsFromHTML(html) {
  const products = [];

  try {
    // Look for product cards with price patterns
    // KPN Fresh typically shows product name in headings/spans and price with ₹ or Rs.
    const pricePattern = /₹\s*([\d,]+(?:\.\d{2})?)/g;
    const namePattern =
      /<(?:h[2-4]|span|div|a)[^>]*class="[^"]*(?:product|title|name)[^"]*"[^>]*>([^<]+)</gi;

    const names = [];
    const prices = [];

    let match;
    while ((match = namePattern.exec(html)) !== null) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 200) {
        names.push(name);
      }
    }

    while ((match = pricePattern.exec(html)) !== null) {
      prices.push(parseCurrency(match[1]));
    }

    // Try to extract an image URL from HTML (look for CDN image URLs in img tags)
    let htmlImage = null;
    const imgTagMatch = html.match(
      /<img[^>]+src=["'](https:\/\/[^"']+(?:jpg|jpeg|png|webp)[^"']*)["']/i,
    );
    if (imgTagMatch) htmlImage = imgTagMatch[1];

    if (names.length > 0 && prices.length > 0) {
      products.push({
        name: names[0],
        price: prices[0],
        url: `https://www.kpnfresh.com/search?q=${encodeURIComponent(names[0])}`,
        image: htmlImage,
        platform: "KPN Fresh",
      });
    }
  } catch (e) {
    console.error("KPN Fresh HTML extraction error:", e);
  }

  return products;
}

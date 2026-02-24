document.addEventListener("DOMContentLoaded", function () {
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const resultsBody = document.getElementById("resultsBody");
  const clearCartButton = document.getElementById("clearCartButton");
  const optimizeButton = document.getElementById("optimizeButton");

  const PLATFORMS = {
    BIGBASKET: "BigBasket",
    AMAZON_FRESH: "Amazon Fresh",
    KPN_FRESH: "KPN Fresh",
  };

  const platformList = Object.values(PLATFORMS);

  // Cart state: { items: [{ searchTerm, platformResults: { platform: {name, price, url, platform} }, selectedPlatform }] }
  let cartState = { items: [] };

  // Pending search term tracked for incoming results
  let pendingSearchTerm = null;
  let pendingPlatformCount = 0;

  // ── Storage ──

  function persistCart() {
    chrome.storage.local.set({ cart: JSON.stringify(cartState) });
  }

  function loadCart(callback) {
    chrome.storage.local.get(["cart", "searchHistory"], function (data) {
      if (data.cart) {
        try {
          cartState = JSON.parse(data.cart);
        } catch (e) {
          cartState = { items: [] };
        }
      } else if (data.searchHistory) {
        // Migrate from old format
        migrateOldFormat(data.searchHistory);
      }
      callback();
    });
  }

  function migrateOldFormat(searchHistoryJson) {
    try {
      const parsed = JSON.parse(searchHistoryJson);
      cartState = { items: [] };

      parsed.forEach(([searchTerm, platformData]) => {
        const item = {
          searchTerm,
          platformResults: {},
          selectedPlatform: null,
        };

        let lowestPrice = Infinity;
        let lowestPlatform = null;

        Object.entries(platformData).forEach(([platform, results]) => {
          const product = Array.isArray(results) ? results[0] : results;
          if (product) {
            item.platformResults[platform] = product;
            if (product.price && product.price < lowestPrice) {
              lowestPrice = product.price;
              lowestPlatform = platform;
            }
          }
        });

        item.selectedPlatform = lowestPlatform;
        cartState.items.push(item);
      });

      // Save new format and remove old key
      persistCart();
      chrome.storage.local.remove("searchHistory");
    } catch (e) {
      console.error("Migration error:", e);
      cartState = { items: [] };
    }
  }

  // ── Initialization ──

  loadCart(() => {
    displayAllResults();
  });

  // ── Message Listener (registered once) ──

  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === "platformResults" && pendingSearchTerm) {
      handlePlatformResults(message.platform, message.results);
    }
  });

  // ── Search ──

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      searchButton.click();
    }
  });

  searchButton.addEventListener("click", async () => {
    const query = searchInput.value.trim();
    if (!query) {
      showError("Please enter a search term");
      return;
    }

    pendingSearchTerm = query;
    pendingPlatformCount = 0;

    initializeLoadingState();

    try {
      await chrome.runtime.sendMessage({
        action: "search",
        query: query,
      });
    } catch (error) {
      showError("Error initiating search");
      console.error(error);
    }
  });

  function initializeLoadingState() {
    const loadingRow = document.createElement("tr");
    loadingRow.id = "loadingRow";

    let html = "<td>Searching...</td>";
    platformList.forEach((platform) => {
      html += `
        <td class="platform-data loading" id="loading-${platform}">
          <div class="spinner"></div>
          <div>Loading ${platform}...</div>
        </td>
      `;
    });

    loadingRow.innerHTML = html;
    resultsBody.insertBefore(loadingRow, resultsBody.firstChild);
  }

  function handlePlatformResults(platform, results) {
    const searchTerm = pendingSearchTerm;
    if (!searchTerm) return;

    // Find or create the cart item for this search term
    let item = cartState.items.find((i) => i.searchTerm === searchTerm);
    if (!item) {
      item = {
        searchTerm,
        platformResults: {},
        selectedPlatform: null,
      };
      cartState.items.push(item);
    }

    // Store the first result for this platform
    const product = results && results[0] ? results[0] : null;
    if (product) {
      item.platformResults[platform] = product;
    }

    // Update loading indicator
    const loadingCell = document.getElementById(`loading-${platform}`);
    if (loadingCell) {
      loadingCell.classList.remove("loading");
      loadingCell.innerHTML = `<div class="platform-ready">Results ready</div>`;
    }

    pendingPlatformCount++;

    // All platforms have reported
    if (pendingPlatformCount >= platformList.length) {
      // Auto-select lowest price if no selection yet
      if (!item.selectedPlatform) {
        let lowestPrice = Infinity;
        platformList.forEach((p) => {
          const r = item.platformResults[p];
          if (r && r.price < lowestPrice) {
            lowestPrice = r.price;
            item.selectedPlatform = p;
          }
        });
      }

      persistCart();
      pendingSearchTerm = null;
      pendingPlatformCount = 0;
      displayAllResults();
    }
  }

  // ── Display ──

  function displayAllResults() {
    const loadingRow = document.getElementById("loadingRow");
    if (loadingRow) loadingRow.remove();

    resultsBody.innerHTML = "";

    // Show newest first
    const reversedItems = [...cartState.items].reverse();

    reversedItems.forEach((item) => {
      const row = document.createElement("tr");
      row.dataset.searchTerm = item.searchTerm;

      // Find lowest price for this item
      let lowestPrice = Infinity;
      let lowestPlatform = null;
      platformList.forEach((platform) => {
        const r = item.platformResults[platform];
        if (r && r.price < lowestPrice) {
          lowestPrice = r.price;
          lowestPlatform = platform;
        }
      });

      // Use the selected platform's image; fall back to first available
      const selectedImage = item.selectedPlatform
        ? item.platformResults[item.selectedPlatform]?.image || null
        : null;
      const itemImage =
        selectedImage ||
        platformList.map((p) => item.platformResults[p]?.image).find(Boolean) ||
        null;
      const itemImgHtml = itemImage
        ? `<img class="product-image item-thumb" src="${itemImage}" alt="${item.searchTerm}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="product-image item-thumb" style="display:none"></div>`;

      // Search term cell
      let html = `
        <td class="platform-data search-term-column">
          ${itemImgHtml}
          <div class="product-name search-term-label">${item.searchTerm}</div>
          <button class="delete-button" data-search="${item.searchTerm}" title="Remove item">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </td>
      `;

      // Platform cells
      platformList.forEach((platform) => {
        const product = item.platformResults[platform];

        if (product) {
          const isLowestPrice = product.price === lowestPrice;
          const isSelected = item.selectedPlatform === platform;

          const cellClasses = [
            "platform-data",
            "clickable-cell",
            isSelected ? "selected-cell" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const priceClass = isLowestPrice ? "price lowest-price" : "price";

          html += `
            <td class="${cellClasses}" data-platform="${platform}" data-url="${product.url}" data-search-term="${item.searchTerm}" data-image="${product.image || ""}">
              <div class="product-name">${product.name}</div>
              <div class="${priceClass}">Rs. ${product.price.toFixed(2)}</div>
              <div class="delivery-time">${product.deliveryTime || ""}</div>
              <button class="view-button" data-url="${product.url}">View</button>
            </td>
          `;
        } else {
          html += `
            <td class="platform-data not-available">
              <div>Not available</div>
            </td>
          `;
        }
      });

      row.innerHTML = html;
      resultsBody.appendChild(row);
    });

    addEventListeners();
    updateRunningCosts();
    updateAddToCartsButton();
  }

  // ── Event Listeners ──

  function addEventListeners() {
    document.querySelectorAll(".view-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: button.dataset.url, active: false });
      });
    });

    document.querySelectorAll(".delete-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const searchTerm = button.dataset.search;
        cartState.items = cartState.items.filter(
          (i) => i.searchTerm !== searchTerm,
        );
        persistCart();
        displayAllResults();
      });
    });

    document.querySelectorAll(".clickable-cell").forEach((cell) => {
      cell.addEventListener("click", function () {
        const searchTerm = this.dataset.searchTerm;
        const platform = this.dataset.platform;

        const item = cartState.items.find((i) => i.searchTerm === searchTerm);
        if (!item) return;

        const row = this.parentElement;
        const thumb = row.querySelector(".item-thumb");

        if (item.selectedPlatform === platform) {
          // Deselect
          item.selectedPlatform = null;
          this.classList.remove("selected-cell");
          // Fall back to first available image
          const fallbackImage =
            platformList
              .map((p) => item.platformResults[p]?.image)
              .find(Boolean) || null;
          if (thumb) {
            if (fallbackImage) {
              thumb.src = fallbackImage;
              thumb.style.display = "";
            } else {
              thumb.style.display = "none";
            }
          }
        } else {
          // Select this platform
          item.selectedPlatform = platform;
          row.querySelectorAll(".selected-cell").forEach((s) => {
            s.classList.remove("selected-cell");
          });
          this.classList.add("selected-cell");
          // Update thumbnail to selected platform's image
          const newImage = this.dataset.image || "";
          if (thumb) {
            if (newImage) {
              thumb.src = newImage;
              thumb.style.display = "";
            } else {
              thumb.style.display = "none";
            }
          }
        }

        persistCart();
        updateRunningCosts();
        updateAddToCartsButton();
      });
    });
  }

  // ── Running Costs ──

  function updateRunningCosts() {
    const costSummary = document.getElementById("costSummary");
    costSummary.innerHTML = "";

    if (cartState.items.length === 0) return;

    // Count items and subtotals per platform (selected only)
    const allSubtotals = {};
    const itemCounts = {};
    platformList.forEach((p) => {
      allSubtotals[p] = 0;
      itemCounts[p] = 0;
    });

    cartState.items.forEach((item) => {
      if (item.selectedPlatform) {
        const r = item.platformResults[item.selectedPlatform];
        if (r && r.price) {
          allSubtotals[item.selectedPlatform] += r.price;
          itemCounts[item.selectedPlatform]++;
        }
      }
    });

    // Calculate costs for each platform
    const allCosts = {};
    platformList.forEach((platform) => {
      allCosts[platform] = calculatePlatformCosts(
        platform,
        allSubtotals[platform],
      );
    });

    // Find lowest total
    let lowestTotal = Infinity;
    platformList.forEach((platform) => {
      if (
        allCosts[platform].total > 0 &&
        allCosts[platform].total < lowestTotal
      ) {
        lowestTotal = allCosts[platform].total;
      }
    });

    // Items count row
    const itemsRow = document.createElement("tr");
    itemsRow.className = "cost-row items-row";
    let itemsHtml = "<td>Items</td>";
    platformList.forEach((platform) => {
      const count = itemCounts[platform];
      itemsHtml += `<td>${count > 0 ? count : "-"}</td>`;
    });
    itemsRow.innerHTML = itemsHtml;
    costSummary.appendChild(itemsRow);

    // Subtotal row
    const subtotalRow = document.createElement("tr");
    subtotalRow.className = "cost-row subtotal-row";
    let subtotalHtml = "<td>Subtotal</td>";
    platformList.forEach((platform) => {
      const val = allCosts[platform].subtotal;
      subtotalHtml += `<td>${val > 0 ? "Rs. " + val.toFixed(2) : "-"}</td>`;
    });
    subtotalRow.innerHTML = subtotalHtml;
    costSummary.appendChild(subtotalRow);

    // Delivery fee row
    const deliveryRow = document.createElement("tr");
    deliveryRow.className = "cost-row delivery-row";
    let deliveryHtml = "<td>Delivery Fee</td>";
    platformList.forEach((platform) => {
      const cost = allCosts[platform];
      if (cost.subtotal === 0) {
        deliveryHtml += "<td>-</td>";
      } else if (cost.deliveryFee === 0) {
        deliveryHtml += '<td class="fee-free">Free</td>';
      } else {
        deliveryHtml += `<td>Rs. ${cost.deliveryFee.toFixed(2)}</td>`;
      }
    });
    deliveryRow.innerHTML = deliveryHtml;
    costSummary.appendChild(deliveryRow);

    // Handling fee row (only show if any platform has one)
    const hasHandlingFee = platformList.some(
      (p) => allCosts[p].handlingFee > 0,
    );
    if (hasHandlingFee) {
      const handlingRow = document.createElement("tr");
      handlingRow.className = "cost-row handling-row";
      let handlingHtml = "<td>Handling Fee</td>";
      platformList.forEach((platform) => {
        const cost = allCosts[platform];
        if (cost.subtotal === 0 || cost.handlingFee === 0) {
          handlingHtml += "<td>-</td>";
        } else {
          handlingHtml += `<td>Rs. ${cost.handlingFee.toFixed(2)}</td>`;
        }
      });
      handlingRow.innerHTML = handlingHtml;
      costSummary.appendChild(handlingRow);
    }

    // Total row (per platform)
    const totalRow = document.createElement("tr");
    totalRow.className = "cost-row total-row";
    let totalHtml = "<td><strong>Total</strong></td>";
    platformList.forEach((platform) => {
      const total = allCosts[platform].total;
      const isLowest = total === lowestTotal && total > 0;
      const cls = isLowest ? ' class="lowest-total"' : "";
      totalHtml += `<td${cls}><strong>${
        total > 0 ? "Rs. " + total.toFixed(2) : "-"
      }</strong></td>`;
    });
    totalRow.innerHTML = totalHtml;
    costSummary.appendChild(totalRow);

    // Grand total row (across all platforms)
    const grandTotalItems = platformList.reduce(
      (sum, p) => sum + itemCounts[p],
      0,
    );
    const grandTotalCost = platformList.reduce(
      (sum, p) => sum + allCosts[p].total,
      0,
    );

    if (grandTotalItems > 0) {
      const grandRow = document.createElement("tr");
      grandRow.className = "cost-row grand-total-row";
      grandRow.innerHTML = `
        <td colspan="${platformList.length + 1}">
          <div class="grand-total-inner">
            <span class="grand-total-section grand-total-label">Grand Total</span>
            <span class="grand-total-divider"></span>
            <span class="grand-total-section">
              <span class="grand-total-section-key">Items</span>
              <span class="grand-total-section-val">${grandTotalItems}</span>
            </span>
            <span class="grand-total-divider"></span>
            <span class="grand-total-section">
              <span class="grand-total-section-key">Total Price</span>
              <span class="grand-total-section-val">Rs. ${grandTotalCost.toFixed(2)}</span>
            </span>
          </div>
        </td>
      `;
      costSummary.appendChild(grandRow);
    }
  }

  // ── Add to Carts ──

  const addToCartsButton = document.getElementById("addToCartsButton");

  function updateAddToCartsButton() {
    const hasSelections = cartState.items.some((i) => i.selectedPlatform);
    addToCartsButton.disabled = !hasSelections;
  }

  // ── Clear existing carts ──

  async function clearExistingCarts(platforms) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "clearCarts", platforms },
        (response) => {
          resolve(response?.results ?? []);
        },
      );
    });
  }

  // ── Clear-carts modal ──

  const clearCartsModal = document.getElementById("clearCartsModal");

  function showClearCartsModal(onAnswer) {
    clearCartsModal.style.display = "flex";
    const yesBtn = document.getElementById("clearCartsYes");
    const noBtn = document.getElementById("clearCartsNo");

    function close(answer) {
      clearCartsModal.style.display = "none";
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      onAnswer(answer);
    }
    function onYes() {
      close(true);
    }
    function onNo() {
      close(false);
    }

    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
  }

  addToCartsButton.addEventListener("click", () => {
    const itemsWithSelections = cartState.items.filter(
      (i) => i.selectedPlatform && i.platformResults[i.selectedPlatform]?.url,
    );
    if (itemsWithSelections.length === 0) return;

    const items = itemsWithSelections.map((item) => ({
      platform: item.selectedPlatform,
      url: item.platformResults[item.selectedPlatform].url,
    }));

    const platforms = [...new Set(items.map((i) => i.platform))];

    showClearCartsModal(async (shouldClear) => {
      if (shouldClear) {
        // Show clearing status while we wait
        addToCartsButton.textContent = `Clearing ${platforms.length} cart${platforms.length > 1 ? "s" : ""}...`;
        addToCartsButton.disabled = true;
        await clearExistingCarts(platforms);
      }
      proceedWithAddToCarts(items);
    });
  });

  function proceedWithAddToCarts(items) {
    // Show in-progress state
    addToCartsButton.textContent = `Adding ${items.length} item${items.length > 1 ? "s" : ""}...`;
    addToCartsButton.disabled = true;

    chrome.runtime.sendMessage({ action: "addToCarts", items }, (response) => {
      const results = response?.results || [];
      const failed = results.filter((r) => !r.success).length;
      if (failed === 0) {
        addToCartsButton.textContent = `✓ Added ${items.length} item${items.length > 1 ? "s" : ""}!`;
      } else {
        addToCartsButton.textContent = `Added ${items.length - failed}/${items.length} — ${failed} failed`;
      }
      setTimeout(() => {
        addToCartsButton.textContent = "Add to Carts";
        updateAddToCartsButton();
      }, 3000);
    });
  }

  // ── Clear Cart ──

  clearCartButton.addEventListener("click", () => {
    cartState.items = [];
    persistCart();
    displayAllResults();
    // Hide optimization panel if open
    document.getElementById("optimizationResults").style.display = "none";
  });

  // ── Optimize ──

  let lastOptimalAssignment = null;
  let lastOptimizedItems = null;

  optimizeButton.addEventListener("click", () => {
    const items = cartState.items.filter((item) =>
      Object.values(item.platformResults).some((r) => r && r.price),
    );

    if (items.length === 0) {
      showError("No items in cart to optimize");
      return;
    }

    // Current user assignment
    const currentAssignment = items.map((item) => item.selectedPlatform);

    // Run optimization
    const {
      bestCost,
      bestAssignment,
      items: validItems,
    } = runOptimization(items, platformList);

    if (!bestAssignment) {
      showError("Could not find an optimal assignment");
      return;
    }

    lastOptimalAssignment = bestAssignment;
    lastOptimizedItems = validItems;

    // Generate suggestions
    const currentAssignmentForValid = validItems.map(
      (item) => item.selectedPlatform,
    );
    const suggestions = generateSuggestions(
      validItems,
      currentAssignmentForValid,
      bestAssignment,
      platformList,
    );

    displayOptimizationResults(suggestions);
  });

  function displayOptimizationResults(suggestions) {
    const panel = document.getElementById("optimizationResults");
    const content = document.getElementById("optimizationContent");
    const applyBtn = document.getElementById("applyOptimization");

    content.innerHTML = "";

    let hasActionableSuggestions = false;

    suggestions.forEach((s) => {
      const div = document.createElement("div");
      div.className = `suggestion-item ${s.type}`;
      div.textContent = s.message;
      content.appendChild(div);

      if (s.type === "move" || s.type === "summary") {
        hasActionableSuggestions = true;
      }
    });

    // Only show Apply button if there are actionable suggestions
    applyBtn.style.display = hasActionableSuggestions ? "block" : "none";

    panel.style.display = "block";
  }

  document.getElementById("closeOptimization").addEventListener("click", () => {
    document.getElementById("optimizationResults").style.display = "none";
  });

  document.getElementById("applyOptimization").addEventListener("click", () => {
    if (!lastOptimalAssignment || !lastOptimizedItems) return;

    // Apply the optimal assignment to cart state
    lastOptimizedItems.forEach((item, i) => {
      const cartItem = cartState.items.find(
        (ci) => ci.searchTerm === item.searchTerm,
      );
      if (cartItem && lastOptimalAssignment[i]) {
        cartItem.selectedPlatform = lastOptimalAssignment[i];
      }
    });

    persistCart();
    displayAllResults();
    document.getElementById("optimizationResults").style.display = "none";
  });

  // ── Helpers ──

  function showError(message) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="${platformList.length + 1}" class="error">
          ${message}
        </td>
      </tr>
    `;
  }
});

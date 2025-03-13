document.addEventListener("DOMContentLoaded", function () {
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const resultsBody = document.getElementById("resultsBody");

  const PLATFORMS = {
    BIGBASKET: "BigBasket",
    BLINKIT: "Blinkit",
    AMAZON: "Amazon",
  };
  let currentResults = new Map(); // Store current results

  // Add enter key support
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

    // Reset current results
    currentResults.clear();
    initializeLoadingState();

    // Set up message listener for platform results
    chrome.runtime.onMessage.addListener(function messageListener(message) {
      if (message.type === "platformResults") {
        handlePlatformResults(message.platform, message.results);
      }
    });

    // Trigger the search
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
    resultsBody.innerHTML = "";
    const loadingRow = document.createElement("tr");
    loadingRow.id = "loadingRow";

    let html = "<td>Searching...</td>";
    Object.values(PLATFORMS).forEach((platform) => {
      html += `
          <td class="platform-data loading" id="loading-${platform}">
            <div class="spinner"></div>
            <div>Loading ${platform}...</div>
          </td>
        `;
    });

    loadingRow.innerHTML = html;
    resultsBody.appendChild(loadingRow);
  }

  function handlePlatformResults(platform, results) {
    // Store the results
    currentResults.set(platform, results);

    // Remove loading state for this platform
    const loadingCell = document.getElementById(`loading-${platform}`);
    if (loadingCell) {
      loadingCell.classList.remove("loading");
      loadingCell.innerHTML = `<div class="platform-ready">Results ready</div>`;
    }

    // Check if all platforms have reported results
    if (currentResults.size === Object.values(PLATFORMS).length) {
      displayFinalResults();
    }
  }

  function displayFinalResults() {
    // Organize results by product
    const productMap = new Map();

    // Process results from each platform
    currentResults.forEach((results, platform) => {
      results.forEach((product) => {
        const normalizedProduct = normalizeProductName(
          searchInput.value.trim()
        );

        if (!productMap.has(normalizedProduct)) {
          productMap.set(normalizedProduct, {
            name: normalizedProduct,
            platforms: {},
          });
        }

        productMap.get(normalizedProduct).platforms[platform] = {
          name: normalizeProductName(product.name),
          price: product.price,
          deliveryTime: product.deliveryTime,
          url: product.url,
        };
      });
    });

    // Convert to array and sort by name
    const organizedResults = Array.from(productMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Display results
    resultsBody.innerHTML = "";

    organizedResults.forEach((product) => {
      const row = document.createElement("tr");

      // Product name cell
      let html = `<td class="product-name">${product.name}</td>`;

      // Platform cells
      Object.values(PLATFORMS).forEach((platform) => {
        const platformData = product.platforms[platform];
        if (platformData) {
          html += `
              <td class="platform-data">
                <div class="product-name">${platformData.name}</div>
                <div class="price">Rs. ${platformData.price.toFixed(2)}</div>
                <div class="delivery-time">${platformData.deliveryTime}</div>
                <button class="view-button" data-url="${
                  platformData.url
                }">View</button>
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

    // Add event listeners to buttons
    document.querySelectorAll(".view-button").forEach((button) => {
      button.addEventListener("click", () => {
        chrome.tabs.create({ url: button.dataset.url });
      });
    });
  }

  function normalizeProductName(name) {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function showError(message) {
    resultsBody.innerHTML = `
        <tr>
          <td colspan="${Object.values(PLATFORMS).length + 1}" class="error">
            ${message}
          </td>
        </tr>
      `;
  }

  function displayResults(searchTerm, results) {
    const tableBody = document.getElementById("resultsBody");
    tableBody.innerHTML = "";

    // Create a row for this search term
    const row = document.createElement("tr");

    // Product column - Search term
    const productCell = document.createElement("td");
    productCell.textContent = searchTerm;
    row.appendChild(productCell);

    // Platform columns
    const platforms = ["BigBasket", "Blinkit", "Amazon"];

    platforms.forEach((platform) => {
      const platformCell = document.createElement("td");
      const platformResult = results.find((r) => r.platform === platform);

      if (platformResult) {
        // Show both parsed name and price
        platformCell.innerHTML = `
            <div class="product-name">${platformResult.name}</div>
            <div class="product-price">${platformResult.price.toFixed(2)}</div>
          `;
      } else {
        platformCell.textContent = "N/A";
      }

      row.appendChild(platformCell);
    });

    tableBody.appendChild(row);
  }
});

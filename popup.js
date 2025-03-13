document.addEventListener("DOMContentLoaded", function () {
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const resultsBody = document.getElementById("resultsBody");

  const PLATFORMS = {
    BIGBASKET: "BigBasket",
    BLINKIT: "Blinkit",
    AMAZON: "Amazon",
  };
  let allResults = new Map(); // Store all accumulated results

  // Load all previous results when popup opens
  chrome.storage.local.get(["searchHistory"], function (data) {
    if (data.searchHistory) {
      // Convert the parsed data back into a Map of Maps
      const parsedData = JSON.parse(data.searchHistory);
      allResults = new Map(
        parsedData.map(([key, value]) => [key, new Map(Object.entries(value))])
      );
      displayAllResults();
    }
  });

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

    // Don't clear current results, just initialize loading state for new search
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
    // Create new loading row instead of clearing the table
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
    resultsBody.insertBefore(loadingRow, resultsBody.firstChild);
  }

  function handlePlatformResults(platform, results) {
    const searchTerm = searchInput.value.trim();
    if (!allResults.has(searchTerm)) {
      allResults.set(searchTerm, new Map());
    }

    // Store results for this search term and platform
    const platformResults = allResults.get(searchTerm);
    if (!(platformResults instanceof Map)) {
      allResults.set(searchTerm, new Map());
    }
    allResults.get(searchTerm).set(platform, results);

    // Convert Maps to a serializable format before storing
    const serializableResults = Array.from(allResults.entries()).map(
      ([term, platformMap]) => [term, Object.fromEntries(platformMap)]
    );

    // Save all results to storage
    chrome.storage.local.set({
      searchHistory: JSON.stringify(serializableResults),
    });

    // Remove loading state for this platform
    const loadingCell = document.getElementById(`loading-${platform}`);
    if (loadingCell) {
      loadingCell.classList.remove("loading");
      loadingCell.innerHTML = `<div class="platform-ready">Results ready</div>`;
    }

    // Check if all platforms have reported results for current search
    const currentPlatformResults = allResults.get(searchTerm);
    if (
      currentPlatformResults instanceof Map &&
      currentPlatformResults.size === Object.values(PLATFORMS).length
    ) {
      displayAllResults();
    }
  }

  function displayAllResults() {
    // Remove loading row if exists
    const loadingRow = document.getElementById("loadingRow");
    if (loadingRow) {
      loadingRow.remove();
    }

    // Clear current display
    resultsBody.innerHTML = "";

    // Convert to array, reverse it to show newest first, then iterate
    Array.from(allResults.entries())
      .reverse()
      .forEach(([searchTerm, platformResults]) => {
        const row = document.createElement("tr");
        row.dataset.searchTerm = searchTerm;

        // Search term cell with delete button - add structure similar to platform cells
        let html = `
          <td class="platform-data search-term-column">
            <div class="product-name">${searchTerm}</div>
            <div class="search-term-spacer">&nbsp;</div>
            <div class="search-term-actions">
              <button class="delete-button" data-search="${searchTerm}">X</button>
            </div>
          </td>
        `;

        // Find the lowest price and platform
        let lowestPrice = Infinity;
        let lowestPricePlatform = null;

        Object.values(PLATFORMS).forEach((platform) => {
          const results = platformResults.get(platform) || [];
          const product = results[0]; // Get first result

          if (product && typeof product.price === "number") {
            if (product.price < lowestPrice) {
              lowestPrice = product.price;
              lowestPricePlatform = platform;
            }
          }
        });

        // Platform cells
        Object.values(PLATFORMS).forEach((platform) => {
          const results = platformResults.get(platform) || [];
          const product = results[0]; // Get first result

          if (product) {
            // Check if this product has the lowest price
            const isLowestPrice = product.price === lowestPrice;
            // Add both lowest price styling and selected cell class for lowest price
            const cellClasses = isLowestPrice
              ? "platform-data clickable-cell selected-cell"
              : "platform-data clickable-cell";
            const priceClass = isLowestPrice ? "price lowest-price" : "price";

            html += `
              <td class="${cellClasses}" data-platform="${platform}" data-url="${
              product.url
            }">
                <div class="product-name">${product.name}</div>
                <div class="${priceClass}">Rs. ${product.price.toFixed(2)}</div>
                <div class="delivery-time">${product.deliveryTime || ""}</div>
                <button class="view-button" data-url="${
                  product.url
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

    // Add event listeners to buttons and cells
    addEventListeners();
  }

  // Separated this into its own function for cleaner code
  function addEventListeners() {
    // Add event listeners to buttons
    document.querySelectorAll(".view-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent cell click when button is clicked
        chrome.tabs.create({ url: button.dataset.url, active: false });
      });
    });

    // Add delete button listeners
    document.querySelectorAll(".delete-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent cell click when button is clicked
        const searchTerm = button.dataset.search;
        allResults.delete(searchTerm);
        // Update storage
        chrome.storage.local.set({
          searchHistory: JSON.stringify(Array.from(allResults.entries())),
        });
        // Refresh display
        displayAllResults();
      });
    });

    // Add click event listeners for all platform cells
    document.querySelectorAll(".clickable-cell").forEach((cell) => {
      cell.addEventListener("click", function () {
        // Check if this cell is already selected
        if (this.classList.contains("selected-cell")) {
          // If already selected, just remove the class to deselect it
          this.classList.remove("selected-cell");
        } else {
          // If not selected, first remove selected class from all cells in this row
          const row = this.parentElement;
          row.querySelectorAll(".selected-cell").forEach((selected) => {
            selected.classList.remove("selected-cell");
          });
          // Then add to this cell
          this.classList.add("selected-cell");
        }
      });
    });
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

document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const resultsBody = document.getElementById('resultsBody');

  const PLATFORMS = ['BigBasket', 'Blinkit', 'Zepto', 'Amazon'];
  let currentResults = new Map(); // Store current results

  // Add enter key support
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchButton.click();
    }
  });

  searchButton.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) {
      showError('Please enter a search term');
      return;
    }

    // Reset current results
    currentResults.clear();
    initializeLoadingState();

    // Set up message listener for platform results
    chrome.runtime.onMessage.addListener(function messageListener(message) {
      if (message.type === 'platformResults') {
        handlePlatformResults(message.platform, message.results);
      }
    });

    // Trigger the search
    try {
      await chrome.runtime.sendMessage({
        action: 'search',
        query: query
      });
    } catch (error) {
      showError('Error initiating search');
      console.error(error);
    }
  });

  function initializeLoadingState() {
    resultsBody.innerHTML = '';
    const loadingRow = document.createElement('tr');
    loadingRow.id = 'loadingRow';
    
    let html = '<td>Searching...</td>';
    PLATFORMS.forEach(platform => {
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
      loadingCell.classList.remove('loading');
      loadingCell.innerHTML = `<div class="platform-ready">Results ready</div>`;
    }

    // Check if all platforms have reported results
    if (currentResults.size === PLATFORMS.length) {
      displayFinalResults();
    }
  }

  function displayFinalResults() {
    // Organize results by product
    const productMap = new Map();

    // Process results from each platform
    currentResults.forEach((results, platform) => {
      results.forEach(product => {
        const normalizedName = normalizeProductName(product.name);
        
        if (!productMap.has(normalizedName)) {
          productMap.set(normalizedName, {
            name: product.name,
            platforms: {}
          });
        }

        productMap.get(normalizedName).platforms[platform] = {
          price: product.price,
          deliveryTime: product.deliveryTime,
          url: product.url
        };
      });
    });

    // Convert to array and sort by name
    const organizedResults = Array.from(productMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    // Display results
    resultsBody.innerHTML = '';
    
    organizedResults.forEach(product => {
      const row = document.createElement('tr');
      
      // Product name cell
      let html = `<td class="product-name">${product.name}</td>`;
      
      // Platform cells
      PLATFORMS.forEach(platform => {
        const platformData = product.platforms[platform];
        if (platformData) {
          html += `
            <td class="platform-data">
              <div class="price">₹${platformData.price.toFixed(2)}</div>
              <div class="delivery-time">${platformData.deliveryTime}</div>
              <button class="view-button" data-url="${platformData.url}">View</button>
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
    document.querySelectorAll('.view-button').forEach(button => {
      button.addEventListener('click', () => {
        chrome.tabs.create({ url: button.dataset.url });
      });
    });
  }

  function normalizeProductName(name) {
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function showError(message) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="${PLATFORMS.length + 1}" class="error">
          ${message}
        </td>
      </tr>
    `;
  }
});

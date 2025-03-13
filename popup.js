document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const resultsBody = document.getElementById('resultsBody');

  const PLATFORMS = ['BigBasket', 'Blinkit', 'Zepto', 'Amazon', 'Flipkart'];

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

    showLoading();

    try {
      const results = await chrome.runtime.sendMessage({
        action: 'search',
        query: query
      });

      if (results.length === 0) {
        showError('No results found');
        return;
      }

      // Group results by product name
      const groupedResults = groupResultsByProduct(results);
      displayResults(groupedResults);
    } catch (error) {
      showError('Error fetching results');
      console.error(error);
    }
  });

  function showLoading() {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="${PLATFORMS.length + 1}" class="loading">
          <div class="spinner"></div>
          Searching across platforms...
        </td>
      </tr>
    `;
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

  function groupResultsByProduct(results) {
    const grouped = new Map();

    results.forEach(result => {
      const productName = result.name.toLowerCase();
      if (!grouped.has(productName)) {
        grouped.set(productName, {
          name: result.name,
          platforms: {}
        });
      }
      grouped.get(productName).platforms[result.platform] = {
        price: result.price,
        deliveryTime: result.deliveryTime,
        url: result.url
      };
    });

    return Array.from(grouped.values());
  }

  function displayResults(groupedResults) {
    resultsBody.innerHTML = '';
    
    groupedResults.forEach(product => {
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
});

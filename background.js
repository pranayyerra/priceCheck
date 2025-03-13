import { parseCurrency, fetchWithRetry, cache } from './utils.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'search') {
      searchProducts(request.query).then(sendResponse);
      return true; // Will respond asynchronously
    }
  });
  
  async function searchProducts(query) {
    // Check cache first
    const cacheKey = `search_${query}`;
    const cachedResults = cache.get(cacheKey);
    if (cachedResults) {
      return cachedResults;
    }
  
    const platforms = [
      {
        name: 'BigBasket',
        scraper: scrapeBigBasket
      },
      {
        name: 'Blinkit',
        scraper: scrapeBlinkit
      },
      {
        name: 'Zepto',
        scraper: scrapeZepto
      },
      {
        name: 'Amazon',
        scraper: scrapeAmazon
      },
      {
        name: 'Flipkart',
        scraper: scrapeFlipkart
      }
    ];
  
    const results = await Promise.allSettled(
      platforms.map(platform => platform.scraper(query))
    );
  
    const validResults = results
      .map((result, index) => {
        if (result.status === 'fulfilled') {
          return {
            platform: platforms[index].name,
            ...result.value
          };
        }
        console.error(`Error scraping ${platforms[index].name}:`, result.reason);
        return null;
      })
      .filter(result => result !== null)
      .sort((a, b) => a.price - b.price);
  
    // Cache the results
    cache.set(cacheKey, validResults);
    return validResults;
  }
  
  async function scrapeBigBasket(query) {
    const searchUrl = `https://www.bigbasket.com/customsearch/products/?q=${encodeURIComponent(query)}`;
    
    try {
      const response = await fetchWithRetry(searchUrl);
      const data = await response.json();
      
      if (!data.products || data.products.length === 0) {
        throw new Error('No products found');
      }
  
      const product = data.products[0]; // Get first result
      return {
        price: parseCurrency(product.price),
        deliveryTime: product.delivery_time || '2-3 hours',
        url: `https://www.bigbasket.com${product.url}`,
        name: product.name,
        image: product.image_url
      };
    } catch (error) {
      throw new Error(`BigBasket scraping failed: ${error.message}`);
    }
  }
  
  async function scrapeBlinkit(query) {
    const searchUrl = `https://blinkit.com/v2/search?q=${encodeURIComponent(query)}`;
    
    try {
      const response = await fetchWithRetry(searchUrl);
      const data = await response.json();
      
      if (!data.products || data.products.length === 0) {
        throw new Error('No products found');
      }
  
      const product = data.products[0];
      return {
        price: product.price,
        deliveryTime: '10-20 minutes',
        url: `https://blinkit.com/products/${product.slug}`,
        name: product.name,
        image: product.image_url
      };
    } catch (error) {
      throw new Error(`Blinkit scraping failed: ${error.message}`);
    }
  }
  
  async function scrapeZepto(query) {
    const searchUrl = `https://www.zeptonow.com/api/search?q=${encodeURIComponent(query)}`;
    
    try {
      const response = await fetchWithRetry(searchUrl);
      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        throw new Error('No products found');
      }
  
      const product = data.results[0];
      return {
        price: product.price,
        deliveryTime: '10-20 minutes',
        url: `https://www.zeptonow.com/product/${product.slug}`,
        name: product.name,
        image: product.image
      };
    } catch (error) {
      throw new Error(`Zepto scraping failed: ${error.message}`);
    }
  }
  
  async function scrapeAmazon(query) {
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}+grocery`;
    
    try {
      const response = await fetchWithRetry(searchUrl);
      const text = await response.text();
      
      // Use regex to extract product information
      const priceMatch = text.match(/"price":{"displayAmount":"₹([\d,]+\.?\d*)/);
      const nameMatch = text.match(/"title":"([^"]+)"/);
      const urlMatch = text.match(/"url":"([^"]+)"/);
      
      if (!priceMatch || !nameMatch || !urlMatch) {
        throw new Error('Product information not found');
      }
  
      return {
        price: parseCurrency(priceMatch[1]),
        deliveryTime: '2-3 days',
        url: urlMatch[1].replace(/\\/g, ''),
        name: nameMatch[1],
        image: null // Add image extraction if needed
      };
    } catch (error) {
      throw new Error(`Amazon scraping failed: ${error.message}`);
    }
  }
  
  async function scrapeFlipkart(query) {
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}+grocery`;
    
    try {
      const response = await fetchWithRetry(searchUrl);
      const text = await response.text();
      
      // Use regex to extract product information
      const priceMatch = text.match(/"price":{"value":([\d.]+)/);
      const nameMatch = text.match(/"name":"([^"]+)"/);
      const urlMatch = text.match(/"url":"([^"]+)"/);
      
      if (!priceMatch || !nameMatch || !urlMatch) {
        throw new Error('Product information not found');
      }
  
      return {
        price: parseFloat(priceMatch[1]),
        deliveryTime: '2-4 days',
        url: `https://www.flipkart.com${urlMatch[1]}`,
        name: nameMatch[1],
        image: null // Add image extraction if needed
      };
    } catch (error) {
      throw new Error(`Flipkart scraping failed: ${error.message}`);
    }
  }
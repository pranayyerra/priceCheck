// Helper function to parse currency strings to numbers
const parseCurrency = (priceStr) => {
  return parseFloat(priceStr.replace(/[^0-9.]/g, ''));
};

// Helper function to make HTTP requests with retry logic
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...options.headers,
        },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
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
      timestamp: Date.now()
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
  }
};

export { parseCurrency, fetchWithRetry, cache }; 
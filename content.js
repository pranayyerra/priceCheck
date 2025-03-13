// Example for scraping Amazon
const prices = document.querySelectorAll('.a-price-whole'); // Adjust selectors as per site structure
const deliveryTimes = document.querySelectorAll('.delivery-time-class'); // Example selector

chrome.runtime.sendMessage({
    site: 'Amazon',
    prices: Array.from(prices).map(price => price.innerText),
    deliveryTimes: Array.from(deliveryTimes).map(time => time.innerText)
});

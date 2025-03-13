chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchData') {
        const sites = [
            { name: 'Amazon', url: `https://www.amazon.in/s?k=${message.product}` },
            { name: 'Big Basket', url: `https://www.bigbasket.com/ps/?q=${message.product}` },
            { name: 'Zepto', url: `https://www.zepto.com/search?q=${message.product}` },
            { name: 'Flipkart Minutes', url: `https://www.flipkart.com/search?q=${message.product}` },
            { name: 'Blinkit', url: `https://www.blinkit.com/search?q=${message.product}` }
        ];

        Promise.all(sites.map(site => fetch(site.url).then(res => res.text())))
            .then(responses => {
                const results = responses.map((html, index) => {
                    // Parse HTML using DOMParser or regex to extract price/delivery info
                    return `${sites[index].name}: Price & Delivery Info`;
                });
                sendResponse({ data: results.join('<br>') });
            })
            .catch(err => sendResponse({ data: 'Error fetching data.' }));

        return true; // Keeps the message channel open for async response
    }
});

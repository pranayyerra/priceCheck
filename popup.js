document.getElementById("compare").addEventListener("click", () => {
    const product = document.getElementById("product").value;
    if (product) {
        chrome.runtime.sendMessage({ action: 'fetchData', product }, (response) => {
            document.getElementById("results").innerHTML = response.data || 'No data found.';
        });
    } else {
        alert("Please enter a product name.");
    }
});

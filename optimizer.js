// ── Optimization Algorithm ──
// Finds the item→platform assignment that minimizes total cost
// (item prices + per-platform delivery/handling fees).

function calculateAssignmentCost(items, assignment, platforms) {
  const platformSubtotals = {};
  platforms.forEach((p) => {
    platformSubtotals[p] = 0;
  });

  for (let i = 0; i < items.length; i++) {
    const platform = assignment[i];
    if (!platform) continue;
    const result = items[i].platformResults[platform];
    if (result && result.price) {
      platformSubtotals[platform] += result.price;
    }
  }

  let totalCost = 0;
  platforms.forEach((platform) => {
    if (platformSubtotals[platform] > 0) {
      const costs = calculatePlatformCosts(platform, platformSubtotals[platform]);
      totalCost += costs.total;
    }
  });

  return totalCost;
}

// For small carts (N <= 12): enumerate all possible assignments
function optimizeExhaustive(items, platforms) {
  const n = items.length;
  const numPlatforms = platforms.length;
  const totalCombinations = Math.pow(numPlatforms, n);

  let bestCost = Infinity;
  let bestAssignment = null;

  for (let combo = 0; combo < totalCombinations; combo++) {
    const assignment = [];
    let temp = combo;
    let valid = true;

    for (let i = 0; i < n; i++) {
      const platformIdx = temp % numPlatforms;
      temp = Math.floor(temp / numPlatforms);
      const platform = platforms[platformIdx];

      // Check if item is available on this platform
      const result = items[i].platformResults[platform];
      if (!result || !result.price) {
        valid = false;
        break;
      }
      assignment.push(platform);
    }

    if (!valid) continue;

    const cost = calculateAssignmentCost(items, assignment, platforms);
    if (cost < bestCost) {
      bestCost = cost;
      bestAssignment = [...assignment];
    }
  }

  return { bestCost, bestAssignment };
}

// For larger carts (N > 12): greedy + local search
function optimizeGreedy(items, platforms) {
  // Step 1: Assign each item to its cheapest available platform
  const assignment = items.map((item) => {
    let bestPlatform = null;
    let bestPrice = Infinity;
    for (const platform of platforms) {
      const result = item.platformResults[platform];
      if (result && result.price < bestPrice) {
        bestPrice = result.price;
        bestPlatform = platform;
      }
    }
    return bestPlatform;
  });

  // Step 2: Local search - try moving each item to improve total
  let currentCost = calculateAssignmentCost(items, assignment, platforms);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < items.length; i++) {
      for (const platform of platforms) {
        if (platform === assignment[i]) continue;
        const result = items[i].platformResults[platform];
        if (!result || !result.price) continue;

        const oldPlatform = assignment[i];
        assignment[i] = platform;
        const newCost = calculateAssignmentCost(items, assignment, platforms);

        if (newCost < currentCost) {
          currentCost = newCost;
          improved = true;
        } else {
          assignment[i] = oldPlatform;
        }
      }
    }
  }

  return { bestCost: currentCost, bestAssignment: assignment };
}

function runOptimization(items, platforms) {
  // Filter to items that have at least one platform result
  const validItems = items.filter((item) =>
    Object.values(item.platformResults).some((r) => r && r.price)
  );

  if (validItems.length === 0) {
    return { bestCost: 0, bestAssignment: [], items: validItems };
  }

  const optimizeFn = validItems.length <= 12 ? optimizeExhaustive : optimizeGreedy;
  const result = optimizeFn(validItems, platforms);
  return { ...result, items: validItems };
}

function generateSuggestions(items, currentAssignment, optimalAssignment, platforms) {
  const suggestions = [];

  if (!optimalAssignment || optimalAssignment.length === 0) {
    return [{ type: "info", message: "No items to optimize." }];
  }

  const currentCost = calculateAssignmentCost(items, currentAssignment, platforms);
  const optimalCost = calculateAssignmentCost(items, optimalAssignment, platforms);

  if (optimalCost >= currentCost) {
    return [{ type: "info", message: "Your current selection is already optimal!" }];
  }

  suggestions.push({
    type: "summary",
    message: `You can save Rs. ${(currentCost - optimalCost).toFixed(2)} by reorganizing your cart.`,
    savings: currentCost - optimalCost,
  });

  // Per-item move suggestions
  for (let i = 0; i < items.length; i++) {
    if (currentAssignment[i] !== optimalAssignment[i]) {
      const item = items[i];
      const fromPlatform = currentAssignment[i];
      const toPlatform = optimalAssignment[i];
      const fromPrice = item.platformResults[fromPlatform]?.price || 0;
      const toPrice = item.platformResults[toPlatform]?.price || 0;

      suggestions.push({
        type: "move",
        searchTerm: item.searchTerm,
        from: fromPlatform,
        to: toPlatform,
        priceDiff: toPrice - fromPrice,
        message: `Move "${item.searchTerm}" from ${fromPlatform} (Rs. ${fromPrice.toFixed(2)}) to ${toPlatform} (Rs. ${toPrice.toFixed(2)})`,
      });
    }
  }

  // Free delivery threshold tips
  const optimalSubtotals = {};
  platforms.forEach((p) => {
    optimalSubtotals[p] = 0;
  });
  for (let i = 0; i < items.length; i++) {
    const platform = optimalAssignment[i];
    if (!platform) continue;
    const result = items[i].platformResults[platform];
    if (result && result.price) {
      optimalSubtotals[platform] += result.price;
    }
  }

  platforms.forEach((platform) => {
    const fees = PLATFORM_FEES[platform];
    if (!fees) return;
    const subtotal = optimalSubtotals[platform];
    if (subtotal > 0 && fees.freeDeliveryThreshold > 0 && subtotal < fees.freeDeliveryThreshold) {
      const gap = fees.freeDeliveryThreshold - subtotal;
      suggestions.push({
        type: "threshold",
        platform,
        message: `Add Rs. ${gap.toFixed(2)} more to ${platform} to get free delivery (saves Rs. ${fees.deliveryFee})`,
      });
    }
  });

  return suggestions;
}

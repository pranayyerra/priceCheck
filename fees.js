// Platform fee configuration
// These are best-effort defaults. Update as platform pricing changes.
const PLATFORM_FEES = {
  "BigBasket": {
    freeDeliveryThreshold: 600,
    deliveryFee: 30,
    handlingFee: 6,
  },
  "Amazon Fresh": {
    freeDeliveryThreshold: 600,
    deliveryFee: 29,
    handlingFee: 0,
  },
  "KPN Fresh": {
    freeDeliveryThreshold: 299,
    deliveryFee: 30,
    handlingFee: 7,
  },
};

function calculatePlatformCosts(platform, itemSubtotal) {
  const fees = PLATFORM_FEES[platform];
  if (!fees) {
    return { subtotal: itemSubtotal, deliveryFee: 0, handlingFee: 0, total: itemSubtotal };
  }

  const deliveryFee =
    itemSubtotal === 0
      ? 0
      : itemSubtotal >= fees.freeDeliveryThreshold
        ? 0
        : fees.deliveryFee;

  const handlingFee = itemSubtotal === 0 ? 0 : fees.handlingFee;

  return {
    subtotal: itemSubtotal,
    deliveryFee,
    handlingFee,
    total: itemSubtotal + deliveryFee + handlingFee,
  };
}

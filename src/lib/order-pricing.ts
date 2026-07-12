import { crusts, extras, pizzaFlavors } from "@/lib/menu-data";
import type { OrderPizza } from "@/types/modo-pizzas";

export function getFlavor(id: string) {
  const flavor = pizzaFlavors.find((item) => item.id === id);
  if (!flavor) {
    throw new Error(`Flavor not found: ${id}`);
  }
  return flavor;
}

export function calculatePizzaUnitPrice(pizza: OrderPizza) {
  const flavorA = getFlavor(pizza.flavorAId);
  const flavorB = pizza.flavorBId ? getFlavor(pizza.flavorBId) : undefined;
  const flavorAPrice = flavorA.prices[pizza.sizeId] ?? 0;
  const flavorBPrice = flavorB ? flavorB.prices[pizza.sizeId] ?? 0 : 0;
  const basePrice = Math.max(flavorAPrice, flavorBPrice);
  const crustPrice = crusts.find((item) => item.id === pizza.crustId)?.price ?? 0;
  const extrasPrice = pizza.extraIds.reduce((total, extraId) => {
    return total + (extras.find((item) => item.id === extraId)?.price ?? 0);
  }, 0);

  return basePrice + crustPrice + extrasPrice;
}

export function calculatePizzaLineTotal(pizza: OrderPizza) {
  return calculatePizzaUnitPrice(pizza) * pizza.quantity;
}

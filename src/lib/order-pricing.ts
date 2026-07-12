import { crusts, extras, pizzaFlavors } from "@/lib/menu-data";
import type { OrderPizza, PizzaExtra, PizzaFlavor } from "@/types/modo-pizzas";

export function getFlavor(id: string, flavors: PizzaFlavor[] = pizzaFlavors) {
  const flavor = flavors.find((item) => item.id === id);
  if (!flavor) {
    throw new Error(`Flavor not found: ${id}`);
  }
  return flavor;
}

export function calculatePizzaUnitPrice(
  pizza: OrderPizza,
  options: {
    flavors?: PizzaFlavor[];
    crustOptions?: PizzaExtra[];
    extraOptions?: PizzaExtra[];
  } = {}
) {
  const flavorA = getFlavor(pizza.flavorAId, options.flavors);
  const flavorB = pizza.flavorBId ? getFlavor(pizza.flavorBId, options.flavors) : undefined;
  const flavorAPrice = flavorA.prices[pizza.sizeId] ?? 0;
  const flavorBPrice = flavorB ? flavorB.prices[pizza.sizeId] ?? 0 : 0;
  const basePrice = Math.max(flavorAPrice, flavorBPrice);
  const crustPrice = (options.crustOptions ?? crusts).find((item) => item.id === pizza.crustId)?.price ?? 0;
  const extrasPrice = pizza.extraIds.reduce((total, extraId) => {
    return total + ((options.extraOptions ?? extras).find((item) => item.id === extraId)?.price ?? 0);
  }, 0);

  return basePrice + crustPrice + extrasPrice;
}

export function calculatePizzaLineTotal(
  pizza: OrderPizza,
  options: {
    flavors?: PizzaFlavor[];
    crustOptions?: PizzaExtra[];
    extraOptions?: PizzaExtra[];
  } = {}
) {
  return calculatePizzaUnitPrice(pizza, options) * pizza.quantity;
}

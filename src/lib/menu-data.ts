import type { Combo, PizzaExtra, PizzaFlavor, PizzaSize, PublicCatalog, SiteSettings } from "@/types/modo-pizzas";

export const siteSettings: SiteSettings = {
  businessName: "ModoPizzas",
  whatsappNumber: "573001234567",
  whatsappEnabled: true,
  whatsappButtonText: "Finalizar por WhatsApp"
};

export const pizzaSizes: PizzaSize[] = [
  { id: "porcion", name: "Porcion", description: "Una porcion rapida para antojos.", order: 1 },
  { id: "personal", name: "Personal", description: "Ideal para una persona.", order: 2 },
  { id: "mediana", name: "Mediana", description: "Perfecta para compartir.", order: 3 },
  { id: "grande", name: "Grande", description: "La opcion familiar inicial.", order: 4 }
];

export const pizzaFlavors: PizzaFlavor[] = [
  {
    id: "hawaiana",
    name: "Hawaiana",
    description: "Jamon, pina y queso mozzarella.",
    allergens: ["lacteos", "gluten"],
    featured: true,
    prices: { porcion: 6500, personal: 18000, mediana: 29000, grande: 39000 }
  },
  {
    id: "carnes",
    name: "Carnes",
    description: "Pepperoni, jamon, salami y carne molida.",
    allergens: ["lacteos", "gluten"],
    featured: true,
    prices: { porcion: 7500, personal: 21000, mediana: 34000, grande: 46000 }
  },
  {
    id: "pollo-champinon",
    name: "Pollo Champinon",
    description: "Pollo desmechado, champinones y salsa de la casa.",
    allergens: ["lacteos", "gluten"],
    prices: { porcion: 7200, personal: 20500, mediana: 33000, grande: 44000 }
  },
  {
    id: "vegetariana",
    name: "Vegetariana",
    description: "Pimenton, cebolla, tomate, champinones y aceitunas.",
    allergens: ["lacteos", "gluten"],
    prices: { porcion: 6200, personal: 17500, mediana: 28000, grande: 38000 }
  }
];

export const crusts: PizzaExtra[] = [
  { id: "normal", name: "Borde normal", price: 0 },
  { id: "queso", name: "Borde de queso", price: 6000 },
  { id: "bocadillo", name: "Borde bocadillo", price: 5000 }
];

export const extras: PizzaExtra[] = [
  { id: "extra-queso", name: "Extra queso", price: 4500 },
  { id: "maiz", name: "Maiz", price: 2500 },
  { id: "tocineta", name: "Tocineta", price: 5500 },
  { id: "jalapenos", name: "Jalapenos", price: 2500 }
];

export const combos: Combo[] = [
  {
    id: "combo-familiar",
    name: "Combo Familiar",
    description: "Pizza grande, gaseosa 1.5 L y pan de ajo.",
    price: 59900,
    items: ["Pizza grande a eleccion", "Gaseosa 1.5 L", "Pan de ajo"]
  },
  {
    id: "combo-doble",
    name: "Doble Personal",
    description: "Dos pizzas personales con borde normal.",
    price: 34900,
    items: ["2 pizzas personales", "Borde normal"]
  }
];

export const fallbackCatalog: PublicCatalog = {
  siteSettings,
  pizzaSizes,
  pizzaFlavors,
  crusts,
  extras,
  combos
};

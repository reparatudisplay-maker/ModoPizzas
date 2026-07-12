import { fallbackCatalog } from "@/lib/menu-data";
import { formatCop } from "@/lib/format";
import { calculatePizzaLineTotal } from "@/lib/order-pricing";
import type { CustomerDraft, OrderKind, OrderPizza, PublicCatalog } from "@/types/modo-pizzas";

function labelForOrderKind(kind: OrderKind) {
  if (kind === "delivery") return "Domicilio";
  if (kind === "pickup") return "Recoger en pizzeria";
  return "Local";
}

export function buildWhatsappUrl(params: {
  pizzas: OrderPizza[];
  customer: CustomerDraft;
  orderKind: OrderKind;
  catalog?: PublicCatalog;
}) {
  const { pizzas, customer, orderKind, catalog = fallbackCatalog } = params;
  const { crusts, extras, pizzaFlavors, pizzaSizes, siteSettings } = catalog;
  const lines = [
    `Hola, quiero confirmar este pedido en ${siteSettings.businessName}:`,
    "",
    `Entrega: ${labelForOrderKind(orderKind)}`
  ];

  if (customer.name) lines.push(`Nombre: ${customer.name}`);
  if (customer.phone) lines.push(`Telefono: ${customer.phone}`);
  if (orderKind === "delivery") {
    lines.push(`Direccion: ${customer.address}`);
    if (customer.neighborhood) lines.push(`Barrio: ${customer.neighborhood}`);
    if (customer.deliveryNotes) lines.push(`Notas de entrega: ${customer.deliveryNotes}`);
  }

  lines.push("", "Pedido:");

  pizzas.forEach((pizza, index) => {
    const size = pizzaSizes.find((item) => item.id === pizza.sizeId)?.name;
    const flavorA = pizzaFlavors.find((item) => item.id === pizza.flavorAId)?.name;
    const flavorB = pizza.flavorBId
      ? pizzaFlavors.find((item) => item.id === pizza.flavorBId)?.name
      : undefined;
    const crust = crusts.find((item) => item.id === pizza.crustId)?.name;
    const selectedExtras = pizza.extraIds
      .map((extraId) => extras.find((item) => item.id === extraId)?.name)
      .filter(Boolean)
      .join(", ");

    lines.push(
      `${index + 1}. ${pizza.quantity} x Pizza ${size} ${flavorB ? "mitad y mitad" : flavorA}`,
      flavorB ? `   Sabores: ${flavorA} / ${flavorB}` : "",
      crust ? `   Borde: ${crust}` : "",
      selectedExtras ? `   Adiciones: ${selectedExtras}` : "",
      pizza.notes ? `   Notas: ${pizza.notes}` : "",
      `   Subtotal: ${formatCop(
        calculatePizzaLineTotal(pizza, {
          flavors: pizzaFlavors,
          crustOptions: crusts,
          extraOptions: extras
        })
      )}`
    );
  });

  const total = pizzas.reduce(
    (sum, pizza) =>
      sum +
      calculatePizzaLineTotal(pizza, {
        flavors: pizzaFlavors,
        crustOptions: crusts,
        extraOptions: extras
      }),
    0
  );
  lines.push("", `Total: ${formatCop(total)}`);

  const message = encodeURIComponent(lines.filter(Boolean).join("\n"));
  return `https://wa.me/${siteSettings.whatsappNumber}?text=${message}`;
}

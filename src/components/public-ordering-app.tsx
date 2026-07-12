"use client";

import { MessageCircle, Minus, Plus, ReceiptText, ShoppingCart } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { createStaffOrder, createWebOrder } from "@/app/orders/actions";
import { fallbackCatalog } from "@/lib/menu-data";
import { formatCop } from "@/lib/format";
import { calculatePizzaLineTotal, calculatePizzaUnitPrice } from "@/lib/order-pricing";
import { buildWhatsappUrl } from "@/lib/whatsapp";
import type { CustomerDraft, OrderKind, OrderPizza, PublicCatalog } from "@/types/modo-pizzas";

const initialCustomer: CustomerDraft = {
  name: "",
  phone: "",
  address: "",
  neighborhood: "",
  deliveryNotes: ""
};

function createPizzaDraft(catalog: PublicCatalog): OrderPizza {
  return {
    id: crypto.randomUUID(),
    sizeId: catalog.pizzaSizes.find((size) => size.id === "mediana")?.id ?? catalog.pizzaSizes[0]?.id ?? "mediana",
    flavorAId: catalog.pizzaFlavors.find((flavor) => flavor.id === "hawaiana")?.id ?? catalog.pizzaFlavors[0]?.id ?? "hawaiana",
    flavorBId: "",
    crustId: catalog.crusts.find((crust) => crust.id === "normal")?.id ?? catalog.crusts[0]?.id ?? "normal",
    extraIds: [],
    quantity: 1,
    notes: ""
  };
}

type PublicOrderingAppProps = {
  catalog?: PublicCatalog;
  mode?: "public" | "staff";
};

export function PublicOrderingApp({ catalog = fallbackCatalog, mode = "public" }: PublicOrderingAppProps) {
  const { siteSettings, pizzaSizes, pizzaFlavors, crusts, extras, combos } = catalog;
  const priceOptions = useMemo(
    () => ({
      flavors: pizzaFlavors,
      crustOptions: crusts,
      extraOptions: extras
    }),
    [crusts, extras, pizzaFlavors]
  );
  const [draft, setDraft] = useState<OrderPizza>(() => createPizzaDraft(catalog));
  const [pizzas, setPizzas] = useState<OrderPizza[]>([]);
  const [orderKind, setOrderKind] = useState<OrderKind>("delivery");
  const [customer, setCustomer] = useState<CustomerDraft>(initialCustomer);
  const [warning, setWarning] = useState("");
  const [isPending, startTransition] = useTransition();
  const isStaffMode = mode === "staff";

  const draftUnitPrice = useMemo(() => calculatePizzaUnitPrice(draft, priceOptions), [draft, priceOptions]);
  const cartTotal = useMemo(
    () => pizzas.reduce((sum, pizza) => sum + calculatePizzaLineTotal(pizza, priceOptions), 0),
    [pizzas, priceOptions]
  );

  const canSend =
    pizzas.length > 0 &&
    (orderKind !== "delivery" || Boolean(customer.name && customer.phone && customer.address));

  function updateDraft(field: keyof OrderPizza, value: string | string[] | number) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function addPizza() {
    const samePizza = pizzas.find((pizza) => {
      return (
        pizza.sizeId === draft.sizeId &&
        pizza.flavorAId === draft.flavorAId &&
        pizza.flavorBId === draft.flavorBId &&
        pizza.crustId === draft.crustId &&
        pizza.extraIds.join(",") === draft.extraIds.join(",") &&
        pizza.notes?.trim() === draft.notes?.trim()
      );
    });

    if (samePizza) {
      setWarning("Esta pizza ya esta en el pedido. Aumenta la cantidad si deseas repetirla.");
      return;
    }

    setPizzas((current) => [...current, draft]);
    setDraft(createPizzaDraft(catalog));
    setWarning("");
  }

  function changeQuantity(id: string, delta: number) {
    setPizzas((current) =>
      current
        .map((pizza) => {
          if (pizza.id !== id) return pizza;
          return { ...pizza, quantity: Math.max(1, pizza.quantity + delta) };
        })
        .filter((pizza) => pizza.quantity > 0)
    );
  }

  function finishOrder() {
    if (!canSend) {
      setWarning("Para domicilio necesitamos nombre, telefono y direccion. Para recoger o local son opcionales.");
      return;
    }

    const recentSignature = JSON.stringify({ pizzas, customer, orderKind });
    const lastSignature = window.localStorage.getItem("modo-pizzas-last-order");
    const lastTime = Number(window.localStorage.getItem("modo-pizzas-last-order-time") ?? 0);
    const isRepeated = lastSignature === recentSignature && Date.now() - lastTime < 120000;

    if (!isStaffMode && isRepeated) {
      setWarning("Parece que este pedido ya fue enviado hace poco. Espera un momento antes de repetirlo.");
      return;
    }

    startTransition(async () => {
      try {
        if (isStaffMode) {
          const result = await createStaffOrder({
            pizzas,
            customer,
            orderKind,
            catalog
          });

          setPizzas([]);
          setCustomer(initialCustomer);
          setWarning(`Pedido interno creado. ID: ${result.id}`);
          return;
        }

        await createWebOrder({ pizzas, customer, orderKind, catalog });

        window.localStorage.setItem("modo-pizzas-last-order", recentSignature);
        window.localStorage.setItem("modo-pizzas-last-order-time", String(Date.now()));
        setWarning("Pedido web guardado. Te llevamos a WhatsApp para confirmar.");
        window.open(buildWhatsappUrl({ pizzas, customer, orderKind, catalog }), "_blank", "noopener,noreferrer");
      } catch (error) {
        setWarning(error instanceof Error ? error.message : "No pudimos guardar el pedido. Intenta de nuevo.");
      }
    });
  }

  return (
    <section className="app-shell" id="pedido">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">MP</div>
          <div>
            <strong>{siteSettings.businessName}</strong>
            <span>Pedidos web y operacion interna</span>
          </div>
        </div>
        <nav className="nav-links" aria-label="Navegacion principal">
          <a href="#menu">Menu</a>
          <a href="#promos">Promos</a>
          <a href="#operacion">Operacion</a>
          <a href="#legal">Legal</a>
          <a href="/login">Entrar</a>
          <a href="/panel">Panel</a>
        </nav>
      </header>

      <div className="workspace">
        <div>
          <section id="menu">
            <h1 className="section-title">Arma tu pedido</h1>
            <p className="section-copy">
              {isStaffMode
                ? "Crea pedidos de caja, local, recoger o domicilio usando el mismo calculo de precios del menu publico."
                : "Elige tamano, sabor, mitad y mitad, borde y adiciones. Si la pizza es mitad y mitad, el sistema cobra el sabor de mayor precio."}
            </p>

            <div className="menu-grid">
              {pizzaFlavors.map((flavor) => (
                <article className="menu-card" key={flavor.id}>
                  <header>
                    <h3>{flavor.name}</h3>
                    {flavor.featured ? <span className="badge">Popular</span> : null}
                  </header>
                  <p>{flavor.description}</p>
                  <ul className="price-list">
                    {pizzaSizes.map((size) => (
                      <li key={size.id}>
                        <span>{size.name}</span>
                        <strong>{formatCop(flavor.prices[size.id])}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="builder" aria-label="Constructor de pizza">
            <div className="form-panel">
              <h2 className="section-title">Nueva pizza</h2>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="size">Tamano</label>
                  <select id="size" value={draft.sizeId} onChange={(event) => updateDraft("sizeId", event.target.value)}>
                    {pizzaSizes.map((size) => (
                      <option key={size.id} value={size.id}>
                        {size.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="quantity">Cantidad</label>
                  <input
                    id="quantity"
                    min="1"
                    type="number"
                    value={draft.quantity}
                    onChange={(event) => updateDraft("quantity", Number(event.target.value))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="flavor-a">Sabor principal</label>
                  <select
                    id="flavor-a"
                    value={draft.flavorAId}
                    onChange={(event) => updateDraft("flavorAId", event.target.value)}
                  >
                    {pizzaFlavors.map((flavor) => (
                      <option key={flavor.id} value={flavor.id}>
                        {flavor.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="flavor-b">Mitad y mitad</label>
                  <select
                    id="flavor-b"
                    value={draft.flavorBId}
                    onChange={(event) => updateDraft("flavorBId", event.target.value)}
                  >
                    <option value="">No aplica</option>
                    {pizzaFlavors.map((flavor) => (
                      <option key={flavor.id} value={flavor.id}>
                        {flavor.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="crust">Borde</label>
                  <select id="crust" value={draft.crustId} onChange={(event) => updateDraft("crustId", event.target.value)}>
                    {crusts.map((crust) => (
                      <option key={crust.id} value={crust.id}>
                        {crust.name} {crust.price ? `+ ${formatCop(crust.price)}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Adiciones</label>
                  <div className="check-grid">
                    {extras.map((extra) => (
                      <label className="check-option" key={extra.id}>
                        <input
                          checked={draft.extraIds.includes(extra.id)}
                          type="checkbox"
                          onChange={(event) => {
                            const nextExtras = event.target.checked
                              ? [...draft.extraIds, extra.id]
                              : draft.extraIds.filter((extraId) => extraId !== extra.id);
                            updateDraft("extraIds", nextExtras);
                          }}
                        />
                        <span>{extra.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="field full">
                  <label htmlFor="notes">Notas</label>
                  <textarea
                    id="notes"
                    placeholder="Ej: sin cebolla, bien tostada, cortar en 8"
                    value={draft.notes}
                    onChange={(event) => updateDraft("notes", event.target.value)}
                  />
                </div>
              </div>

              <p className="muted">Precio unitario actual: {formatCop(draftUnitPrice)}</p>
              <button className="primary-button" type="button" onClick={addPizza}>
                <Plus size={18} /> Agregar pizza
              </button>
            </div>

            <section id="promos">
              <h2 className="section-title">Promociones</h2>
              <div className="combo-grid">
                {combos.map((combo) => (
                  <article className="combo-card" key={combo.id}>
                    <header>
                      <h3>{combo.name}</h3>
                      <strong>{formatCop(combo.price)}</strong>
                    </header>
                    <p>{combo.description}</p>
                    <ul>
                      {combo.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>

        <aside className="cart-panel" aria-label="Resumen del pedido">
          <h2 className="section-title">
            <ShoppingCart size={24} /> Pedido
          </h2>

          {warning ? <p className="alert">{warning}</p> : null}

          {pizzas.length === 0 ? (
            <p className="muted">
              {isStaffMode ? "Agrega una pizza para crear el pedido interno." : "Agrega una pizza para generar el resumen de WhatsApp."}
            </p>
          ) : (
            pizzas.map((pizza) => {
              const flavorA = pizzaFlavors.find((flavor) => flavor.id === pizza.flavorAId)?.name;
              const flavorB = pizza.flavorBId
                ? pizzaFlavors.find((flavor) => flavor.id === pizza.flavorBId)?.name
                : "";
              const size = pizzaSizes.find((item) => item.id === pizza.sizeId)?.name;
              return (
                <div className="cart-line" key={pizza.id}>
                  <header>
                    <strong>{size}</strong>
                    <span>{formatCop(calculatePizzaLineTotal(pizza, priceOptions))}</span>
                  </header>
                  <small>{flavorB ? `${flavorA} / ${flavorB}` : flavorA}</small>
                  <div>
                    <button className="icon-button" title="Restar" type="button" onClick={() => changeQuantity(pizza.id, -1)}>
                      <Minus size={16} />
                    </button>
                    <span aria-label="Cantidad"> {pizza.quantity} </span>
                    <button className="icon-button" title="Sumar" type="button" onClick={() => changeQuantity(pizza.id, 1)}>
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <div className="cart-form">
            <div className="field">
              <label htmlFor="order-kind">Tipo de pedido</label>
              <select id="order-kind" value={orderKind} onChange={(event) => setOrderKind(event.target.value as OrderKind)}>
                <option value="delivery">Domicilio</option>
                <option value="pickup">Recoger</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="customer-name">Nombre {orderKind === "delivery" ? "*" : ""}</label>
              <input
                id="customer-name"
                value={customer.name}
                onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="customer-phone">Telefono {orderKind === "delivery" ? "*" : ""}</label>
              <input
                id="customer-phone"
                value={customer.phone}
                onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
            {orderKind === "delivery" ? (
              <>
                <div className="field">
                  <label htmlFor="customer-address">Direccion *</label>
                  <input
                    id="customer-address"
                    value={customer.address}
                    onChange={(event) => setCustomer((current) => ({ ...current, address: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="customer-neighborhood">Barrio</label>
                  <input
                    id="customer-neighborhood"
                    value={customer.neighborhood}
                    onChange={(event) => setCustomer((current) => ({ ...current, neighborhood: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="delivery-notes">Notas de envio</label>
                  <textarea
                    id="delivery-notes"
                    value={customer.deliveryNotes}
                    onChange={(event) => setCustomer((current) => ({ ...current, deliveryNotes: event.target.value }))}
                  />
                </div>
              </>
            ) : null}
          </div>

          <div className="cart-total">
            <span>Total</span>
            <strong>{formatCop(cartTotal)}</strong>
          </div>

          <button
            className="primary-button"
            disabled={(!isStaffMode && !siteSettings.whatsappEnabled) || isPending}
            type="button"
            onClick={finishOrder}
          >
            {isStaffMode ? <ReceiptText size={18} /> : <MessageCircle size={18} />}
            {isPending ? "Guardando pedido..." : isStaffMode ? "Crear pedido interno" : siteSettings.whatsappButtonText}
          </button>
          {isStaffMode ? null : (
            <button className="ghost-button" type="button">
              <ReceiptText size={18} /> Vista recibo/comanda
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

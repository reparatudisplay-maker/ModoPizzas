"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronLeft, Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { createPosOrder, type PosOrderActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

type OrderKind = "local" | "pickup" | "delivery";
type PaymentMethod = "cash" | "card" | "transfer" | "mixed" | "pending";
type CatalogTab = "pizzas" | "products";
type PizzaStep = "size" | "type" | "half" | "additions" | "quantity" | "summary";
type PizzaMode = "whole" | "half";

export type PosPizzaSizePrice = {
  id: string | null;
  sku: string | null;
  size_id: string;
  size_name: string;
  diameter_cm: number | null;
  slices_count: number | null;
  sort_order: number;
  is_active: boolean;
  price_cop: number | null;
  components_count: number;
};

export type PosPizzaOption = {
  flavor_id: string;
  flavor_name: string;
  category_id: string | null;
  category_name: string | null;
  image_src: string | null;
  allows_half_and_half: boolean;
  min_price_cop: number | null;
  prices: PosPizzaSizePrice[];
};

export type PosAdditionOption = {
  id: string;
  sku: string;
  name: string;
  image_src: string | null;
  size_id: string;
  flavor_ids: string[];
  category_ids: string[];
  max_allowed: number;
  price_cop: number;
};

export type PosSaleProductOption = {
  id: string;
  sku: string | null;
  name: string;
  image_src: string | null;
  presentation: string | null;
  stock_base: number;
  unit: StockUnit;
};

type CartAddition = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price_cop: number;
};

type CartLine = {
  key: string;
  kind: "pizza" | "sale_product";
  id: string;
  secondary_id?: string | null;
  name: string;
  sku: string | null;
  image_src: string | null;
  quantity: number;
  unit_price_cop: number;
  additions: CartAddition[];
  notes?: string;
};

type PizzaWizard = {
  flavor: PosPizzaOption;
  step: PizzaStep;
  selectedSize: PosPizzaSizePrice | null;
  mode: PizzaMode;
  secondFlavor: PosPizzaOption | null;
  quantity: number;
  removeNotes: string;
};

const initialState: PosOrderActionState = { status: "idle", message: "" };

function productKey(line: Omit<CartLine, "key" | "quantity">) {
  if (line.kind === "sale_product") return `product:${line.id}:${line.unit_price_cop}`;
  const additionsKey = line.additions.map((addition) => `${addition.id}:${addition.quantity}`).sort().join("|");
  return `pizza:${line.id}:${line.secondary_id ?? "whole"}:${line.notes ?? ""}:${additionsKey}`;
}

function orderKindLabel(kind: OrderKind) {
  if (kind === "local") return "Consumo en local";
  if (kind === "pickup") return "Recoger";
  return "Domicilio";
}

function paymentLabel(method: PaymentMethod) {
  if (method === "cash") return "Efectivo";
  if (method === "card") return "Tarjeta";
  if (method === "transfer") return "Transferencia";
  if (method === "mixed") return "Mixto";
  return "Pendiente";
}

export function PosOrderWorkspace({
  pizzas,
  additions,
  saleProducts
}: {
  pizzas: PosPizzaOption[];
  additions: PosAdditionOption[];
  saleProducts: PosSaleProductOption[];
}) {
  const [state, action] = useActionState(createPosOrder, initialState);
  const [tab, setTab] = useState<CatalogTab>("pizzas");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [cardScale, setCardScale] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderKind, setOrderKind] = useState<OrderKind>("local");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [discount, setDiscount] = useState("");
  const [delivery, setDelivery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [wizard, setWizard] = useState<PizzaWizard | null>(null);
  const [selectedAdditions, setSelectedAdditions] = useState<Record<string, number>>({});
  const normalizedQuery = normalizeMasterText(query);

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(() => {
        setCart([]);
        setDiscount("");
        setDelivery("");
        setCustomerName("");
        setCustomerPhone("");
        setNotes("");
        setOrderKind("local");
        setPaymentMethod("cash");
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [state.status]);

  const categories = useMemo(() => {
    const unique = new Map<string, string>();
    for (const pizza of pizzas) {
      if (pizza.category_id && pizza.category_name) unique.set(pizza.category_id, pizza.category_name);
    }
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pizzas]);

  const pizzaSuggestions = useMemo(() => pizzas.map((pizza) => pizza.flavor_name), [pizzas]);
  const productSuggestions = useMemo(() => saleProducts.map((product) => `${product.name} ${product.presentation ?? ""}`.trim()), [saleProducts]);

  const filteredPizzas = useMemo(
    () =>
      pizzas.filter((pizza) => {
        const text = `${pizza.flavor_name} ${pizza.category_name ?? ""} ${pizza.prices.map((price) => price.size_name).join(" ")}`;
        const matchesSearch = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
        const matchesCategory = categoryFilter === "all" || pizza.category_id === categoryFilter;
        return matchesSearch && matchesCategory;
      }),
    [categoryFilter, normalizedQuery, pizzas]
  );

  const filteredProducts = useMemo(
    () =>
      saleProducts.filter((product) => {
        const text = `${product.sku ?? ""} ${product.name} ${product.presentation ?? ""}`;
        return !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
      }),
    [normalizedQuery, saleProducts]
  );

  const subtotal = cart.reduce((sum, line) => {
    const additionsSubtotal = line.additions.reduce((additionSum, addition) => additionSum + addition.quantity * addition.unit_price_cop, 0);
    return sum + line.quantity * (line.unit_price_cop + additionsSubtotal);
  }, 0);
  const discountValue = Number(discount || 0);
  const deliveryValue = Number(delivery || 0);
  const total = Math.max(0, subtotal - discountValue + deliveryValue);

  const selectedPizzaPrice = wizard?.selectedSize ?? null;
  const halfAvailable = Boolean(wizard && selectedPizzaPrice && wizard.flavor.allows_half_and_half);
  const secondSizePrice = wizard?.secondFlavor && selectedPizzaPrice ? priceForSize(wizard.secondFlavor, selectedPizzaPrice.size_id) : null;
  const activePrice = wizard ? selectedOrderPrice(wizard, selectedPizzaPrice, secondSizePrice) : null;
  const compatibleAdditions = useMemo(() => {
    if (!wizard?.selectedSize) return [];
    const flavors = [wizard.flavor, wizard.mode === "half" ? wizard.secondFlavor : null].filter(Boolean) as PosPizzaOption[];
    return additions
      .filter((addition) => addition.size_id === wizard.selectedSize?.size_id)
      .filter((addition) => additionCompatible(addition, flavors));
  }, [additions, wizard]);
  const selectedAdditionsList = selectedAdditionItems(selectedAdditions, compatibleAdditions);
  const additionsSubtotal = selectedAdditionsList.reduce((sum, addition) => sum + addition.quantity * addition.unit_price_cop, 0);
  const wizardUnitPrice = (activePrice?.price_cop ?? 0) + additionsSubtotal;

  function addLine(line: Omit<CartLine, "key" | "quantity">, quantity = 1) {
    const key = productKey(line);
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) return current.map((item) => (item.key === key ? { ...item, quantity: item.quantity + quantity } : item));
      return [...current, { ...line, key, quantity }];
    });
  }

  function openPizzaWizard(flavor: PosPizzaOption) {
    setSelectedAdditions({});
    setWizard({ flavor, step: "size", selectedSize: null, mode: "whole", secondFlavor: null, quantity: 1, removeNotes: "" });
  }

  function selectPizzaSize(size: PosPizzaSizePrice) {
    if (!wizard) return;
    if (!size.is_active || !size.id || size.price_cop === null) return;
    const nextWizard = { ...wizard, selectedSize: size, step: "type" as PizzaStep, mode: "whole" as PizzaMode, secondFlavor: null };
    const additionsForSize = additions
      .filter((addition) => addition.size_id === size.size_id)
      .filter((addition) => additionCompatible(addition, [wizard.flavor]));
    if (!wizard.flavor.allows_half_and_half) {
      nextWizard.step = additionsForSize.length > 0 ? "additions" : "quantity";
    }
    setWizard(nextWizard);
    setSelectedAdditions({});
  }

  function addConfiguredPizza(source = wizard, additionsToUse = selectedAdditionsList, quantity = wizard?.quantity ?? 1) {
    if (!source?.selectedSize) return;
    const firstPrice = source.selectedSize;
    const secondPrice = source.mode === "half" && source.secondFlavor ? priceForSize(source.secondFlavor, firstPrice.size_id) : null;
    const orderPrice = selectedOrderPrice(source, firstPrice, secondPrice);
    if (!orderPrice?.id || orderPrice.price_cop === null) return;
    const name =
      source.mode === "half" && source.secondFlavor
        ? `${source.flavor.flavor_name} / ${source.secondFlavor.flavor_name} ${firstPrice.size_name}`
        : `${source.flavor.flavor_name} ${firstPrice.size_name}`;

    addLine(
      {
        kind: "pizza",
        id: orderPrice.id,
        secondary_id: secondPrice?.id ?? null,
        name,
        sku: orderPrice.sku,
        image_src: source.flavor.image_src,
        unit_price_cop: orderPrice.price_cop,
        additions: additionsToUse,
        notes: source.removeNotes ? `RETIRAR: ${source.removeNotes}` : undefined
      },
      quantity
    );
    setWizard(null);
    setSelectedAdditions({});
  }

  function updateQuantity(key: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  function updateProductPrice(key: string, value: string) {
    const price = Number(value.replace(/\D/g, "") || 0);
    setCart((current) => current.map((line) => (line.key === key ? { ...line, unit_price_cop: price } : line)));
  }

  const payload = cart.map((line) => ({
    kind: line.kind,
    id: line.id,
    secondary_id: line.secondary_id ?? null,
    quantity: line.quantity,
    unit_price_cop: line.unit_price_cop,
    notes: line.notes ?? "",
    additions: line.additions.map((addition) => ({ id: addition.id, quantity: addition.quantity }))
  }));

  return (
    <>
      <form action={action} className="pos-layout">
        <input name="items" type="hidden" value={JSON.stringify(payload)} />
        <input name="kind" type="hidden" value={orderKind} />
        <input name="payment_method" type="hidden" value={paymentMethod} />
        <input name="customer_name" type="hidden" value={customerName} />
        <input name="customer_phone" type="hidden" value={customerPhone} />
        <input name="discount_cop" type="hidden" value={discount} />
        <input name="delivery_cop" type="hidden" value={delivery} />
        <input name="notes" type="hidden" value={notes} />

        <section className="pos-catalog-panel">
          <div className="pos-catalog-toolbar">
            <div className="pos-tabs">
              <button className={tab === "pizzas" ? "active" : ""} onClick={() => setTab("pizzas")} type="button">Pizzas</button>
              <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")} type="button">Productos</button>
            </div>
            <label className="pos-search">
              <Search size={18} />
              <input
                list={tab === "pizzas" ? "pos-pizza-suggestions" : "pos-product-suggestions"}
                onChange={(event) => setQuery(uppercaseMasterName(event.target.value))}
                placeholder="Buscar rapido"
                value={query}
              />
            </label>
            <datalist id="pos-pizza-suggestions">
              {pizzaSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
            </datalist>
            <datalist id="pos-product-suggestions">
              {productSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
            </datalist>
            {tab === "pizzas" ? (
              <select className="pos-category-filter" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                <option value="all">Todas las categorias</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            ) : null}
          </div>

          <div className={`pos-product-grid pos-card-scale-${cardScale}`}>
            {tab === "pizzas"
              ? filteredPizzas.map((pizza) => (
                  <button
                    className="pos-product-card pos-pizza-flavor-card"
                    disabled={pizza.prices.length === 0}
                    key={pizza.flavor_id}
                    onClick={() => openPizzaWizard(pizza)}
                    type="button"
                  >
                    <ProductImage alt={pizza.flavor_name} src={pizza.image_src} />
                    <span className="pos-product-title">{pizza.flavor_name}</span>
                    <span className="pos-product-meta">{pizza.category_name ?? "Sin categoria"}</span>
                    <strong>{pizza.min_price_cop === null ? "Sin precio configurado" : `Desde ${formatCop(pizza.min_price_cop)}`}</strong>
                  </button>
                ))
              : filteredProducts.map((product) => (
                  <button
                    className="pos-product-card"
                    key={product.id}
                    onClick={() =>
                      addLine({
                        kind: "sale_product",
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        image_src: product.image_src,
                        unit_price_cop: 0,
                        additions: []
                      })
                    }
                    type="button"
                  >
                    <ProductImage alt={product.name} src={product.image_src} />
                    <span className="pos-product-title">{product.name}</span>
                    <span className="pos-product-meta">{product.presentation ?? "Sin presentacion"}</span>
                    <small>Stock {formatStockQuantity(product.stock_base, product.unit)}</small>
                  </button>
                ))}
            {(tab === "pizzas" ? filteredPizzas.length : filteredProducts.length) === 0 ? <p className="empty-state">Sin resultados.</p> : null}
          </div>
          {tab === "pizzas" ? (
            <div className="pos-card-size-controls" aria-label="Tamano de tarjetas">
              <button disabled={cardScale === 0} onClick={() => setCardScale((value) => Math.max(0, value - 1))} type="button"><Minus size={18} /></button>
              <span>Tarjetas</span>
              <button disabled={cardScale === 2} onClick={() => setCardScale((value) => Math.min(2, value + 1))} type="button"><Plus size={18} /></button>
            </div>
          ) : null}
        </section>

        <aside className="pos-cart-panel">
          <div className="pos-cart-header">
            <ShoppingCart size={22} />
            <strong>Pedido</strong>
            <span>{cart.length} lineas</span>
          </div>

          <div className="pos-kind-grid">
            {(["local", "pickup", "delivery"] as OrderKind[]).map((kind) => (
              <button className={orderKind === kind ? "active" : ""} key={kind} onClick={() => setOrderKind(kind)} type="button">
                {orderKindLabel(kind)}
              </button>
            ))}
          </div>

          <div className="pos-cart-lines">
            {cart.map((line) => (
              <article className="pos-cart-line" key={line.key}>
                <div>
                  <strong>{line.name}</strong>
                  <small>{line.sku ?? "Sin SKU"}</small>
                  {line.notes ? <small>{line.notes}</small> : null}
                  {line.additions.map((addition) => (
                    <small key={addition.id}>+ {addition.name} x {addition.quantity}</small>
                  ))}
                  {line.kind === "sale_product" ? (
                    <input
                      aria-label={`Precio de ${line.name}`}
                      inputMode="numeric"
                      onChange={(event) => updateProductPrice(line.key, event.target.value)}
                      placeholder="Precio venta"
                      value={line.unit_price_cop ? String(line.unit_price_cop) : ""}
                    />
                  ) : (
                    <span>{formatCop(line.unit_price_cop)}</span>
                  )}
                </div>
                <div className="pos-qty-controls">
                  <button onClick={() => updateQuantity(line.key, -1)} title="Disminuir" type="button"><Minus size={16} /></button>
                  <strong>{line.quantity}</strong>
                  <button onClick={() => updateQuantity(line.key, 1)} title="Aumentar" type="button"><Plus size={16} /></button>
                  <button className="danger-button" onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))} title="Quitar" type="button"><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
            {cart.length === 0 ? <p className="empty-state">Toca una pizza o producto para empezar.</p> : null}
          </div>

          <div className="pos-client-grid">
            <input onChange={(event) => setCustomerName(uppercaseMasterName(event.target.value))} placeholder="Cliente opcional" value={customerName} />
            <input inputMode="tel" onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Telefono" value={customerPhone} />
            <input inputMode="numeric" onChange={(event) => setDiscount(event.target.value.replace(/\D/g, ""))} placeholder="Descuento" value={discount} />
            <input inputMode="numeric" onChange={(event) => setDelivery(event.target.value.replace(/\D/g, ""))} placeholder="Domicilio" value={delivery} />
          </div>
          <textarea onChange={(event) => setNotes(uppercaseMasterName(event.target.value))} placeholder="Observaciones" value={notes} />

          <div className="pos-payment-grid">
            {(["cash", "card", "transfer", "mixed", "pending"] as PaymentMethod[]).map((method) => (
              <button className={paymentMethod === method ? "active" : ""} key={method} onClick={() => setPaymentMethod(method)} type="button">
                {paymentLabel(method)}
              </button>
            ))}
          </div>

          <div className="pos-total-box">
            <span>Subtotal <strong>{formatCop(subtotal)}</strong></span>
            <span>Total <strong>{formatCop(total)}</strong></span>
          </div>
          {state.status !== "idle" ? (
            <p className={`form-status ${state.status}`}>
              {state.status === "success" && state.order ? `Pedido ${state.order.code} confirmado por ${formatCop(state.order.total_cop)}.` : state.message}
            </p>
          ) : null}
          <SubmitOrderButton disabled={cart.length === 0} />
        </aside>
      </form>

      {wizard ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configurar pizza" aria-modal="true" className="modal-panel pos-pizza-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>{wizard.flavor.flavor_name}</strong>
                <span>{wizard.flavor.category_name ?? "Sin categoria"}</span>
              </div>
              <button className="icon-button" onClick={() => setWizard(null)} title="Cerrar" type="button"><X size={18} /></button>
            </header>

            <div className="pos-wizard-body">
              <PizzaSummary wizard={wizard} unitPrice={wizardUnitPrice} additions={selectedAdditionsList} />

              {wizard.step === "size" ? (
                <WizardStep title="Tamano">
                  <div className="pos-option-grid">
                    {wizard.flavor.prices.map((price) => (
                      <button
                        className={wizard.selectedSize?.size_id === price.size_id ? "pos-size-card selected" : "pos-size-card"}
                        disabled={!price.is_active || !price.id || price.price_cop === null}
                        key={price.size_id}
                        onClick={() => selectPizzaSize(price)}
                        type="button"
                      >
                        <span className="pizza-size-illustration" style={{ "--pizza-size": `${pizzaCircleSize(price, wizard.flavor.prices)}px` } as CSSProperties}>
                          <span />
                        </span>
                        <strong>{price.size_name}</strong>
                        <span>{price.diameter_cm ? `${formatInteger(price.diameter_cm)} cm` : "Sin diametro"}</span>
                        <small>{price.slices_count ? `${formatInteger(price.slices_count)} porciones` : "Sin porciones"}</small>
                        <b>{price.price_cop === null ? "Sin precio" : formatCop(price.price_cop)}</b>
                      </button>
                    ))}
                  </div>
                </WizardStep>
              ) : null}

              {wizard.step === "type" && selectedPizzaPrice ? (
                <WizardStep onBack={() => setWizard({ ...wizard, step: "size" })} title="Tipo">
                  <div className="pos-option-grid">
                    <button
                      className={wizard.mode === "whole" ? "pos-type-card selected" : "pos-type-card"}
                      onClick={() => setWizard({ ...wizard, mode: "whole", secondFlavor: null, step: compatibleAdditions.length > 0 ? "additions" : "quantity" })}
                      type="button"
                    >
                      <span className="pizza-type-illustration whole" />
                      <strong>Pizza entera</strong>
                      <span>{formatCop(selectedPizzaPrice.price_cop ?? 0)}</span>
                    </button>
                    {halfAvailable ? (
                      <button className={wizard.mode === "half" ? "pos-type-card selected" : "pos-type-card"} onClick={() => setWizard({ ...wizard, mode: "half", step: "half" })} type="button">
                        <span className="pizza-type-illustration half" />
                        <strong>Mitad y mitad</strong>
                        <span>Precio del sabor mayor</span>
                      </button>
                    ) : null}
                  </div>
                </WizardStep>
              ) : null}

              {wizard.step === "half" && selectedPizzaPrice ? (
                <WizardStep onBack={() => setWizard({ ...wizard, step: "type" })} title="Segundo sabor">
                  <div className="pos-half-grid">
                    {pizzas
                      .filter((pizza) => pizza.flavor_id !== wizard.flavor.flavor_id)
                      .filter((pizza) => pizza.allows_half_and_half && Boolean(priceForSize(pizza, selectedPizzaPrice.size_id)))
                      .map((pizza) => {
                        const price = priceForSize(pizza, selectedPizzaPrice.size_id);
                        return (
                          <button
                            className={wizard.secondFlavor?.flavor_id === pizza.flavor_id ? "pos-product-card pos-second-flavor-card active" : "pos-product-card pos-second-flavor-card"}
                            key={pizza.flavor_id}
                            onClick={() => {
                              const nextAdditions = additions
                                .filter((addition) => addition.size_id === selectedPizzaPrice.size_id)
                                .filter((addition) => additionCompatible(addition, [wizard.flavor, pizza]));
                              setWizard({ ...wizard, secondFlavor: pizza, step: nextAdditions.length > 0 ? "additions" : "quantity" });
                            }}
                            type="button"
                          >
                            <ProductImage alt={pizza.flavor_name} src={pizza.image_src} />
                            <span className="pos-product-title">{pizza.flavor_name}</span>
                            <strong>{formatCop(Math.max(selectedPizzaPrice.price_cop ?? 0, price?.price_cop ?? 0))}</strong>
                          </button>
                        );
                      })}
                  </div>
                </WizardStep>
              ) : null}

              {wizard.step === "additions" ? (
                <WizardStep onBack={() => setWizard({ ...wizard, step: wizard.mode === "half" ? "half" : "type" })} title="Adiciones">
                  {compatibleAdditions.length > 0 ? (
                    <div className="pos-addition-grid">
                      {compatibleAdditions.map((addition) => {
                        const selected = selectedAdditions[addition.id] ?? 0;
                        return (
                          <article
                            className={selected > 0 ? "pos-addition-card active" : "pos-addition-card"}
                            key={addition.id}
                          >
                            <ProductImage alt={addition.name} src={addition.image_src} />
                            <span>{addition.name}</span>
                            <strong>{formatCop(addition.price_cop)}</strong>
                            <div className="pos-addition-controls">
                              <button
                                disabled={selected === 0}
                                onClick={() =>
                                  setSelectedAdditions((current) => ({
                                    ...current,
                                    [addition.id]: Math.max(0, selected - 1)
                                  }))
                                }
                                type="button"
                              >
                                <Minus size={16} />
                              </button>
                              <b>{selected}</b>
                              <button
                                disabled={selected >= addition.max_allowed}
                                onClick={() =>
                                  setSelectedAdditions((current) => ({
                                    ...current,
                                    [addition.id]: Math.min(addition.max_allowed, selected + 1)
                                  }))
                                }
                                type="button"
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                            <small>Max {addition.max_allowed}</small>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty-state">Sin adiciones compatibles.</p>
                  )}
                  <div className="pos-wizard-next-row">
                    <button className="ghost-button" onClick={() => setWizard({ ...wizard, step: "quantity" })} type="button">Continuar</button>
                  </div>
                </WizardStep>
              ) : null}

              {wizard.step === "quantity" ? (
                <WizardStep
                  onBack={() =>
                    setWizard({
                      ...wizard,
                      step: compatibleAdditions.length > 0 ? "additions" : wizard.mode === "half" ? "half" : "type"
                    })
                  }
                  title="Cantidad"
                >
                  <div className="pos-quantity-stage">
                    <div className="pos-modal-quantity">
                      <button onClick={() => setWizard({ ...wizard, quantity: Math.max(1, wizard.quantity - 1) })} type="button"><Minus /></button>
                      <strong>{wizard.quantity}</strong>
                      <button onClick={() => setWizard({ ...wizard, quantity: wizard.quantity + 1 })} type="button"><Plus /></button>
                    </div>
                    <label className="pos-remove-notes">
                      <span>Retirar ingredientes</span>
                      <input
                        onChange={(event) => setWizard({ ...wizard, removeNotes: uppercaseMasterName(event.target.value) })}
                        placeholder="Ej. SIN CEBOLLA"
                        value={wizard.removeNotes}
                      />
                    </label>
                    <button className="positive-button" onClick={() => setWizard({ ...wizard, step: "summary" })} type="button">Ver resumen</button>
                  </div>
                </WizardStep>
              ) : null}

              {wizard.step === "summary" ? (
                <WizardStep onBack={() => setWizard({ ...wizard, step: "quantity" })} title="Resumen final">
                  <FinalPizzaSummary additions={selectedAdditionsList} unitPrice={wizardUnitPrice} wizard={wizard} />
                </WizardStep>
              ) : null}
            </div>

            <div className="form-actions modal-form-actions pos-wizard-actions">
              <button className="ghost-button" onClick={() => setWizard(null)} type="button">Cancelar</button>
              {wizard.step === "summary" ? (
                <button className="positive-button" onClick={() => addConfiguredPizza()} type="button">Agregar al pedido</button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function WizardStep({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  return (
    <section className="pos-wizard-step">
      <div className="pos-wizard-step-header">
        {onBack ? <button className="icon-button" onClick={onBack} title="Volver" type="button"><ChevronLeft size={18} /></button> : null}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function PizzaSummary({ wizard, unitPrice, additions }: { wizard: PizzaWizard; unitPrice: number; additions: CartAddition[] }) {
  const selectedNames = [wizard.flavor.flavor_name, wizard.mode === "half" ? wizard.secondFlavor?.flavor_name : null].filter(Boolean).join(" / ");
  return (
    <aside className="pos-wizard-summary">
      <span>{wizard.selectedSize?.size_name ?? "Selecciona tamano"}</span>
      <strong>{selectedNames}</strong>
      {additions.length > 0 ? <small>{additions.map((addition) => `+ ${addition.name} x ${addition.quantity}`).join(", ")}</small> : null}
      <b>{formatCop(unitPrice)}</b>
    </aside>
  );
}

function FinalPizzaSummary({ wizard, unitPrice, additions }: { wizard: PizzaWizard; unitPrice: number; additions: CartAddition[] }) {
  const total = unitPrice * wizard.quantity;
  return (
    <section className="pos-final-summary">
      <div className="pos-final-hero">
        <ProductImage alt={wizard.flavor.flavor_name} src={wizard.flavor.image_src} />
        <div>
          <span>Sabor</span>
          <strong>{wizard.flavor.flavor_name}</strong>
          {wizard.mode === "half" && wizard.secondFlavor ? <small>Mitad con {wizard.secondFlavor.flavor_name}</small> : <small>Pizza entera</small>}
        </div>
      </div>
      <div className="pos-final-grid">
        <span><small>Tamano</small><strong>{wizard.selectedSize?.size_name ?? "Sin tamano"}</strong></span>
        <span><small>Tipo</small><strong>{wizard.mode === "half" ? "Mitad y mitad" : "Entera"}</strong></span>
        <span><small>Cantidad</small><strong>{wizard.quantity}</strong></span>
        <span><small>Precio unidad</small><strong>{formatCop(unitPrice)}</strong></span>
      </div>
      {additions.length > 0 ? (
        <div className="pos-final-list">
          <small>Adiciones</small>
          {additions.map((addition) => (
            <span key={addition.id}>+ {addition.name} x {addition.quantity}</span>
          ))}
        </div>
      ) : null}
      {wizard.removeNotes ? (
        <div className="pos-final-list">
          <small>Retirar</small>
          <span>{wizard.removeNotes}</span>
        </div>
      ) : null}
      <div className="pos-final-total">
        <span>Total pizza</span>
        <strong>{formatCop(total)}</strong>
      </div>
    </section>
  );
}

function selectedAdditionItems(selected: Record<string, number>, compatible: PosAdditionOption[]) {
  return Object.entries(selected)
    .map(([id, quantity]) => {
      const addition = compatible.find((item) => item.id === id);
      if (!addition || quantity <= 0) return null;
      return {
        id: addition.id,
        name: addition.name,
        sku: addition.sku,
        quantity,
        unit_price_cop: addition.price_cop
      };
    })
    .filter(Boolean) as CartAddition[];
}

function priceForSize(pizza: PosPizzaOption, sizeId: string) {
  const price = pizza.prices.find((item) => item.size_id === sizeId) ?? null;
  return price && price.is_active && price.id && price.price_cop !== null ? price : null;
}

function selectedOrderPrice(wizard: PizzaWizard, firstPrice: PosPizzaSizePrice | null, secondPrice: PosPizzaSizePrice | null) {
  if (!firstPrice?.id || firstPrice.price_cop === null) return null;
  if (wizard.mode !== "half" || !secondPrice) return firstPrice;
  return (secondPrice.price_cop ?? 0) > firstPrice.price_cop ? secondPrice : firstPrice;
}

function pizzaCircleSize(price: PosPizzaSizePrice, prices: PosPizzaSizePrice[]) {
  const diameters = prices.map((item) => item.diameter_cm).filter((value): value is number => typeof value === "number" && value > 0);
  if (!price.diameter_cm || diameters.length === 0) return 66;
  const min = Math.min(...diameters);
  const max = Math.max(...diameters);
  if (max === min) return 72;
  return 58 + ((price.diameter_cm - min) / (max - min)) * 34;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);
}

function additionCompatible(addition: PosAdditionOption, pizzas: PosPizzaOption[]) {
  const flavorAllowed =
    addition.flavor_ids.length === 0 || pizzas.every((pizza) => addition.flavor_ids.includes(pizza.flavor_id));
  const categoryAllowed =
    addition.category_ids.length === 0 ||
    pizzas.every((pizza) => (pizza.category_id ? addition.category_ids.includes(pizza.category_id) : false));
  return flavorAllowed && categoryAllowed;
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <Image alt={alt} className="pos-product-image" height={96} src={src} unoptimized width={96} />
  ) : (
    <span className="pos-product-placeholder">Sin foto</span>
  );
}

function SubmitOrderButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button pos-submit-button" disabled={disabled || pending} type="submit">
      {pending ? "Confirmando..." : "Confirmar pedido"}
    </button>
  );
}

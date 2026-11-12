"use client";

import Image from "next/image";
import { Fragment, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { BadgePercent, Banknote, Bike, CarFront, CheckCircle2, ChevronLeft, Clock, Edit3, HandCoins, Landmark, Minus, PackagePlus, PackageSearch, Pencil, Plus, ReceiptText, Repeat2, RotateCcw, Search, Settings, ShoppingBag, ShoppingCart, Star, Store, Truck, WalletCards, X, Zap } from "lucide-react";
import { createPosOrder, getPosInventoryConsumptionPreview, savePosPizzaImage, updatePosOrderPaymentMethod, type FormActionState, type PosInventoryConsumptionPreview, type PosOrderActionState, type PosStockShortage } from "@/app/admin/actions";
import { formatColombianNumber, formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, type StockUnit } from "@/lib/units";
import { CustomerReceiptPrintButton, PostPaymentPrintJob, type PaymentPrintJob, type PaymentPrintSelection } from "@/components/pos-order-payment-print";

type OrderKind = "local" | "pickup" | "delivery";
type PaymentMethod = "cash" | "card" | "transfer" | "mixed" | "pending" | "rappi" | "didi";
type OrderChannel = "direct" | "rappi" | "didi";
type DidiService = "didi_standard" | "didi_tu_negocio";
type CollectionParty = "business" | "platform";
type DiscountType = "percentage" | "amount";

type AppliedDiscount = {
  type: DiscountType;
  value: number;
  amount_cop: number;
};
type CatalogTab = "pizzas" | "products" | "combos";
type DirectFundsOrigin = "cash_session" | "external";
type PizzaStep = "size" | "type" | "half" | "summary";
type PizzaMode = "whole" | "half";
type AdditionScope = "whole" | "left" | "right";
type PickupMode = "pickup" | "takeaway";

type FlavorIngredientOption = {
  source_id: string;
  source_kind: "inventory_item" | "preparation";
  source_name: string;
};

type PizzaIngredientChoice = FlavorIngredientOption & {
  key: string;
  side: "first" | "second";
  flavor_name: string;
};

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
  characteristic_ingredients: FlavorIngredientOption[];
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
  sale_price_cop: number;
  stock_base: number;
  unit_cost_cop: number | null;
  unit: StockUnit;
};

export type PosPackagingRule = {
  id: string;
  target_kind: "pizza_size" | "sale_product";
  target_id: string;
  service_kind: "local" | "pickup" | "takeaway" | "delivery";
  packaging_inventory_item_id: string;
  packaging_name: string;
  quantity_base: number;
};

export type PosPizzaBaseOption = {
  pizza_size_id: string;
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  source_name: string;
  quantity_base: number;
  unit: StockUnit;
  is_default: boolean;
  available_quantity: number;
};

export type PosPlatformPaymentSetting = {
  platform: "rappi" | "didi";
  commission_percent: number;
  fixed_fee_cop: number;
  commission_tax_percent: number;
  didi_tu_negocio_commission_percent: number;
  didi_tu_negocio_fixed_fee_cop: number;
  didi_tu_negocio_commission_tax_percent: number;
};

export type PosOrderTableOption = {
  id: string;
  name: string;
};

export type PosPendingPayment = {
  id: string;
  code: string;
  ordered_at: string;
  customer_name: string | null;
  table_name: string | null;
  total_cop: number;
};

type PizzaBaseOverride = Pick<PosPizzaBaseOption, "source_kind" | "source_id">;

export type PosComboOption = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_src: string | null;
  sale_price_cop: number;
  normal_price_cop: number;
  variants: Array<{
    id: string;
    name: string;
    sale_price_cop: number;
    groups: Array<{
    id: string;
    name: string;
    group_kind: "pizza" | "sale_product";
    quantity_to_choose: number;
    is_required: boolean;
    pizza_size_id: string | null;
    sort_order: number;
    options: Array<{
      id: string;
      name: string;
      image_src: string | null;
      presentation: string | null;
      pizza_flavor_id: string | null;
      pizza_price_config_id: string | null;
      inventory_item_id: string | null;
      unit_price_cop: number;
    }>;
    }>;
  }>;
};

type ComboChoice = {
  variant_id?: string;
  applied_variant_id?: string;
  applied_variant_name?: string;
  group_id: string;
  option_id: string;
  kind: "pizza" | "sale_product";
  id: string;
  name: string;
  presentation?: string | null;
  unit_price_cop: number;
  pizza_slot_order?: number;
  is_half?: boolean;
  line_key?: string;
};

type ComboComponentDraft = {
  primary: ComboChoice;
  secondary: ComboChoice | null;
};

type CartAddition = {
  key: string;
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price_cop: number;
  scope: AdditionScope;
  scope_label?: string;
};

type CartLine = {
  key: string;
  signature: string;
  kind: "pizza" | "sale_product" | "combo" | "direct_sale";
  id: string;
  secondary_id?: string | null;
  name: string;
  sku: string | null;
  image_src: string | null;
  quantity: number;
  unit_price_cop: number;
  additions: CartAddition[];
  notes?: string;
  removed_components?: Array<{ source_kind: "inventory_item" | "preparation"; source_id: string }>;
  removed_ingredient_keys?: string[];
  base_override?: PizzaBaseOverride | null;
  combo_instance_id?: string | null;
  combo_config_id?: string | null;
  combo_variant_id?: string | null;
  combo_variant_name?: string | null;
  combo_name?: string | null;
  combo_sku?: string | null;
  combo_choices?: ComboChoice[];
  combo_normal_price_cop?: number;
  combo_savings_cop?: number;
  combo_price_adjustment_cop?: number;
  combo_unit_price_cop?: number;
  combo_component_normal_price_cop?: number;
  combo_component_label?: string;
  combo_is_primary?: boolean;
  direct_sale?: {
    inventory_item_id: string | null;
    acquisition_unit_cost_cop: number;
    funds_origin: DirectFundsOrigin;
    observation: string;
  };
};

type DirectSaleDraft = {
  inventory_item_id: string;
  name: string;
  quantity: string;
  sale_unit_price_cop: string;
  acquisition_unit_cost_cop: string;
  funds_origin: DirectFundsOrigin;
  observation: string;
};

type PizzaWizard = {
  flavor: PosPizzaOption;
  step: PizzaStep;
  selectedSize: PosPizzaSizePrice | null;
  mode: PizzaMode;
  secondFlavor: PosPizzaOption | null;
  quantity: number;
  removedIngredientKeys: string[];
  editingLineKey: string | null;
  editingBaseOverride: PizzaBaseOverride | null;
};

type ComboVariant = PosComboOption["variants"][number];
type ComboGroup = ComboVariant["groups"][number];

function comboOptionLabel(option: ComboGroup["options"][number] | ComboChoice) {
  return `${option.name}${option.presentation ? ` ${option.presentation}` : ""}`;
}

const initialState: PosOrderActionState = { status: "idle", message: "" };
const minCardScale = 0;
const maxCardScale = 2;
const pizzaCardScaleKey = "modo-pos-pizza-card-scale";
const productCardScaleKey = "modo-pos-product-card-scale";
const productViewSettingsKey = "modo-pos-product-view-settings";
const printSelectionKey = "modo-pos-payment-print-selection";
const cashDenominations = [2000, 5000, 10000, 20000, 50000, 100000];

type ProductViewSettings = {
  showCost: boolean;
  showStock: boolean;
  showSoldOut: boolean;
};

const defaultProductViewSettings: ProductViewSettings = { showCost: true, showStock: true, showSoldOut: true };
const defaultPrintSelection: PaymentPrintSelection = { kitchen: false, receipt: false };

function emptyDirectSaleDraft(): DirectSaleDraft {
  return { inventory_item_id: "", name: "", quantity: "1", sale_unit_price_cop: "", acquisition_unit_cost_cop: "", funds_origin: "cash_session", observation: "" };
}

function readPrintSelection(): PaymentPrintSelection {
  if (typeof window === "undefined") return defaultPrintSelection;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(printSelectionKey) ?? "");
    return {
      kitchen: parsed?.kitchen === true,
      receipt: parsed?.receipt === true
    };
  } catch {
    return defaultPrintSelection;
  }
}

function readProductViewSettings(): ProductViewSettings {
  const fallback = defaultProductViewSettings;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(productViewSettingsKey) ?? "");
    return {
      showCost: typeof parsed?.showCost === "boolean" ? parsed.showCost : fallback.showCost,
      showStock: typeof parsed?.showStock === "boolean" ? parsed.showStock : fallback.showStock,
      showSoldOut: typeof parsed?.showSoldOut === "boolean" ? parsed.showSoldOut : fallback.showSoldOut
    };
  } catch {
    return fallback;
  }
}

function initialCardScale(storageKey: string) {
  if (typeof window === "undefined") return 1;
  const parsed = Number(window.localStorage.getItem(storageKey));
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(maxCardScale, Math.max(minCardScale, Math.round(parsed)));
}

function todayBogota() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

type SaleDatePreference = {
  date: string;
  savedFor: string;
};

function readSaleDatePreference(storageKey: string, today: string) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "") as Partial<SaleDatePreference>;
    if (saved.savedFor === today && /^\d{4}-\d{2}-\d{2}$/.test(saved.date ?? "") && saved.date! <= today) return saved.date!;
  } catch {
    // Old plain-text preferences intentionally fall back to the current day.
  }
  return today;
}

function cashQuickSuggestions(total: number) {
  if (total <= 0) return [];
  const denominationValues = new Set(cashDenominations);
  const suggestions: number[] = [];
  let candidate = Math.ceil(total / 5000) * 5000;
  if (candidate <= total) candidate += 5000;

  while (suggestions.length < 2 && candidate <= total + 30000) {
    if (!denominationValues.has(candidate) && !suggestions.includes(candidate)) suggestions.push(candidate);
    candidate += 5000;
  }

  return suggestions;
}

function allocateCopAmount(total: number, amounts: number[]) {
  const safeTotal = Math.max(0, Math.round(total));
  const baseTotal = amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0);
  if (baseTotal <= 0) return amounts.map(() => 0);
  let allocated = 0;
  return amounts.map((amount, index) => {
    const next = index === amounts.length - 1
      ? safeTotal - allocated
      : Math.round(safeTotal * Math.max(0, amount) / baseTotal);
    allocated += next;
    return Math.max(0, next);
  });
}

function productKey(line: Omit<CartLine, "key" | "quantity" | "signature">) {
  if (line.combo_instance_id) {
    return `combo-component:${line.combo_instance_id}:${line.kind}:${line.id}:${line.secondary_id ?? "whole"}:${line.combo_component_label ?? ""}`;
  }
  if (line.kind === "sale_product") return `product:${line.id}:${line.unit_price_cop}`;
  if (line.kind === "combo") {
    const choicesKey = (line.combo_choices ?? []).map((choice) => `${choice.variant_id ?? ""}:${choice.group_id}:${choice.option_id}`).sort().join("|");
    return `combo:${line.id}:${line.unit_price_cop}:${choicesKey}`;
  }
  const additionsKey = line.additions.map((addition) => `${addition.id}:${addition.scope}:${addition.quantity}`).sort().join("|");
  const removedKey = (line.removed_components ?? []).map((component) => `${component.source_kind}:${component.source_id}`).sort().join("|");
  const baseKey = line.base_override ? `${line.base_override.source_kind}:${line.base_override.source_id}` : "default";
  return `pizza:${line.id}:${line.secondary_id ?? "whole"}:${line.notes ?? ""}:${removedKey}:${additionsKey}:${baseKey}`;
}

function cartLineKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `line:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function orderKindLabel(kind: OrderKind) {
  if (kind === "local") return "Local";
  if (kind === "pickup") return "Recoger";
  return "Domicilio";
}

function paymentLabel(method: PaymentMethod) {
  if (method === "cash") return "Efectivo";
  if (method === "card") return "Tarjeta";
  if (method === "transfer") return "Transferencia";
  if (method === "rappi") return "Rappi";
  if (method === "didi") return "DiDi";
  if (method === "mixed") return "Mixto";
  return "Pendiente";
}

function paymentIcon(method: PaymentMethod) {
  if (method === "cash") return Banknote;
  if (method === "transfer") return Landmark;
  if (method === "mixed") return WalletCards;
  if (method === "pending") return Clock;
  return method === "rappi" ? Bike : CarFront;
}

function formatPosUnitCost(value: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return "Sin costo";
  return `Costo: ${formatCop(value, { decimals: !Number.isInteger(value) })} / UND`;
}

function ingredientChoiceKey(flavorId: string, side: "first" | "second", ingredient: FlavorIngredientOption) {
  return `${side}:${flavorId}:${ingredient.source_kind}:${ingredient.source_id}`;
}

function ingredientChoicesForWizard(wizard: PizzaWizard) {
  const first = wizard.flavor.characteristic_ingredients
    .filter(isRemovablePizzaIngredient)
    .map((ingredient) => ({
      ...ingredient,
      key: ingredientChoiceKey(wizard.flavor.flavor_id, "first", ingredient),
      side: "first" as const,
      flavor_name: wizard.flavor.flavor_name
    }));
  const second =
    wizard.mode === "half" && wizard.secondFlavor
      ? wizard.secondFlavor.characteristic_ingredients
          .filter(isRemovablePizzaIngredient)
          .map((ingredient) => ({
            ...ingredient,
            key: ingredientChoiceKey(wizard.secondFlavor!.flavor_id, "second", ingredient),
            side: "second" as const,
            flavor_name: wizard.secondFlavor!.flavor_name
          }))
      : [];
  return [...first, ...second];
}

function isRemovablePizzaIngredient(ingredient: FlavorIngredientOption) {
  const name = normalizeMasterText(ingredient.source_name);
  return !(
    name === "MASA" ||
    name.startsWith("MASA ") ||
    name.includes("MASA BASE") ||
    name === "SALSA" ||
    name.includes("SALSA BASE") ||
    name.includes("BASE SALSA")
  );
}

function removedIngredientNotes(wizard: PizzaWizard) {
  const removed = ingredientChoicesForWizard(wizard).filter((ingredient) => wizard.removedIngredientKeys.includes(ingredient.key));
  if (removed.length === 0) return "";
  return removed
    .map((ingredient) =>
      wizard.mode === "half" ? `Sin ${ingredient.source_name} (${ingredient.flavor_name})` : `Sin ${ingredient.source_name}`
    )
    .join(", ");
}

function previousStepForSummary(wizard: PizzaWizard) {
  if (wizard.mode === "half") return "half";
  return "type";
}

function additionSelectionKey(id: string, scope: AdditionScope) {
  return `${id}:${scope}`;
}

function additionLabel(addition: CartAddition) {
  return addition.scope_label ? `+ ${addition.name} x${addition.quantity} (${addition.scope_label})` : `+ ${addition.name} x${addition.quantity}`;
}

function PendingPaymentsButton({ paidTodayPayments, pendingPayments }: { paidTodayPayments: PosPendingPayment[]; pendingPayments: PosPendingPayment[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<PosPendingPayment | null>(null);
  const [method, setMethod] = useState<"cash" | "transfer" | "mixed">("cash");
  const [state, setState] = useState<FormActionState>(initialState);
  const [cashReceived, setCashReceived] = useState("");
  const [cashSelectedOption, setCashSelectedOption] = useState<string | null>(null);
  const [mixedCash, setMixedCash] = useState("");
  const [mixedTransfer, setMixedTransfer] = useState("");
  const [mixedCashReceived, setMixedCashReceived] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const selectedTotal = selected?.total_cop ?? 0;
  const cashReceivedValue = Number(cashReceived || 0);
  const cashChange = Math.max(0, cashReceivedValue - selectedTotal);
  const cashSuggestions = useMemo(() => cashQuickSuggestions(selectedTotal), [selectedTotal]);
  const validCashDenominations = useMemo(() => cashDenominations.filter((amount) => amount >= selectedTotal), [selectedTotal]);
  const mixedCashValue = Number(mixedCash || 0);
  const mixedTransferValue = Number(mixedTransfer || 0);
  const mixedCashReceivedValue = Number(mixedCashReceived || 0);
  const mixedChange = Math.max(0, mixedCashReceivedValue - mixedCashValue);
  const orderTime = (value: string) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      setSelected(null);
      setIsOpen(false);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [router, state.status]);

  function selectPayment(order: PosPendingPayment) {
    setSelected(order);
    setMethod("cash");
    setCashReceived("");
    setCashSelectedOption(null);
    setMixedCash("");
    setMixedTransfer("");
    setMixedCashReceived("");
    setState(initialState);
  }

  function submitPayment() {
    if (!selected) return;
    const formData = new FormData();
    formData.set("order_id", selected.id);
    formData.set("total_cop", String(selected.total_cop));
    formData.set("reason", "COBRO PENDIENTE DESDE PEDIDOS");
    formData.set("payment_method", method);
    if (method === "cash") formData.set("cash_received_cop", cashReceived);
    if (method === "mixed") {
      formData.set("mixed_cash_cop", mixedCash);
      formData.set("mixed_transfer_cop", mixedTransfer);
      formData.set("mixed_cash_received_cop", mixedCashReceived);
    }
    startTransition(async () => setState(await updatePosOrderPaymentMethod(initialState, formData)));
  }

  return (
    <div className="pos-pending-payments">
      <button aria-expanded={isOpen} aria-label={`Cobros pendientes: ${pendingPayments.length}`} className="pos-pending-payments-trigger" onClick={() => setIsOpen((open) => !open)} title="Cobros pendientes" type="button">
        <HandCoins size={18} />
        {pendingPayments.length > 0 ? <span>{pendingPayments.length}</span> : null}
      </button>
      {isOpen ? (
        <section className="pos-pending-payments-panel" aria-label="Cobros del día">
          <header><strong>Cobros del día</strong><button aria-label="Cerrar cobros del día" className="icon-button" onClick={() => setIsOpen(false)} type="button"><X size={15} /></button></header>
          <section className="pos-payment-order-section" aria-labelledby="pending-payments-title">
            <div className="pos-payment-order-section-title"><strong id="pending-payments-title">Pendientes</strong><span>{pendingPayments.length}</span></div>
            {pendingPayments.length === 0 ? <p className="empty-state">No hay cobros pendientes.</p> : (
              <div className="pos-pending-payments-list">
                <div className="pos-pending-payments-table-head" aria-hidden="true"><span>Pedido</span><span>Mesa / cliente</span><span>Total</span><span /></div>
                {pendingPayments.map((order) => (
                  <article key={order.id}>
                    <div><strong>{order.code}</strong><small>{orderTime(order.ordered_at)}</small></div>
                    <div className="pos-pending-payment-party"><strong>{order.table_name ?? "Sin mesa"}</strong><small>{order.customer_name ?? "Sin cliente"}</small></div>
                    <b>{formatCop(order.total_cop)}</b>
                    <button className="secondary-button" onClick={() => selectPayment(order)} type="button">Cobrar</button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="pos-payment-order-section" aria-labelledby="paid-payments-title">
            <div className="pos-payment-order-section-title paid"><strong id="paid-payments-title">Cobrados hoy</strong><span>{paidTodayPayments.length}</span></div>
            {paidTodayPayments.length === 0 ? <p className="empty-state">No hay cobros registrados hoy.</p> : (
              <div className="pos-pending-payments-list paid">
                <div className="pos-pending-payments-table-head" aria-hidden="true"><span>Pedido</span><span>Mesa / cliente</span><span>Total</span><span /></div>
                {paidTodayPayments.map((order) => (
                  <article key={order.id}>
                    <div><strong>{order.code}</strong><small>{orderTime(order.ordered_at)}</small></div>
                    <div className="pos-pending-payment-party"><strong>{order.table_name ?? "Sin mesa"}</strong><small>{order.customer_name ?? "Sin cliente"}</small></div>
                    <b>{formatCop(order.total_cop)}</b>
                    <span className="pos-payment-order-actions"><CustomerReceiptPrintButton label="" orderCode={order.code} orderId={order.id} /></span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}
      {selected ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label={`Cobrar pedido ${selected.code}`} aria-modal="true" className="modal-panel cash-payment-modal pending-payment-modal" role="dialog">
            <header className="modal-header">
              <div><strong>Cobrar pedido {selected.code}</strong><span>Confirma el cobro antes de registrar el pago.</span></div>
              <button className="icon-button" onClick={() => setSelected(null)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="cash-payment-body">
              <div className="cash-payment-header">
                <div className="cash-total-display"><span>Total pendiente</span><strong>{formatCop(selectedTotal)}</strong></div>
                <div className="pending-payment-method-picker">
                  <span>Método de pago</span>
                  <div>{(["cash", "transfer", "mixed"] as const).map((item) => <button className={method === item ? "active" : ""} key={item} onClick={() => setMethod(item)} type="button">{paymentLabel(item)}</button>)}</div>
                </div>
              </div>
              {method === "cash" ? (
                <>
                  <button className={["cash-exact-button", cashSelectedOption === "exact" ? "selected" : ""].filter(Boolean).join(" ")} onClick={() => { setCashReceived(String(selectedTotal)); setCashSelectedOption("exact"); }} type="button"><Banknote size={28} /><span>Pago exacto</span></button>
                  <section className="cash-other-amounts" aria-label="Otros montos">
                    <div className="cash-section-title"><Zap size={16} /><span>Montos rápidos</span></div>
                    <div className="cash-denomination-grid">{validCashDenominations.map((amount) => <button className={["cash-denomination", cashSelectedOption === `denomination:${amount}` ? "selected" : ""].filter(Boolean).join(" ")} key={amount} onClick={() => { setCashReceived(String(amount)); setCashSelectedOption(`denomination:${amount}`); }} type="button">{formatCop(amount)}</button>)}</div>
                    {cashSuggestions.length > 0 ? <div className="cash-denomination-grid">{cashSuggestions.map((amount) => <button className={["cash-denomination", cashSelectedOption === `suggestion:${amount}` ? "selected" : ""].filter(Boolean).join(" ")} key={amount} onClick={() => { setCashReceived(String(amount)); setCashSelectedOption(`suggestion:${amount}`); }} type="button">{formatCop(amount)}</button>)}</div> : null}
                    <label className="field cash-manual-amount"><span>Otro monto</span><div className="cash-manual-input"><WalletCards size={22} /><input inputMode="numeric" onChange={(event) => { setCashReceived(event.target.value.replace(/\D/g, "")); setCashSelectedOption(null); }} placeholder="Ingresar monto" value={cashReceived} /></div></label>
                  </section>
                  <div className="cash-change-summary"><span className="cash-summary-received"><ReceiptText size={22} />Recibido:<strong>{cashReceivedValue > 0 ? formatCop(cashReceivedValue) : "-"}</strong></span><span className="cash-summary-change"><Repeat2 size={26} />Cambio:<strong>{cashReceivedValue >= selectedTotal ? formatCop(cashChange) : "-"}</strong></span></div>
                  {cashReceivedValue > 0 && cashReceivedValue < selectedTotal ? <p className="form-status error">El monto recibido no cubre el total.</p> : null}
                </>
              ) : null}
              {method === "mixed" ? <div className="pos-pending-payment-mixed pending-payment-mixed"><label className="field"><span>Efectivo</span><input inputMode="numeric" min="1" onChange={(event) => setMixedCash(event.target.value.replace(/\D/g, ""))} type="number" value={mixedCash} /></label><label className="field"><span>Transferencia</span><input inputMode="numeric" min="1" onChange={(event) => setMixedTransfer(event.target.value.replace(/\D/g, ""))} type="number" value={mixedTransfer} /></label><label className="field"><span>Recibido efectivo</span><input inputMode="numeric" min="1" onChange={(event) => setMixedCashReceived(event.target.value.replace(/\D/g, ""))} type="number" value={mixedCashReceived} /></label><span className="pending-payment-mixed-summary">Desglose: <strong>{formatCop(mixedCashValue + mixedTransferValue)} / {formatCop(selectedTotal)}</strong> · Cambio: <strong>{formatCop(mixedChange)}</strong></span></div> : null}
              {method === "transfer" ? <p className="form-status success">El total se registrará como transferencia.</p> : null}
              {state.status === "error" ? <p className="form-status error">{state.message}</p> : null}
            </div>
            <footer className="modal-footer"><button className="ghost-button" onClick={() => setSelected(null)} type="button">Cancelar</button><button className="positive-button" disabled={isPending || (method === "cash" && cashReceivedValue < selectedTotal) || (method === "mixed" && (Math.round(mixedCashValue + mixedTransferValue) !== Math.round(selectedTotal) || mixedCashReceivedValue < mixedCashValue))} onClick={submitPayment} type="button">{isPending ? "Cobrando..." : "Confirmar cobro"}</button></footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function PosOrderWorkspace({
  pizzas,
  additions,
  saleProducts,
  combos,
  baseOptions,
  canConfigurePizzaPhotos,
  canEditSaleDate,
  canRecordPendingStock,
  platformPaymentSettings,
  packagingRules,
  orderTables,
  paidTodayPayments,
  pendingPayments,
  isSystemAdmin,
  userId
}: {
  pizzas: PosPizzaOption[];
  additions: PosAdditionOption[];
  saleProducts: PosSaleProductOption[];
  combos: PosComboOption[];
  baseOptions: PosPizzaBaseOption[];
  canConfigurePizzaPhotos: boolean;
  canEditSaleDate: boolean;
  canRecordPendingStock: boolean;
  platformPaymentSettings: PosPlatformPaymentSetting[];
  packagingRules: PosPackagingRule[];
  orderTables: PosOrderTableOption[];
  paidTodayPayments: PosPendingPayment[];
  pendingPayments: PosPendingPayment[];
  isSystemAdmin: boolean;
  userId: string;
}) {
  const [state, action] = useActionState(createPosOrder, initialState);
  const [tab, setTab] = useState<CatalogTab>("pizzas");
  const [query, setQuery] = useState("");
  const [pizzaCardScale, setPizzaCardScale] = useState(1);
  const [productCardScale, setProductCardScale] = useState(1);
  const [productViewSettings, setProductViewSettings] = useState<ProductViewSettings>(defaultProductViewSettings);
  const [productSettingsOpen, setProductSettingsOpen] = useState(false);
  const [directSaleOpen, setDirectSaleOpen] = useState(false);
  const [directSaleDraft, setDirectSaleDraft] = useState<DirectSaleDraft>(emptyDirectSaleDraft);
  const [directSaleError, setDirectSaleError] = useState("");
  const [directSaleQuickActions, setDirectSaleQuickActions] = useState<DirectSaleDraft[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderKind, setOrderKind] = useState<OrderKind>("local");
  const [pickupMode, setPickupMode] = useState<PickupMode>("pickup");
  const [tableId, setTableId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [orderChannel, setOrderChannel] = useState<OrderChannel>("direct");
  const [didiService, setDidiService] = useState<DidiService>("didi_standard");
  const [didiCollectionParty, setDidiCollectionParty] = useState<CollectionParty>("platform");
  const [platformLineUnitPriceOverrides, setPlatformLineUnitPriceOverrides] = useState<Record<"rappi" | DidiService, Record<string, number>>>({ rappi: {}, didi_standard: {}, didi_tu_negocio: {} });
  const [saleDate, setSaleDate] = useState(todayBogota);
  const [saleDateReady, setSaleDateReady] = useState(!canEditSaleDate);
  const [allowPendingStock, setAllowPendingStock] = useState(false);
  const [delivery, setDelivery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [packagingQuantities, setPackagingQuantities] = useState<Record<string, number>>({});
  const [wizard, setWizard] = useState<PizzaWizard | null>(null);
  const [comboWizard, setComboWizard] = useState<PosComboOption | null>(null);
  const [selectedComboVariantId, setSelectedComboVariantId] = useState<string | null>(null);
  const [comboSelections, setComboSelections] = useState<Record<string, string[]>>({});
  const [editingComboLineKey, setEditingComboLineKey] = useState<string | null>(null);
  const [selectedAdditions, setSelectedAdditions] = useState<Record<string, number>>({});
  const [additionScopes, setAdditionScopes] = useState<Record<string, AdditionScope>>({});
  const [ingredientModalOpen, setIngredientModalOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>("percentage");
  const [discountInput, setDiscountInput] = useState("");
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [cashSelectedOption, setCashSelectedOption] = useState<string | null>(null);
  const [printSelection, setPrintSelection] = useState<PaymentPrintSelection>(defaultPrintSelection);
  const [printPreferencesReady, setPrintPreferencesReady] = useState(false);
  const [paymentConfirmModalOpen, setPaymentConfirmModalOpen] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [printJob, setPrintJob] = useState<PaymentPrintJob | null>(null);
  const [printNotice, setPrintNotice] = useState("");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [stockNotice, setStockNotice] = useState("");
  const [stockShortageModalOpen, setStockShortageModalOpen] = useState(false);
  const [inventoryPreviewOpen, setInventoryPreviewOpen] = useState(false);
  const [inventoryPreviewLoading, setInventoryPreviewLoading] = useState(false);
  const [inventoryPreviewError, setInventoryPreviewError] = useState("");
  const [inventoryPreview, setInventoryPreview] = useState<PosInventoryConsumptionPreview | null>(null);
  const [baseLineKey, setBaseLineKey] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cashSubmitLockRef = useRef(false);
  const handledSuccessOrderIdRef = useRef<string | null>(null);
  const submittedPaymentMethodRef = useRef<PaymentMethod | null>(null);
  const router = useRouter();
  const normalizedQuery = normalizeMasterText(query);
  const activeCardScale = tab === "pizzas" ? pizzaCardScale : productCardScale;
  const saleDateStorageKey = `modo-pos-sale-date:${userId}`;
  const directSaleQuickActionsKey = `modo-pos-direct-sale-actions:${userId}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPizzaCardScale(initialCardScale(pizzaCardScaleKey));
      setProductCardScale(initialCardScale(productCardScaleKey));
      setProductViewSettings(readProductViewSettings());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(directSaleQuickActionsKey) ?? "[]");
        setDirectSaleQuickActions(Array.isArray(stored) ? stored.filter((item): item is DirectSaleDraft => Boolean(item && typeof item.name === "string")).slice(0, 12) : []);
      } catch {
        setDirectSaleQuickActions([]);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [directSaleQuickActionsKey]);

  function saveDirectSaleQuickAction() {
    const name = uppercaseMasterName(directSaleDraft.name);
    if (!name || !directSaleDraft.sale_unit_price_cop || !directSaleDraft.acquisition_unit_cost_cop) {
      setDirectSaleError("Completa producto y precios antes de guardar la acción rápida.");
      return;
    }
    setDirectSaleQuickActions((current) => {
      const next = [{ ...directSaleDraft, name, quantity: "1", observation: "" }, ...current.filter((item) => item.name !== name)].slice(0, 12);
      window.localStorage.setItem(directSaleQuickActionsKey, JSON.stringify(next));
      return next;
    });
    setDirectSaleError("");
  }

  useEffect(() => {
    window.localStorage.setItem(pizzaCardScaleKey, String(pizzaCardScale));
  }, [pizzaCardScale]);

  useEffect(() => {
    window.localStorage.setItem(productCardScaleKey, String(productCardScale));
  }, [productCardScale]);

  useEffect(() => {
    window.localStorage.setItem(productViewSettingsKey, JSON.stringify(productViewSettings));
  }, [productViewSettings]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPrintSelection(readPrintSelection());
      setPrintPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!canEditSaleDate) return;
    try {
      setSaleDate(readSaleDatePreference(saleDateStorageKey, todayBogota()));
    } finally {
      setSaleDateReady(true);
    }
  }, [canEditSaleDate, saleDateStorageKey]);

  useEffect(() => {
    if (!canEditSaleDate) return;
    const interval = window.setInterval(() => {
      const today = todayBogota();
      setSaleDate((current) => current === today ? current : today);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [canEditSaleDate]);

  useEffect(() => {
    if (!canEditSaleDate || !saleDateReady) return;
    try {
      const preference: SaleDatePreference = { date: saleDate, savedFor: todayBogota() };
      window.localStorage.setItem(saleDateStorageKey, JSON.stringify(preference));
    } catch {
      // The order remains usable when browser preferences are unavailable.
    }
  }, [canEditSaleDate, saleDate, saleDateReady, saleDateStorageKey]);

  useEffect(() => {
    if (!printPreferencesReady) return;
    try {
      window.localStorage.setItem(printSelectionKey, JSON.stringify(printSelection));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [printPreferencesReady, printSelection]);

  useEffect(() => {
    if (state.status !== "success" || !state.order || handledSuccessOrderIdRef.current === state.order.id) return;
    const completedOrder = state.order;

    // useActionState preserves its last result. Record the order already handled so a
    // later change to the payment form cannot replay this success and clear a new cart.
    handledSuccessOrderIdRef.current = completedOrder.id;
    submittedPaymentMethodRef.current = null;
    const timeout = window.setTimeout(() => {
      if (printSelection.kitchen || printSelection.receipt) {
        setPrintJob({
          id: `${completedOrder.id}:${printSelection.kitchen ? "k" : ""}${printSelection.receipt ? "r" : ""}`,
          orderId: completedOrder.id,
          ...printSelection
        });
      }
      setCart([]);
      setDelivery("");
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
      setOrderKind("local");
      setPaymentMethod("cash");
      setOrderChannel("direct");
      setDidiService("didi_standard");
      setDidiCollectionParty("platform");
      setAllowPendingStock(false);
      setPlatformLineUnitPriceOverrides({ rappi: {}, didi_standard: {}, didi_tu_negocio: {} });
      setDiscount(null);
      setDiscountInput("");
      setDiscountModalOpen(false);
      setCashModalOpen(false);
      setCashReceived("");
      setCashConfirmed(false);
      setCashSubmitting(false);
      setCashSelectedOption(null);
      setPaymentConfirmModalOpen(false);
      setPaymentConfirmed(false);
      setPaymentSubmitting(false);
      setStockNotice("");
      cashSubmitLockRef.current = false;
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [printSelection, router, state]);

  useEffect(() => {
    if (state.status !== "error") return;

    const submittedPaymentMethod = submittedPaymentMethodRef.current;
    submittedPaymentMethodRef.current = null;
    if (state.stockShortages?.length) {
      const timeout = window.setTimeout(() => {
        setCashConfirmed(false);
        setCashSubmitting(false);
        setCashModalOpen(false);
        setPaymentConfirmed(false);
        setPaymentSubmitting(false);
        setPaymentConfirmModalOpen(false);
        setStockShortageModalOpen(true);
        cashSubmitLockRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (submittedPaymentMethod === "cash") {
      const timeout = window.setTimeout(() => {
        setCashConfirmed(false);
        setCashSubmitting(false);
        setCashModalOpen(true);
        cashSubmitLockRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (submittedPaymentMethod) {
      const timeout = window.setTimeout(() => {
        setPaymentConfirmed(false);
        setPaymentSubmitting(false);
        setPaymentConfirmModalOpen(true);
        cashSubmitLockRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      setCashConfirmed(false);
      setCashSubmitting(false);
      cashSubmitLockRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const pizzaSuggestions = useMemo(() => pizzas.map((pizza) => pizza.flavor_name), [pizzas]);
  const productSuggestions = useMemo(() => saleProducts.map((product) => `${product.name} ${product.presentation ?? ""}`.trim()), [saleProducts]);
  const comboSuggestions = useMemo(() => combos.map((combo) => combo.name), [combos]);

  const filteredPizzas = useMemo(
    () =>
      pizzas.filter((pizza) => {
        const text = `${pizza.flavor_name} ${pizza.category_name ?? ""} ${pizza.prices.map((price) => price.size_name).join(" ")}`;
        const matchesSearch = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
        return matchesSearch;
      }),
    [normalizedQuery, pizzas]
  );

  const filteredProducts = useMemo(
    () =>
      saleProducts.filter((product) => {
        const text = `${product.sku ?? ""} ${product.name} ${product.presentation ?? ""}`;
        const matchesSearch = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
        const matchesStock = productViewSettings.showSoldOut || Math.max(0, Math.floor(product.stock_base ?? 0)) > 0;
        return matchesSearch && matchesStock;
      }),
    [normalizedQuery, productViewSettings.showSoldOut, saleProducts]
  );
  const filteredCombos = useMemo(
    () =>
      combos.filter((combo) => {
        const text = `${combo.sku} ${combo.name} ${combo.description ?? ""}`;
        return !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
      }),
    [combos, normalizedQuery]
  );

  const saleProductById = useMemo(() => new Map(saleProducts.map((product) => [product.id, product])), [saleProducts]);
  const pizzaPriceById = useMemo(
    () => new Map(pizzas.flatMap((pizza) => pizza.prices.filter((price): price is PosPizzaSizePrice & { id: string } => Boolean(price.id)).map((price) => [price.id, price]))),
    [pizzas]
  );
  const packagingServiceKind = orderKind === "delivery" ? "delivery" : orderKind === "local" ? "local" : pickupMode === "takeaway" ? "takeaway" : "pickup";
  const automaticPackaging = useMemo(() => {
    const quantities = new Map<string, { name: string; quantity: number }>();
    for (const line of cart) {
      if (line.kind === "direct_sale") continue;
      const target = line.kind === "pizza"
        ? { kind: "pizza_size" as const, id: pizzaPriceById.get(line.id)?.size_id ?? "" }
        : line.kind === "sale_product" ? { kind: "sale_product" as const, id: line.id } : null;
      if (!target?.id) continue;
      for (const rule of packagingRules) {
        if (rule.target_kind !== target.kind || rule.target_id !== target.id || rule.service_kind !== packagingServiceKind) continue;
        const current = quantities.get(rule.packaging_inventory_item_id) ?? { name: rule.packaging_name, quantity: 0 };
        current.quantity += rule.quantity_base * line.quantity;
        quantities.set(rule.packaging_inventory_item_id, current);
      }
    }
    return quantities;
  }, [cart, packagingRules, packagingServiceKind, pizzaPriceById]);
  const packagingEntries = useMemo(() => {
    const ids = new Set([...automaticPackaging.keys(), ...Object.keys(packagingQuantities)]);
    return [...ids].map((id) => {
      const automatic = automaticPackaging.get(id);
      const quantity = Math.max(0, packagingQuantities[id] ?? automatic?.quantity ?? 0);
      return { inventory_item_id: id, name: automatic?.name ?? "Empaque", automatic_quantity_base: automatic?.quantity ?? 0, quantity_base: quantity };
    }).filter((entry) => entry.quantity_base > 0 || entry.automatic_quantity_base > 0);
  }, [automaticPackaging, packagingQuantities]);

  function saleProductCartQuantity(productId: string, lines = cart) {
    return lines
      .filter((line) => line.kind === "sale_product" && line.id === productId)
      .reduce((sum, line) => sum + line.quantity, 0);
  }

  function saleProductStock(productId: string) {
    return Math.max(0, Math.floor(saleProductById.get(productId)?.stock_base ?? 0));
  }

  function selectDirectSaleProduct(productId: string) {
    const product = saleProductById.get(productId);
    if (!product) return;
    setDirectSaleDraft((current) => ({
      ...current,
      inventory_item_id: product.id,
      name: product.name,
      sale_unit_price_cop: current.sale_unit_price_cop || String(Math.round(product.sale_price_cop || 0)),
      acquisition_unit_cost_cop: current.acquisition_unit_cost_cop || String(Math.round(product.unit_cost_cop || 0))
    }));
  }

  function addDirectSale() {
    const quantity = Number(directSaleDraft.quantity.replace(",", "."));
    const salePrice = Number(directSaleDraft.sale_unit_price_cop.replace(/\D/g, ""));
    const acquisitionCost = Number(directSaleDraft.acquisition_unit_cost_cop.replace(/\D/g, ""));
    const name = uppercaseMasterName(directSaleDraft.name);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(salePrice) || salePrice <= 0 || !Number.isFinite(acquisitionCost) || acquisitionCost < 0) {
      setDirectSaleError("Completa producto, cantidad, precio de venta y costo de compra válidos.");
      return;
    }
    const uniqueKey = `direct:${crypto.randomUUID()}`;
    addLine({
      kind: "direct_sale",
      id: `direct-${uniqueKey}`,
      name,
      sku: null,
      image_src: null,
      unit_price_cop: Math.round(salePrice),
      additions: [],
      notes: directSaleDraft.observation.trim() || undefined,
      direct_sale: {
        inventory_item_id: directSaleDraft.inventory_item_id || null,
        acquisition_unit_cost_cop: Math.round(acquisitionCost * 100) / 100,
        funds_origin: directSaleDraft.funds_origin,
        observation: directSaleDraft.observation.trim()
      }
    }, Math.max(1, Math.round(quantity)));
    setDirectSaleOpen(false);
    setDirectSaleDraft(emptyDirectSaleDraft());
    setDirectSaleError("");
  }

  function stockMessage(productId: string) {
    return `Stock disponible: ${formatStockQuantity(saleProductStock(productId), "unit")}`;
  }

  const subtotalBeforeComboDiscount = cart.reduce((sum, line) => {
    const additionsSubtotal = line.additions.reduce((additionSum, addition) => additionSum + addition.quantity * addition.unit_price_cop, 0);
    const componentPrice = line.combo_instance_id ? line.combo_component_normal_price_cop ?? line.unit_price_cop : line.unit_price_cop;
    return sum + line.quantity * (componentPrice + additionsSubtotal);
  }, 0);
  const comboPriceAdjustmentCop = cart.reduce((sum, line) => {
    if (!line.combo_is_primary) return sum;
    return sum + line.quantity * (line.combo_price_adjustment_cop ?? Math.max(0, line.combo_savings_cop ?? 0));
  }, 0);
  const subtotal = Math.max(0, subtotalBeforeComboDiscount + comboPriceAdjustmentCop);
  const deliveryValue = orderKind === "delivery" ? Number(delivery || 0) : 0;
  const rawDiscountCop = discount?.type === "percentage" ? Math.round(subtotal * discount.value / 100) : discount?.amount_cop ?? 0;
  const discountCop = discount ? Math.min(rawDiscountCop, Math.max(0, subtotal - 1)) : 0;
  const total = Math.max(0, subtotal - discountCop + deliveryValue);
  const platformPayment = orderChannel === "rappi" || (orderChannel === "didi" && didiCollectionParty === "platform") ? orderChannel : null;
  const isPendingPayment = paymentMethod === "pending";
  const didiSetting = platformPaymentSettings.find((setting) => setting.platform === "didi") ?? null;
  const didiTuNegocioChargeSetting = orderChannel === "didi" && didiService === "didi_tu_negocio" ? didiSetting : null;
  const platformPaymentSetting = platformPayment === "didi" && didiService === "didi_tu_negocio" && didiSetting
    ? { ...didiSetting, commission_percent: didiSetting.didi_tu_negocio_commission_percent, fixed_fee_cop: didiSetting.didi_tu_negocio_fixed_fee_cop, commission_tax_percent: didiSetting.didi_tu_negocio_commission_tax_percent }
    : platformPayment ? platformPaymentSettings.find((setting) => setting.platform === platformPayment) ?? null : null;
  const didiTuNegocioBillingChargeCop = didiTuNegocioChargeSetting && didiCollectionParty === "business"
    ? Math.max(0, Math.round((total * didiTuNegocioChargeSetting.didi_tu_negocio_commission_percent / 100 + didiTuNegocioChargeSetting.didi_tu_negocio_fixed_fee_cop) * (1 + didiTuNegocioChargeSetting.didi_tu_negocio_commission_tax_percent / 100)))
    : 0;
  const didiTuNegocioNetAfterBillingCop = Math.max(0, total - didiTuNegocioBillingChargeCop);
  const platformLineBases = cart.map((line) => {
    const additionsCop = line.additions.reduce((sum, addition) => sum + addition.quantity * addition.unit_price_cop, 0);
    const componentPriceCop = line.combo_instance_id ? line.combo_component_normal_price_cop ?? line.unit_price_cop : line.unit_price_cop;
    const comboAdjustmentCop = line.combo_is_primary ? (line.combo_price_adjustment_cop ?? 0) * line.quantity : 0;
    return {
      cart_line_key: line.key,
      name: line.combo_instance_id ? `${line.combo_name ?? "Combo"}: ${line.name}` : line.name,
      detail: line.additions.length > 0 ? line.additions.map((addition) => `${addition.quantity > 1 ? `${addition.quantity} × ` : ""}${addition.name}`).join(" · ") : null,
      quantity: line.quantity,
      original_cop: Math.max(0, Math.round(line.quantity * (componentPriceCop + additionsCop) + comboAdjustmentCop))
    };
  });
  const platformFixedFeeAllocations = allocateCopAmount(
    platformPaymentSetting?.fixed_fee_cop ?? 0,
    platformLineBases.map((line) => line.original_cop)
  );
  const platformOverrideKey: "rappi" | DidiService = platformPayment === "didi" ? didiService : "rappi";
  const platformLineOverrides = platformPayment ? platformLineUnitPriceOverrides[platformOverrideKey] : {};
  const platformLineDrafts = platformLineBases.map((line, index) => {
    const original_unit_cop = line.quantity > 0 ? Math.round(line.original_cop / line.quantity) : 0;
    const commissionBaseCop = Math.round(
      line.original_cop * (platformPaymentSetting?.commission_percent ?? 0) / 100 + platformFixedFeeAllocations[index]
    );
    const configuredCommissionCop = Math.round(
      commissionBaseCop * (1 + (platformPaymentSetting?.commission_tax_percent ?? 0) / 100)
    );
    const suggestedFinalCop = Math.max(0, line.original_cop - configuredCommissionCop);
    const suggestedFinalUnitCop = line.quantity > 0 ? Math.round(suggestedFinalCop / line.quantity) : 0;
    const final_unit_cop = platformLineOverrides[line.cart_line_key] ?? suggestedFinalUnitCop;
    const final_cop = Math.max(0, Math.round(final_unit_cop * line.quantity));
    const merchant_discount_cop = line.original_cop - final_cop;
    return {
      ...line,
      original_unit_cop,
      final_unit_cop,
      final_cop,
      merchant_discount_cop,
      merchant_discount_percent: line.original_cop > 0 ? merchant_discount_cop * 100 / line.original_cop : 0
    };
  });
  const platformSettlementEntries = [
    ...platformLineDrafts,
    ...(deliveryValue > 0 ? [{ cart_line_key: "__delivery__", name: "Domicilio", detail: null, quantity: 1, original_unit_cop: deliveryValue, final_unit_cop: deliveryValue, original_cop: deliveryValue, final_cop: deliveryValue, merchant_discount_cop: 0, merchant_discount_percent: 0 }] : [])
  ].map((line) => {
    const commission_cop = Math.max(0, line.original_cop - line.final_cop);
    const commission_base_cop = commission_cop;
    const commission_tax_cop = 0;
    return { ...line, commission_base_cop, commission_tax_cop, commission_cop, net_expected_cop: line.final_cop };
  });
  const platformSubtotalCop = platformSettlementEntries.reduce((sum, line) => sum + line.original_cop, 0);
  const platformCommissionCop = platformSettlementEntries.reduce((sum, line) => sum + line.commission_cop, 0);
  const platformNetExpectedCop = platformSettlementEntries.reduce((sum, line) => sum + line.net_expected_cop, 0);
  const registrationTotalCop = platformPayment ? platformNetExpectedCop : total;
  const hasInvalidPlatformPricing = Boolean(platformPayment && platformLineDrafts.some((line) => !Number.isFinite(line.final_unit_cop) || line.final_unit_cop < 0 || line.final_cop > line.original_cop));
  const platformLinePricingPayload = platformLineDrafts.map((line) => ({
    cart_line_key: line.cart_line_key,
    name: line.name,
    quantity: line.quantity,
    original_cop: line.original_cop,
    final_cop: line.final_cop,
    platform_subsidy_cop: 0
  }));

  const parsedDiscountInput = Number(discountInput.replace(",", "."));
  const previewDiscountCop = discountType === "percentage"
    ? Math.round(subtotal * parsedDiscountInput / 100)
    : Math.round(parsedDiscountInput);
  const discountError = !Number.isFinite(parsedDiscountInput) || parsedDiscountInput <= 0
    ? "Ingresa un valor mayor que cero."
    : discountType === "percentage" && parsedDiscountInput >= 100
      ? "El descuento porcentual debe ser menor al 100%."
      : discountType === "amount" && previewDiscountCop >= subtotal
        ? "El descuento debe ser menor que el subtotal."
        : "";
  const discountLabel = discount?.type === "percentage" ? `Descuento (${discount.value}%)` : "Descuento";
  const cashReceivedValue = Number(cashReceived || 0);
  const cashChange = Math.max(0, cashReceivedValue - total);
  const cashSuggestions = useMemo(() => cashQuickSuggestions(total), [total]);
  const validCashDenominations = useMemo(() => cashDenominations.filter((amount) => amount >= total), [total]);

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
  const selectedAdditionsList = selectedAdditionItems(selectedAdditions, compatibleAdditions, wizard);
  const additionsSubtotal = selectedAdditionsList.reduce((sum, addition) => sum + addition.quantity * addition.unit_price_cop, 0);
  const wizardUnitPrice = (activePrice?.price_cop ?? 0) + additionsSubtotal;
  const wizardIngredientChoices = wizard ? ingredientChoicesForWizard(wizard) : [];
  const wizardRemovedNotes = wizard ? removedIngredientNotes(wizard) : "";

  function addLine(line: Omit<CartLine, "key" | "quantity" | "signature">, quantity = 1) {
    const signature = productKey(line);
    setCart((current) => {
      const existing = current.find((item) => item.signature === signature);
      if (existing) return current.map((item) => (item.key === existing.key ? { ...item, quantity: item.quantity + quantity } : item));
      return [...current, { ...line, key: cartLineKey(), signature, quantity }];
    });
  }

  function addSaleProduct(product: PosSaleProductOption) {
    if (!allowPendingStock && saleProductCartQuantity(product.id) >= saleProductStock(product.id)) {
      setStockNotice(stockMessage(product.id));
      return;
    }
    setStockNotice("");
    addLine({
      kind: "sale_product",
      id: product.id,
      name: product.name,
      sku: product.sku,
      image_src: product.image_src,
      unit_price_cop: product.sale_price_cop,
      additions: []
    });
  }

  function openPizzaWizard(flavor: PosPizzaOption) {
    setSelectedAdditions({});
    setAdditionScopes({});
    setIngredientModalOpen(false);
    setWizard({ flavor, step: "size", selectedSize: null, mode: "whole", secondFlavor: null, quantity: 1, removedIngredientKeys: [], editingLineKey: null, editingBaseOverride: null });
  }

  function openEditPizzaWizard(line: CartLine) {
    if (line.kind !== "pizza") return;
    const firstFlavor = pizzas.find((pizza) => pizza.prices.some((price) => price.id === line.id));
    const selectedSize = firstFlavor?.prices.find((price) => price.id === line.id) ?? null;
    if (!firstFlavor || !selectedSize) return;
    const secondFlavor = line.secondary_id ? pizzas.find((pizza) => pizza.prices.some((price) => price.id === line.secondary_id)) ?? null : null;
    const baseOverride = selectedSize ? validBaseOverrideForSize(selectedSize.size_id, line.base_override ?? null) : null;
    const draftWizard: PizzaWizard = {
      flavor: firstFlavor,
      step: "size",
      selectedSize,
      mode: secondFlavor ? "half" : "whole",
      secondFlavor,
      quantity: line.quantity,
      removedIngredientKeys: [],
      editingLineKey: line.key,
      editingBaseOverride: baseOverride
    };
    const selected = Object.fromEntries(line.additions.map((addition) => [additionSelectionKey(addition.id, addition.scope), addition.quantity]));
    const scopes = Object.fromEntries(line.additions.map((addition) => [addition.id, addition.scope]));
    const ingredientChoices = ingredientChoicesForWizard(draftWizard);
    const removedKeys = line.removed_ingredient_keys?.length
      ? line.removed_ingredient_keys.filter((key) => ingredientChoices.some((ingredient) => ingredient.key === key))
      : ingredientChoices
          .filter((ingredient) => line.removed_components?.some((component) => component.source_kind === ingredient.source_kind && component.source_id === ingredient.source_id))
          .map((ingredient) => ingredient.key);
    setSelectedAdditions(selected);
    setAdditionScopes(scopes);
    setIngredientModalOpen(false);
    setWizard({ ...draftWizard, removedIngredientKeys: removedKeys, step: "summary" });
  }

  function selectPizzaSize(size: PosPizzaSizePrice) {
    if (!wizard) return;
    if (!size.is_active || !size.id || size.price_cop === null) return;
    const nextBaseOverride = validBaseOverrideForSize(size.size_id, wizard.editingBaseOverride);
    if (wizard.editingBaseOverride && !nextBaseOverride) setStockNotice("La base alternativa no era compatible con el nuevo tamano y se uso la base predeterminada.");
    const nextWizard = { ...wizard, selectedSize: size, step: "type" as PizzaStep, mode: "whole" as PizzaMode, secondFlavor: null, removedIngredientKeys: [], editingBaseOverride: nextBaseOverride };
    if (!wizard.flavor.allows_half_and_half) {
      nextWizard.step = "summary";
    }
    setWizard(nextWizard);
    setSelectedAdditions({});
    setAdditionScopes({});
  }

  function selectWizardFlavor(flavor: PosPizzaOption) {
    if (!wizard) return;
    const nextSize = wizard.selectedSize ? priceForSize(flavor, wizard.selectedSize.size_id) : null;
    const nextSecondFlavor =
      wizard.mode === "half" && wizard.secondFlavor && wizard.secondFlavor.flavor_id !== flavor.flavor_id && nextSize && priceForSize(wizard.secondFlavor, nextSize.size_id)
        ? wizard.secondFlavor
        : null;
    const nextMode = nextSecondFlavor ? "half" : "whole";
    const nextBaseOverride = nextSize ? validBaseOverrideForSize(nextSize.size_id, wizard.editingBaseOverride) : null;
    if (wizard.editingBaseOverride && nextSize && !nextBaseOverride) setStockNotice("La base alternativa no era compatible con la nueva pizza y se uso la base predeterminada.");
    setSelectedAdditions({});
    setAdditionScopes({});
    setWizard({
      ...wizard,
      flavor,
      selectedSize: nextSize,
      mode: nextMode,
      secondFlavor: nextSecondFlavor,
      removedIngredientKeys: [],
      editingBaseOverride: nextBaseOverride
    });
  }

  function configuredPizzaLine(source: PizzaWizard, additionsToUse: CartAddition[]): Omit<CartLine, "key" | "quantity" | "signature"> | null {
    if (!source?.selectedSize) return null;
    const firstPrice = source.selectedSize;
    const secondPrice = source.mode === "half" && source.secondFlavor ? priceForSize(source.secondFlavor, firstPrice.size_id) : null;
    const orderPrice = selectedOrderPrice(source, firstPrice, secondPrice);
    if (!firstPrice.id || !orderPrice?.id || orderPrice.price_cop === null) return null;
    if (source.mode === "half" && (!secondPrice?.id || secondPrice.id === firstPrice.id)) return null;
    const name =
      source.mode === "half" && source.secondFlavor
        ? `${source.flavor.flavor_name} / ${source.secondFlavor.flavor_name} ${firstPrice.size_name}`
        : `${source.flavor.flavor_name} ${firstPrice.size_name}`;

    const validBaseOverride = validBaseOverrideForSize(firstPrice.size_id, source.editingBaseOverride);
    return {
      kind: "pizza",
      id: firstPrice.id,
      secondary_id: secondPrice?.id ?? null,
      name,
      sku: orderPrice.sku,
      image_src: source.flavor.image_src,
      unit_price_cop: orderPrice.price_cop,
      additions: additionsToUse,
      notes: removedIngredientNotes(source) || undefined,
      removed_components: ingredientChoicesForWizard(source)
        .filter((ingredient) => source.removedIngredientKeys.includes(ingredient.key))
        .map((ingredient) => ({ source_kind: ingredient.source_kind, source_id: ingredient.source_id })),
      removed_ingredient_keys: source.removedIngredientKeys,
      base_override: validBaseOverride
    };
  }

  function addConfiguredPizza(source = wizard, additionsToUse = selectedAdditionsList, quantity = wizard?.quantity ?? 1): boolean {
    if (!source) return false;
    const line = configuredPizzaLine(source, additionsToUse);
    if (!line) return false;
    if (source.editingLineKey) {
      const existingLine = cart.find((item) => item.key === source.editingLineKey);
      if (existingLine?.combo_instance_id) {
        if (line.id !== existingLine.id || line.secondary_id !== existingLine.secondary_id) {
          setStockNotice("Para cambiar el sabor o tamano de un combo usa Editar combo.");
          return false;
        }
        const comboLine = {
          ...line,
          combo_instance_id: existingLine.combo_instance_id,
          combo_config_id: existingLine.combo_config_id,
          combo_variant_id: existingLine.combo_variant_id,
          combo_variant_name: existingLine.combo_variant_name,
          combo_name: existingLine.combo_name,
          combo_sku: existingLine.combo_sku,
          combo_choices: existingLine.combo_choices,
          combo_normal_price_cop: existingLine.combo_normal_price_cop,
          combo_savings_cop: existingLine.combo_savings_cop,
          combo_price_adjustment_cop: existingLine.combo_price_adjustment_cop,
          combo_unit_price_cop: existingLine.combo_unit_price_cop,
          combo_component_normal_price_cop: existingLine.combo_component_normal_price_cop,
          combo_component_label: existingLine.combo_component_label,
          combo_is_primary: existingLine.combo_is_primary,
          unit_price_cop: existingLine.unit_price_cop,
          notes: line.notes || existingLine.notes
        };
        const signature = productKey(comboLine);
        setCart((current) =>
          current.map((item) =>
            item.key === source.editingLineKey
              ? { ...comboLine, key: item.key, signature, quantity: item.quantity }
              : item
          )
        );
        setWizard(null);
        setSelectedAdditions({});
        setAdditionScopes({});
        setIngredientModalOpen(false);
        return true;
      }
      const signature = productKey(line);
      setCart((current) =>
        current.map((item) =>
          item.key === source.editingLineKey
            ? { ...line, key: item.key, signature, quantity }
            : item
        )
      );
    } else {
      addLine(line, quantity);
    }
    setWizard(null);
    setSelectedAdditions({});
    setAdditionScopes({});
    setIngredientModalOpen(false);
    return true;
  }

  function addConfiguredPizzaAndOpenProducts() {
    if (wizard?.editingLineKey) return;
    if (addConfiguredPizza()) setTab("products");
  }

  function openComboWizard(combo: PosComboOption) {
    setComboSelections({});
    setSelectedComboVariantId(null);
    setEditingComboLineKey(null);
    setComboWizard(combo);
  }

  function openEditComboWizard(line: CartLine) {
    if (!line.combo_config_id || !line.combo_instance_id) return;
    const combo = combos.find((item) => item.id === line.combo_config_id);
    if (!combo) return;
    const selections: Record<string, string[]> = {};
    for (const choice of line.combo_choices ?? []) {
      const selected = selections[choice.group_id] ?? [];
      selections[choice.group_id] = [...selected, choice.option_id];
    }
    setComboSelections(selections);
    setSelectedComboVariantId(line.combo_variant_id ?? line.combo_choices?.[0]?.variant_id ?? combo.variants[0]?.id ?? null);
    setEditingComboLineKey(line.combo_instance_id);
    setComboWizard(combo);
  }

  function selectComboPizza(slotOrder: number, variantId: string, groupId: string, optionId: string, appendHalf = false) {
    if (!comboWizard) return;
    setComboSelections((current) => {
      const next = { ...current };
      const slotGroups = comboWizard.variants.flatMap((candidate) => candidate.groups)
        .filter((group) => group.group_kind === "pizza" && group.sort_order === slotOrder);
      const selectedSlotOptionIds = slotGroups.flatMap((group) => next[group.id] ?? []);
      if (!appendHalf) {
        for (const group of slotGroups) delete next[group.id];
      } else if (selectedSlotOptionIds.includes(optionId) || selectedSlotOptionIds.length >= 2) {
        return current;
      }
      next[groupId] = appendHalf ? [...(next[groupId] ?? []), optionId] : [optionId];

      const selectedVariantIds = Object.entries(next).flatMap(([selectedGroupId, optionIds]) => {
        if (optionIds.length === 0) return [];
        const selectedVariant = comboWizard.variants.find((candidate) => candidate.groups.some((group) => group.id === selectedGroupId && group.group_kind === "pizza"));
        return selectedVariant ? [selectedVariant.id] : [];
      });
      const appliedVariant = comboWizard.variants
        .filter((candidate) => selectedVariantIds.includes(candidate.id))
        .sort((left, right) => right.sale_price_cop - left.sale_price_cop)[0] ?? null;
      setSelectedComboVariantId(appliedVariant?.id ?? null);

      // The included product belongs to the applied commercial tier. Replacing it
      // here keeps the cart tied to the real configured reference.
      for (const group of comboWizard.variants.flatMap((candidate) => candidate.groups)) {
        if (group.group_kind === "sale_product") delete next[group.id];
      }
      for (const group of appliedVariant?.groups ?? []) {
        if (group.group_kind !== "sale_product") continue;
        const option = group.options[0];
        if (option) next[group.id] = [option.id];
      }
      return next;
    });
  }

  function clearComboPizza(slotOrder: number) {
    if (!comboWizard) return;
    setComboSelections((current) => {
      const next = { ...current };
      for (const group of comboWizard.variants.flatMap((candidate) => candidate.groups)) {
        if (group.group_kind === "pizza" && group.sort_order === slotOrder) delete next[group.id];
      }
      const remainingVariantIds = Object.entries(next).flatMap(([groupId, optionIds]) => {
        if (optionIds.length === 0) return [];
        const candidate = comboWizard.variants.find((variant) => variant.groups.some((group) => group.id === groupId && group.group_kind === "pizza"));
        return candidate ? [candidate.id] : [];
      });
      const appliedVariant = comboWizard.variants
        .filter((candidate) => remainingVariantIds.includes(candidate.id))
        .sort((left, right) => right.sale_price_cop - left.sale_price_cop)[0] ?? null;
      setSelectedComboVariantId(appliedVariant?.id ?? null);
      for (const group of comboWizard.variants.flatMap((candidate) => candidate.groups)) {
        if (group.group_kind === "sale_product") delete next[group.id];
      }
      for (const group of appliedVariant?.groups ?? []) {
        if (group.group_kind !== "sale_product") continue;
        const option = group.options[0];
        if (option) next[group.id] = [option.id];
      }
      return next;
    });
  }

  function addConfiguredCombo() {
    if (!comboWizard) return;
    const variant = comboWizard.variants.find((candidate) => candidate.id === selectedComboVariantId) ?? comboWizard.variants[0];
    if (!variant) return;
    const groupsById = new Map(comboWizard.variants.flatMap((candidate) => candidate.groups).map((group) => [group.id, group]));
    const choiceDrafts: ComboChoice[] = [];
    for (const [groupId, selected] of Object.entries(comboSelections)) {
      const group = groupsById.get(groupId);
      if (!group) continue;
      const slotSelections = group.group_kind === "pizza"
        ? [...groupsById.values()]
            .filter((candidate) => candidate.group_kind === "pizza" && candidate.sort_order === group.sort_order)
            .flatMap((candidate) => comboSelections[candidate.id] ?? [])
        : [];
      const isHalfSelection = group.group_kind === "pizza" && group.quantity_to_choose === 1 && slotSelections.length === 2;
      for (const optionId of selected) {
        const option = group.options.find((item) => item.id === optionId);
        if (!option) continue;
        const sourceId = group.group_kind === "pizza" ? option.pizza_price_config_id : option.inventory_item_id;
        if (!sourceId) continue;
        choiceDrafts.push({
          variant_id: comboWizard.variants.find((candidate) => candidate.groups.some((candidateGroup) => candidateGroup.id === group.id))?.id,
          group_id: group.id,
          option_id: option.id,
          kind: group.group_kind,
          id: sourceId,
          name: option.name,
          presentation: option.presentation,
          unit_price_cop: option.unit_price_cop,
          pizza_slot_order: group.group_kind === "pizza" ? group.sort_order : undefined,
          is_half: isHalfSelection
        });
      }
    }
    for (const group of variant.groups) {
      const selectedForGroup = group.group_kind === "pizza"
        ? choiceDrafts.filter((choice) => choice.kind === "pizza" && groupsById.get(choice.group_id)?.sort_order === group.sort_order).length
        : choiceDrafts.filter((choice) => choice.group_id === group.id).length;
      const selectedCount = group.group_kind === "pizza" && group.quantity_to_choose === 1 && selectedForGroup === 2 && choiceDrafts
        .filter((choice) => choice.kind === "pizza" && groupsById.get(choice.group_id)?.sort_order === group.sort_order)
        .every((choice) => choice.is_half)
        ? 1
        : selectedForGroup;
      if (group.is_required && selectedCount !== group.quantity_to_choose) {
        setStockNotice(`Selecciona ${group.quantity_to_choose} opcion(es) en ${group.name}.`);
        return;
      }
    }
    const choices = choiceDrafts.map((choice) => ({
      ...choice,
      applied_variant_id: variant.id,
      applied_variant_name: variant.name,
      line_key: cartLineKey()
    }));
    const pairedHalfChoices = new Map<number, ComboChoice[]>();
    for (const choice of choices) {
      if (choice.kind !== "pizza" || !choice.is_half || choice.pizza_slot_order === undefined) continue;
      const pair = pairedHalfChoices.get(choice.pizza_slot_order) ?? [];
      pair.push(choice);
      pairedHalfChoices.set(choice.pizza_slot_order, pair);
    }
    if ([...pairedHalfChoices.values()].some((pair) => pair.length !== 2)) {
      setStockNotice("Selecciona los dos sabores de la pizza mitad y mitad.");
      return;
    }
    for (const pair of pairedHalfChoices.values()) pair[1].line_key = pair[0].line_key;
    const componentChoices: ComboComponentDraft[] = [];
    for (const choice of choices) {
      if (choice.kind !== "pizza" || !choice.is_half || choice.pizza_slot_order === undefined) {
        componentChoices.push({ primary: choice, secondary: null });
        continue;
      }
      const pair = pairedHalfChoices.get(choice.pizza_slot_order) ?? [];
      if (pair[0] === choice) componentChoices.push({ primary: pair[0], secondary: pair[1] });
    }
    const normalPrice = componentChoices.reduce(
      (sum, component) => sum + Math.max(component.primary.unit_price_cop, component.secondary?.unit_price_cop ?? 0),
      0
    );
    const comboUnitPrice = variant.sale_price_cop;
    const comboSavings = Math.max(0, normalPrice - comboUnitPrice);
    const comboPriceAdjustment = comboUnitPrice - normalPrice;
    const comboInstanceId = editingComboLineKey ?? cartLineKey();
    const weightTotal = componentChoices.reduce(
      (sum, component) => sum + Math.max(1, component.primary.unit_price_cop, component.secondary?.unit_price_cop ?? 0),
      0
    );
    let allocated = 0;
    const nextLines = componentChoices.map(({ primary: choice, secondary }, index) => {
      const isLast = index === componentChoices.length - 1;
      const componentNormalPrice = Math.max(choice.unit_price_cop, secondary?.unit_price_cop ?? 0);
      const componentNetPrice = isLast ? comboUnitPrice - allocated : Math.round((comboUnitPrice * Math.max(1, componentNormalPrice)) / Math.max(1, weightTotal));
      allocated += componentNetPrice;
      const common = {
        combo_instance_id: comboInstanceId,
        combo_config_id: comboWizard.id,
        combo_variant_id: variant.id,
        combo_variant_name: variant.name,
        combo_name: comboWizard.name,
        combo_sku: comboWizard.sku,
        combo_choices: choices,
        combo_normal_price_cop: normalPrice,
        combo_savings_cop: comboSavings,
        combo_price_adjustment_cop: comboPriceAdjustment,
        combo_unit_price_cop: comboUnitPrice,
        combo_component_normal_price_cop: componentNormalPrice,
        combo_component_label: choice.name,
        combo_is_primary: index === 0,
        unit_price_cop: componentNetPrice,
        additions: [],
        notes: `COMBO ${comboWizard.sku}`
      };
      if (choice.kind === "pizza") {
        const price = pizzaPriceById.get(choice.id);
        const pizza = pizzas.find((item) => item.prices.some((candidate) => candidate.id === choice.id));
        const pizzaPresentation = choice.presentation ?? price?.size_name ?? null;
        return {
          ...common,
          key: choice.line_key!,
          signature: "",
          kind: "pizza" as const,
          id: choice.id,
          secondary_id: secondary?.id ?? null,
          name: `${choice.name}${secondary ? ` / ${secondary.name}` : ""}${pizzaPresentation ? ` ${pizzaPresentation}` : ""}`,
          sku: price?.sku ?? null,
          image_src: pizza?.image_src ?? comboWizard.image_src,
          removed_components: [],
          removed_ingredient_keys: [],
          base_override: null
        };
      }
      const product = saleProductById.get(choice.id);
      return {
        ...common,
        key: choice.line_key!,
        signature: "",
        kind: "sale_product" as const,
        id: choice.id,
        name: comboOptionLabel(choice),
        sku: product?.sku ?? null,
        image_src: product?.image_src ?? comboWizard.image_src
      };
    }).map((line) => ({ ...line, signature: productKey(line) }));

    if (editingComboLineKey) {
      const previousQuantity = cart.find((item) => item.combo_instance_id === editingComboLineKey)?.quantity ?? 1;
      setCart((current) => [...current.filter((item) => item.combo_instance_id !== editingComboLineKey), ...nextLines.map((line) => ({ ...line, quantity: previousQuantity }))]);
    } else {
      setCart((current) => [...current, ...nextLines.map((line) => ({ ...line, quantity: 1 }))]);
    }
    setComboWizard(null);
    setComboSelections({});
    setEditingComboLineKey(null);
    setStockNotice("");
  }

  function updateQuantity(key: string, delta: number) {
    const line = cart.find((item) => item.key === key);
    if (line?.combo_instance_id) {
      const groupLines = cart.filter((item) => item.combo_instance_id === line.combo_instance_id);
      if (delta > 0) {
        const blocked = !allowPendingStock ? groupLines.find((item) => item.kind === "sale_product" && item.quantity >= saleProductStock(item.id)) : undefined;
        if (blocked) {
          setStockNotice(stockMessage(blocked.id));
          return;
        }
      }
      setStockNotice("");
      setCart((current) =>
        current
          .map((item) => (item.combo_instance_id === line.combo_instance_id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item))
          .filter((item) => item.quantity > 0)
      );
      return;
    }
    if (!allowPendingStock && line?.kind === "sale_product" && delta > 0 && line.quantity >= saleProductStock(line.id)) {
      setStockNotice(stockMessage(line.id));
      return;
    }
    setStockNotice("");
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  function baseOptionsForLine(line: CartLine) {
    if (line.kind !== "pizza") return [];
    const sizeId = pizzaPriceById.get(line.id)?.size_id;
    return sizeId ? baseOptions.filter((option) => option.pizza_size_id === sizeId) : [];
  }

  function defaultBaseForLine(line: CartLine) {
    return baseOptionsForLine(line).find((option) => option.is_default) ?? null;
  }

  function selectedBaseForLine(line: CartLine) {
    const options = baseOptionsForLine(line);
    if (!line.base_override) return options.find((option) => option.is_default) ?? null;
    return options.find((option) => option.source_kind === line.base_override?.source_kind && option.source_id === line.base_override?.source_id) ?? null;
  }

  function validBaseOverrideForSize(sizeId: string, override: PizzaBaseOverride | null | undefined) {
    if (!override) return null;
    const option = baseOptions.find((item) => item.pizza_size_id === sizeId && item.source_kind === override.source_kind && item.source_id === override.source_id);
    return option?.is_default ? null : option ? override : null;
  }

  function applyBaseOverride(lineKey: string, option: PosPizzaBaseOption) {
    setCart((current) => {
      const line = current.find((item) => item.key === lineKey);
      if (!line || line.kind !== "pizza") return current;
      const nextLine: CartLine = {
        ...line,
        base_override: option.is_default ? null : { source_kind: option.source_kind, source_id: option.source_id }
      };
      const nextSignature = productKey(nextLine);
      const withoutCurrent = current.filter((item) => item.key !== lineKey);
      const matching = withoutCurrent.find((item) => item.signature === nextSignature);
      if (matching) {
        return withoutCurrent.map((item) => item.key === matching.key ? { ...item, quantity: item.quantity + line.quantity } : item);
      }
      return [...withoutCurrent, { ...nextLine, key: line.key, signature: nextSignature }];
    });
    setBaseLineKey(null);
  }

  function updateActiveCardScale(delta: number) {
    const update = (value: number) => Math.min(maxCardScale, Math.max(minCardScale, value + delta));
    if (tab === "pizzas") {
      setPizzaCardScale(update);
      return;
    }
    setProductCardScale(update);
  }

  const payload = cart.map((line) => ({
    line_key: line.key,
    kind: line.kind,
    id: line.id,
    name: line.name,
    secondary_id: line.secondary_id ?? null,
    quantity: line.quantity,
    unit_price_cop: line.unit_price_cop,
    notes: line.notes ?? "",
    removed_components: line.removed_components ?? [],
    base_override: line.base_override ?? null,
    combo_instance_id: line.combo_instance_id ?? null,
    combo_config_id: line.combo_config_id ?? null,
    combo_variant_id: line.combo_variant_id ?? null,
    combo_variant_name: line.combo_variant_name ?? null,
    combo_name: line.combo_name ?? null,
    combo_sku: line.combo_sku ?? null,
    combo_choices: line.combo_choices ?? [],
    combo_normal_price_cop: line.combo_normal_price_cop ?? 0,
    combo_savings_cop: line.combo_savings_cop ?? 0,
    combo_price_adjustment_cop: line.combo_price_adjustment_cop ?? 0,
    combo_unit_price_cop: line.combo_unit_price_cop ?? 0,
    combo_component_normal_price_cop: line.combo_component_normal_price_cop ?? 0,
    combo_component_label: line.combo_component_label ?? null,
    combo_is_primary: Boolean(line.combo_is_primary),
    direct_sale: line.direct_sale ?? null,
    additions: line.additions.map((addition) => ({
      id: addition.id,
      quantity: addition.quantity,
      scope: addition.scope,
      scope_label: addition.scope_label ?? null
    }))
  }));

  async function openInventoryPreview() {
    const inventoryPayload = payload.filter((line) => line.kind !== "direct_sale");
    if (inventoryPayload.length === 0) {
      setInventoryPreviewOpen(true);
      setInventoryPreviewLoading(false);
      setInventoryPreviewError("La venta libre no genera consumo de inventario.");
      setInventoryPreview(null);
      return;
    }
    setInventoryPreviewOpen(true);
    setInventoryPreviewLoading(true);
    setInventoryPreviewError("");
    setInventoryPreview(null);
    const result = await getPosInventoryConsumptionPreview(
      JSON.stringify(inventoryPayload),
      JSON.stringify(packagingEntries.map((entry) => ({
        inventory_item_id: entry.inventory_item_id,
        quantity_base: entry.quantity_base
      })))
    );
    setInventoryPreviewLoading(false);
    if (result.status === "error" || !result.preview) {
      setInventoryPreviewError(result.message);
      return;
    }
    setInventoryPreview(result.preview);
  }
  const baseLine = baseLineKey ? cart.find((line) => line.key === baseLineKey && line.kind === "pizza") ?? null : null;
  const baseLineSize = baseLine ? pizzaPriceById.get(baseLine.id) ?? null : null;
  const baseLineDefault = baseLine ? defaultBaseForLine(baseLine) : null;
  const baseLineOptions = baseLine ? baseOptionsForLine(baseLine) : [];
  const hasInvalidSaleProductPrice = cart.some((line) => line.kind === "sale_product" && (!Number.isFinite(line.unit_price_cop) || line.unit_price_cop <= 0));
  const hasInvalidDirectSale = cart.some((line) => line.kind === "direct_sale" && (!line.direct_sale || line.unit_price_cop <= 0 || line.direct_sale.acquisition_unit_cost_cop < 0));
  const hasDirectSales = cart.some((line) => line.kind === "direct_sale");
  const directSalesOnPlatform = hasDirectSales && Boolean(platformPayment);
  const cartEntries: Array<{ kind: "combo"; id: string; primary: CartLine; lines: CartLine[] } | { kind: "line"; line: CartLine }> = [];
  const renderedComboInstances = new Set<string>();
  for (const line of cart) {
    if (line.combo_instance_id) {
      if (renderedComboInstances.has(line.combo_instance_id)) continue;
      const lines = cart.filter((item) => item.combo_instance_id === line.combo_instance_id);
      const primary = lines.find((item) => item.combo_is_primary) ?? lines[0];
      cartEntries.push({ kind: "combo", id: line.combo_instance_id, primary, lines });
      renderedComboInstances.add(line.combo_instance_id);
    } else {
      cartEntries.push({ kind: "line", line });
    }
  }

  function handleOrderSubmit(event: FormEvent<HTMLFormElement>) {
    if (cashSubmitLockRef.current) return;
    if (cart.length === 0 || hasInvalidSaleProductPrice || hasInvalidDirectSale || hasInvalidPlatformPricing || directSalesOnPlatform) return;
    event.preventDefault();
    setPrintNotice("");
    if (paymentMethod === "cash") {
      if (cashConfirmed) return;
      setCashReceived("");
      setCashSelectedOption(null);
      setCashSubmitting(false);
      cashSubmitLockRef.current = false;
      setCashModalOpen(true);
      return;
    }
    if (paymentConfirmed) return;
    setPaymentSubmitting(false);
    setPaymentConfirmModalOpen(true);
  }

  function confirmNonCashPayment() {
    if (cashSubmitLockRef.current) return;
    cashSubmitLockRef.current = true;
    submittedPaymentMethodRef.current = paymentMethod;
    setPaymentConfirmed(true);
    setPaymentSubmitting(true);
    setPaymentConfirmModalOpen(false);
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  }
  function confirmCashPayment(received: number) {
    if (received < total) return;
    if (cashSubmitLockRef.current) return;
    cashSubmitLockRef.current = true;
    submittedPaymentMethodRef.current = "cash";
    flushSync(() => {
      setCashReceived(String(received));
      setCashConfirmed(true);
      setCashSubmitting(true);
      setCashSelectedOption(null);
      setCashModalOpen(false);
    });
    formRef.current?.requestSubmit();
  }

  function closeCashModal() {
    setCashModalOpen(false);
    setCashReceived("");
    setCashConfirmed(false);
    setCashSubmitting(false);
    setCashSelectedOption(null);
    submittedPaymentMethodRef.current = null;
    cashSubmitLockRef.current = false;
  }

  function closePaymentConfirmModal() {
    setPaymentConfirmModalOpen(false);
    setPaymentConfirmed(false);
    setPaymentSubmitting(false);
    submittedPaymentMethodRef.current = null;
    cashSubmitLockRef.current = false;
  }

  function openDiscountModal() {
    setDiscountType(discount?.type ?? "percentage");
    setDiscountInput(discount ? String(discount.value) : "");
    setDiscountModalOpen(true);
  }

  function applyDiscount() {
    if (discountError || subtotal <= 0) return;
    setDiscount({ type: discountType, value: parsedDiscountInput, amount_cop: previewDiscountCop });
    setDiscountModalOpen(false);
  }

  return (
    <>
      <form action={action} className="pos-layout" onSubmit={handleOrderSubmit} ref={formRef}>
        <input name="items" type="hidden" value={JSON.stringify(payload)} />
        <input name="packaging_adjustments" type="hidden" value={JSON.stringify(packagingEntries.map((entry) => ({ inventory_item_id: entry.inventory_item_id, quantity_base: entry.quantity_base })))} />
        <input name="kind" type="hidden" value={orderKind} />
        <input name="pickup_mode" type="hidden" value={pickupMode} />
        <input name="table_id" type="hidden" value={orderKind === "local" ? tableId : ""} />
        <input name="payment_method" type="hidden" value={paymentMethod} />
        <input name="source_channel" type="hidden" value={orderChannel} />
        <input name="collection_party" type="hidden" value={platformPayment ? "platform" : "business"} />
        <input name="platform_service" type="hidden" value={orderChannel === "rappi" ? "rappi_standard" : orderChannel === "didi" ? didiService : "none"} />
        <input name="sale_date" type="hidden" value={canEditSaleDate ? saleDate : ""} />
        <input name="customer_name" type="hidden" value={customerName} />
        <input name="customer_phone" type="hidden" value={customerPhone} />
        <input name="discount_type" type="hidden" value={platformPayment ? "none" : discount?.type ?? "none"} />
        <input name="discount_value" type="hidden" value={platformPayment ? 0 : discount?.value ?? 0} />
        <input name="discount_cop" type="hidden" value={platformPayment ? 0 : discountCop} />
        <input name="delivery_cop" type="hidden" value={deliveryValue} />
        <input name="cash_received_cop" type="hidden" value={paymentMethod === "cash" ? cashReceivedValue : 0} />
        <input name="cash_change_cop" type="hidden" value={paymentMethod === "cash" ? cashChange : 0} />
        <input name="platform_line_pricing" type="hidden" value={platformPayment ? JSON.stringify(platformLinePricingPayload) : ""} />
        <input name="notes" type="hidden" value={notes} />

        <section className="pos-catalog-panel">
          <div className="pos-catalog-toolbar">
            <div className="pos-tabs">
              <button className={tab === "pizzas" ? "active" : ""} onClick={() => setTab("pizzas")} type="button">Pizzas</button>
              <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")} type="button">Productos</button>
              <button className={tab === "combos" ? "active" : ""} onClick={() => setTab("combos")} type="button">Combos</button>
              <button className="pos-direct-sale-button" onClick={() => setDirectSaleOpen(true)} type="button"><PackagePlus size={16} /> Venta libre</button>
              <PendingPaymentsButton paidTodayPayments={paidTodayPayments} pendingPayments={pendingPayments} />
              <button
                aria-label="Configurar vista de productos"
                className="pos-products-settings-button"
                onClick={() => setProductSettingsOpen(true)}
                title="Configurar vista de productos"
                type="button"
              >
                <Settings size={17} />
              </button>
            </div>
            <label className="pos-search">
              <Search size={18} />
              <input
                list={tab === "pizzas" ? "pos-pizza-suggestions" : tab === "products" ? "pos-product-suggestions" : "pos-combo-suggestions"}
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
            <datalist id="pos-combo-suggestions">
              {comboSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
            </datalist>
          </div>

          <div className={`pos-product-grid pos-card-scale-${activeCardScale}`}>
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
              : tab === "products" ? filteredProducts.map((product) => (
                  <button
                    className="pos-product-card pos-sale-product-card"
                    disabled={product.sale_price_cop <= 0 || (!allowPendingStock && saleProductCartQuantity(product.id) >= saleProductStock(product.id))}
                    key={product.id}
                    onClick={() => addSaleProduct(product)}
                    type="button"
                  >
                    <ProductImage alt={product.name} src={product.image_src} />
                    <span className="pos-product-title">{product.name}</span>
                    <strong className="pos-product-presentation">{product.presentation ?? "Sin presentacion"}</strong>
                    <small className={product.sale_price_cop > 0 ? "pos-product-price" : "danger-text"}>
                      {product.sale_price_cop > 0 ? `Precio: ${formatCop(product.sale_price_cop)}` : "Sin precio de venta"}
                    </small>
                    {productViewSettings.showCost ? <small>{formatPosUnitCost(product.unit_cost_cop)}</small> : null}
                    {productViewSettings.showStock ? <small className="pos-product-stock">Stock: {formatStockQuantity(product.stock_base, product.unit)}</small> : null}
                  </button>
                ))
              : filteredCombos.map((combo) => (
                  <button
                    className="pos-product-card pos-combo-card"
                    disabled={combo.variants.length === 0}
                    key={combo.id}
                    onClick={() => openComboWizard(combo)}
                    type="button"
                  >
                    <ComboCardVisual combo={combo} />
                    <span className="pos-product-title">{combo.name}</span>
                    <span className="pos-product-meta">{combo.description ?? "Elige sabores para conocer el precio del combo."}</span>
                    <span className="pos-combo-card-cta">Elegir combo</span>
                  </button>
                ))}
            {(tab === "pizzas" ? filteredPizzas.length : tab === "products" ? filteredProducts.length : filteredCombos.length) === 0 ? <p className="empty-state">Sin resultados.</p> : null}
          </div>
          {stockNotice ? <p className="form-status error">{stockNotice}</p> : null}
          {(tab === "pizzas" ? filteredPizzas.length : tab === "products" ? filteredProducts.length : filteredCombos.length) > 0 ? (
            <div className="pos-card-size-controls" aria-label={`Tamano de tarjetas de ${tab === "pizzas" ? "pizzas" : "productos"}`}>
              <button disabled={activeCardScale === minCardScale} onClick={() => updateActiveCardScale(-1)} type="button"><Minus size={18} /></button>
              <span>Tarjetas</span>
              <button disabled={activeCardScale === maxCardScale} onClick={() => updateActiveCardScale(1)} type="button"><Plus size={18} /></button>
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
            <div className={`pos-local-service ${orderKind === "local" ? "active" : ""}`}>
              <button onClick={() => setOrderKind("local")} type="button"><Store size={15} />Local</button>
              {orderKind === "local" ? <label aria-label="Mesa" className="pos-table-selector"><select aria-label="Mesa" onChange={(event) => setTableId(event.target.value)} value={tableId}><option value="">S/M</option>{orderTables.map((table, index) => <option key={table.id} value={table.id}>{`M${index + 1}`}</option>)}</select></label> : null}
            </div>
            <button className={orderKind === "pickup" && pickupMode === "pickup" ? "active" : ""} onClick={() => { setOrderKind("pickup"); setPickupMode("pickup"); setTableId(""); }} type="button"><ShoppingBag size={15} />Recoger</button>
            <button className={orderKind === "pickup" && pickupMode === "takeaway" ? "active" : ""} onClick={() => { setOrderKind("pickup"); setPickupMode("takeaway"); setTableId(""); }} type="button"><PackagePlus size={15} />Llevar</button>
            <button className={orderKind === "delivery" ? "active" : ""} onClick={() => { setOrderKind("delivery"); setTableId(""); }} type="button"><Truck size={15} />Domicilio</button>
          </div>

          <div className="pos-cart-lines">
            {cartEntries.map((entry) => {
              if (entry.kind === "combo") {
                const { primary, lines } = entry;
                return (
                  <article className="pos-cart-line pos-combo-cart-group" key={entry.id}>
                    <div className="pos-combo-cart-content">
                      <span className="pos-cart-line-title">
                        <strong>{primary.combo_name ?? primary.name}</strong>
                        <button aria-label={`Editar combo ${primary.combo_name ?? primary.name}`} className="icon-button" onClick={() => openEditComboWizard(primary)} title="Editar combo" type="button"><Pencil size={14} /></button>
                      </span>
                      <small>{primary.combo_sku ?? "Sin SKU"} · combo</small>
                      {primary.combo_variant_name ? <small>Grupo aplicado: {primary.combo_variant_name}</small> : null}
                      <small>Precio normal: {formatCop(primary.combo_normal_price_cop ?? 0)}</small>
                      {primary.combo_price_adjustment_cop && primary.combo_price_adjustment_cop !== 0 ? (
                        <small>{primary.combo_price_adjustment_cop > 0 ? "Ajuste combo" : "Descuento combo"}: {primary.combo_price_adjustment_cop > 0 ? "+" : "-"}{formatCop(Math.abs(primary.combo_price_adjustment_cop))}</small>
                      ) : null}
                      <small>Precio combo: {formatCop(primary.combo_unit_price_cop ?? lines.reduce((sum, item) => sum + item.unit_price_cop, 0))}</small>
                      <div className="pos-combo-component-list" aria-label="Componentes del combo">
                        {lines.map((component) => (
                          <small className="pos-combo-component-row" key={component.key}>
                            <span>{component.name} ({formatCop(component.combo_component_normal_price_cop ?? component.unit_price_cop)})</span>
                            {component.kind === "pizza" ? (
                              <button aria-label={`Personalizar ${component.name}`} className="icon-button" onClick={() => openEditPizzaWizard(component)} title="Personalizar pizza del combo" type="button"><Pencil size={13} /></button>
                            ) : null}
                          </small>
                        ))}
                      </div>
                      {lines.flatMap((component) => component.additions.map((addition) => (
                        <small key={`${component.key}-${addition.key}`}>{component.name}: {additionLabel(addition)} +{formatCop(addition.quantity * addition.unit_price_cop)}</small>
                      )))}
                    </div>
                    <div className="pos-qty-controls pos-combo-cart-actions" aria-label={`Acciones de ${primary.combo_name ?? primary.name}`}>
                      <button onClick={() => updateQuantity(primary.key, 1)} title="Aumentar" type="button"><Plus size={16} /></button>
                      <strong aria-label={`Cantidad ${primary.quantity}`}>{primary.quantity}</strong>
                      <button aria-label={primary.quantity === 1 ? `Quitar combo ${primary.combo_name ?? primary.name}` : `Disminuir ${primary.combo_name ?? primary.name}`} onClick={() => updateQuantity(primary.key, -1)} title={primary.quantity === 1 ? "Quitar combo" : "Disminuir"} type="button"><Minus size={16} /></button>
                    </div>
                  </article>
                );
              }
              const line = entry.line;
              return (
              <article className="pos-cart-line" key={line.key}>
                <div className="pos-cart-line-content">
                  <span className="pos-cart-line-title">
                    <strong>{line.name}</strong>
                    {line.kind === "pizza" ? (
                      <button
                        aria-label={`Editar pizza ${line.name}`}
                        className="icon-button"
                        onClick={() => openEditPizzaWizard(line)}
                        title="Editar pizza"
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : line.kind === "combo" ? (
                      <button
                        aria-label={`Editar combo ${line.name}`}
                        className="icon-button"
                        onClick={() => openEditComboWizard(line)}
                        title="Editar combo"
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                  </span>
                  {line.kind === "sale_product" ? <small>{line.sku ?? "Sin SKU"}</small> : null}
                  {line.kind === "direct_sale" ? <small>Venta libre · sin movimiento de inventario</small> : null}
                  {line.kind === "direct_sale" ? <small>Costo compra: {formatCop((line.direct_sale?.acquisition_unit_cost_cop ?? 0) * line.quantity)} · {line.direct_sale?.funds_origin === "cash_session" ? "Dinero de caja" : "Dinero externo"}</small> : null}
                  {line.kind === "combo" ? (
                    <>
                      <small>{line.sku ?? "Sin SKU"} · combo</small>
                      {(line.combo_choices ?? []).map((choice) => (
                        <small key={`${choice.group_id}-${choice.option_id}`}>Incluye: {choice.name}</small>
                      ))}
                      {line.combo_savings_cop && line.combo_savings_cop > 0 ? <small>Ahorras {formatCop(line.combo_savings_cop)}</small> : null}
                    </>
                  ) : null}
                  {line.kind === "pizza" ? (() => {
                    const defaultBase = defaultBaseForLine(line);
                    const selectedBase = selectedBaseForLine(line);
                    const substituted = Boolean(selectedBase && defaultBase && (selectedBase.source_kind !== defaultBase.source_kind || selectedBase.source_id !== defaultBase.source_id));
                    return (
                      <span className="pos-cart-base">
                        <small>{substituted ? `Base usada: ${selectedBase?.source_name}` : `Base: ${defaultBase?.source_name ?? "Sin configurar"}`}</small>
                        <button aria-label={`Cambiar base utilizada para ${line.name}`} className="icon-button" onClick={() => setBaseLineKey(line.key)} title="Cambiar base utilizada" type="button"><Edit3 size={14} /></button>
                      </span>
                    );
                  })() : null}
                  {line.notes ? <small>{line.notes}</small> : null}
                  {line.additions.map((addition) => (
                    <small key={addition.key}>{additionLabel(addition)} +{formatCop(addition.quantity * addition.unit_price_cop)}</small>
                  ))}
                  <span className="pos-cart-line-price">{line.unit_price_cop > 0 ? formatCop(line.unit_price_cop) : "Sin precio"}</span>
                </div>
                <div className="pos-qty-controls">
                  <button
                    disabled={!allowPendingStock && line.kind === "sale_product" && line.quantity >= saleProductStock(line.id)}
                    onClick={() => updateQuantity(line.key, 1)}
                    title={!allowPendingStock && line.kind === "sale_product" && line.quantity >= saleProductStock(line.id) ? stockMessage(line.id) : "Aumentar"}
                    type="button"
                  ><Plus size={16} /></button>
                  <strong aria-label={`Cantidad ${line.quantity}`}>{line.quantity}</strong>
                  <button aria-label={line.quantity === 1 ? `Quitar ${line.name}` : `Disminuir ${line.name}`} onClick={() => updateQuantity(line.key, -1)} title={line.quantity === 1 ? "Quitar" : "Disminuir"} type="button"><Minus size={16} /></button>
                </div>
              </article>
              );
            })}
            {cart.length === 0 ? <p className="empty-state">Toca una pizza o producto para empezar.</p> : null}
          </div>

          {orderKind === "local" && (customerName || customerPhone) ? (
            <div className="pos-customer-compact">
              <span>
                Cliente: <strong>{customerName || customerPhone}</strong>
              </span>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => setCustomerModalOpen(true)} type="button">Editar</button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setCustomerName("");
                    setCustomerPhone("");
                  }}
                  type="button"
                >
                  Quitar
                </button>
              </div>
            </div>
          ) : orderKind !== "local" ? (
            <div className="pos-client-grid">
              <input onChange={(event) => setCustomerName(uppercaseMasterName(event.target.value))} placeholder="Cliente opcional" value={customerName} />
              <input inputMode="tel" onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Telefono" value={customerPhone} />
              {orderKind === "delivery" ? (
                <input inputMode="numeric" onChange={(event) => setDelivery(event.target.value.replace(/\D/g, ""))} placeholder="Domicilio" value={delivery} />
              ) : null}
            </div>
          ) : null}
          <textarea onChange={(event) => setNotes(uppercaseMasterName(event.target.value))} placeholder="Observaciones" rows={1} value={notes} />

          {packagingEntries.length > 0 ? <section className="pos-packaging-summary" aria-label="Empaques previstos">
            <header><PackagePlus size={14} /><strong>Empaques</strong><span>Incluidos en el costo</span></header>
            <div>
              {packagingEntries.map((entry) => <label key={entry.inventory_item_id}>
                <span title={entry.automatic_quantity_base > 0 ? `Automático: ${formatInteger(entry.automatic_quantity_base)}` : entry.name}><PackagePlus size={13} />{entry.name}</span>
                <button aria-label={`Reducir ${entry.name}`} disabled={entry.quantity_base <= 0} onClick={() => setPackagingQuantities((current) => ({ ...current, [entry.inventory_item_id]: Math.max(0, entry.quantity_base - 1) }))} type="button"><Minus size={13} /></button>
                <strong>{formatInteger(entry.quantity_base)}</strong>
                <button aria-label={`Agregar ${entry.name}`} onClick={() => setPackagingQuantities((current) => ({ ...current, [entry.inventory_item_id]: entry.quantity_base + 1 }))} type="button"><Plus size={13} /></button>
              </label>)}
            </div>
          </section> : null}

          <fieldset className="pos-payment-fieldset">
            <legend>Forma de pago</legend>
            <div className="pos-payment-grid">
              {(["cash", "transfer", "mixed", "pending", "rappi", "didi"] as PaymentMethod[]).map((method) => {
                const Icon = paymentIcon(method);
                const selected = method === "rappi" ? orderChannel === "rappi" : method === "didi" ? orderChannel === "didi" : orderChannel === "direct" && paymentMethod === method;
                return <button className={selected ? "active" : ""} key={method} onClick={() => {
                  if (method === "rappi") {
                    setOrderChannel("rappi");
                    setPaymentMethod("rappi");
                  } else if (method === "didi") {
                    setOrderChannel("didi");
                    setDidiCollectionParty("platform");
                    setPaymentMethod("didi");
                  } else {
                    setOrderChannel("direct");
                    setPaymentMethod(method);
                  }
                  if (method === "rappi" || method === "didi") {
                    setDiscount(null);
                    setDiscountInput("");
                    setDiscountModalOpen(false);
                  }
                }} type="button">
                  <Icon size={15} /><span>{paymentLabel(method)}</span>
                </button>;
              })}
            </div>
          </fieldset>
          {orderChannel === "didi" ? <section className="pos-didi-service-panel" aria-label="Configuración del servicio DiDi">
            <fieldset><legend>Servicio DiDi</legend><div className="pos-didi-choice-grid"><button aria-pressed={didiService === "didi_standard"} className={didiService === "didi_standard" ? "active" : ""} onClick={() => setDidiService("didi_standard")} type="button"><CheckCircle2 aria-hidden="true" size={15} /><span>DiDi Food</span></button><button aria-pressed={didiService === "didi_tu_negocio"} className={didiService === "didi_tu_negocio" ? "active" : ""} onClick={() => setDidiService("didi_tu_negocio")} type="button"><CheckCircle2 aria-hidden="true" size={15} /><span>DiDi Tu Negocio</span></button></div></fieldset>
            <fieldset><legend>¿Quién paga?</legend><div className="pos-didi-choice-grid"><button aria-pressed={didiCollectionParty === "business"} className={didiCollectionParty === "business" ? "active" : ""} onClick={() => { setDidiCollectionParty("business"); setPaymentMethod("cash"); }} type="button"><CheckCircle2 aria-hidden="true" size={15} /><span>Mensajero</span></button><button aria-pressed={didiCollectionParty === "platform"} className={didiCollectionParty === "platform" ? "active" : ""} onClick={() => { setDidiCollectionParty("platform"); setPaymentMethod("didi"); }} type="button"><CheckCircle2 aria-hidden="true" size={15} /><span>Cliente por DiDi</span></button></div></fieldset>
            {didiCollectionParty === "business" ? <fieldset><legend>Pago recibido por la tienda</legend><div className="pos-didi-choice-grid">{(["cash", "transfer", "mixed", "pending"] as PaymentMethod[]).map((method) => <button aria-pressed={paymentMethod === method} className={paymentMethod === method ? "active" : ""} key={method} onClick={() => setPaymentMethod(method)} type="button"><CheckCircle2 aria-hidden="true" size={15} /><span>{paymentLabel(method)}</span></button>)}</div></fieldset> : null}
          </section> : null}
          {platformPayment ? (
            <section className="pos-platform-estimate" aria-label={`Liquidación estimada de ${paymentLabel(platformPayment)}`}>
              <h2>Liquidación estimada</h2>
              <div className="pos-platform-table-wrap">
                <table className="pos-platform-table">
                  <thead><tr><th>Producto × Cantidad</th><th>Venta unit.</th><th>Importe</th></tr></thead>
                  <tbody>{platformSettlementEntries.map((line) => (
                    <tr key={line.cart_line_key}>
                      <td><strong>{line.name}</strong><small>{line.quantity} ×{line.detail ? ` · ${line.detail}` : ""}</small></td>
                      <td>{line.cart_line_key === "__delivery__" ? <strong>{formatCop(line.final_unit_cop)}</strong> : (
                        <div className="pos-platform-unit-input">
                          <span aria-hidden="true">$</span>
                          <input aria-label={`Venta unitaria de ${line.name}`} inputMode="numeric" onChange={(event) => {
                            if (!platformPayment) return;
                            const value = Number(event.target.value.replace(/\D/g, "") || 0);
                            setPlatformLineUnitPriceOverrides((current) => ({
                              ...current,
                              [platformOverrideKey]: { ...current[platformOverrideKey], [line.cart_line_key]: value }
                            }));
                          }} value={formatInteger(line.final_unit_cop)} />
                          <button aria-label={`Restablecer venta unitaria de ${line.name}`} className="icon-button pos-platform-unit-reset" onClick={() => {
                            if (!platformPayment) return;
                            setPlatformLineUnitPriceOverrides((current) => {
                              const remaining = { ...current[platformOverrideKey] };
                              delete remaining[line.cart_line_key];
                              return { ...current, [platformOverrideKey]: remaining };
                            });
                          }} title="Restablecer valor sugerido" type="button"><RotateCcw size={15} /></button>
                        </div>
                      )}</td>
                      <td><strong>{formatCop(line.final_cop)}</strong></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {hasInvalidPlatformPricing ? <small className="text-danger">La venta unitaria no puede superar el precio original.</small> : null}
            </section>
          ) : null}
          {didiTuNegocioChargeSetting && didiCollectionParty === "business" ? (
            <section className="pos-didi-billing-estimate" aria-label="Factura estimada de DiDi Tu Negocio">
              <h2>Factura DiDi estimada</h2>
              <span>Venta cobrada por la tienda <strong>{formatCop(total)}</strong></span>
              <span>Monto de facturación DiDi <strong>-{formatCop(didiTuNegocioBillingChargeCop)}</strong></span>
              <span className="pos-didi-billing-net">Neto después de DiDi <strong>{formatCop(didiTuNegocioNetAfterBillingCop)}</strong></span>
              <small>El cobro completo se registra según la forma de pago elegida; la comisión queda pendiente de pago a DiDi.</small>
            </section>
          ) : null}

          {!platformPayment ? <button className="pos-discount-action" disabled={subtotal <= 0} onClick={openDiscountModal} type="button">
            <BadgePercent size={17} /> {discount ? "Editar descuento" : "Aplicar descuento"}
          </button> : null}
          <div className="pos-total-box">
            {platformPayment ? <>
              <span className="pos-subtotal-line">Subtotal <strong>{formatCop(platformSubtotalCop)}</strong></span>
              <span className="pos-discount-line">Comisiones <strong>-{formatCop(platformCommissionCop)}</strong></span>
              <span>Total esperado <strong>{formatCop(platformNetExpectedCop)}</strong></span>
            </> : <>
              {comboPriceAdjustmentCop !== 0 ? <span className="pos-subtotal-line">Subtotal componentes <strong>{formatCop(subtotalBeforeComboDiscount)}</strong></span> : null}
              {comboPriceAdjustmentCop !== 0 ? <span className={comboPriceAdjustmentCop > 0 ? "pos-subtotal-line" : "pos-discount-line"}>{comboPriceAdjustmentCop > 0 ? "Ajuste combo" : "Descuento combo"} <strong>{comboPriceAdjustmentCop > 0 ? "+" : "-"}{formatCop(Math.abs(comboPriceAdjustmentCop))}</strong></span> : null}
              {discount ? <span className="pos-subtotal-line">Subtotal <strong>{formatCop(subtotal)}</strong></span> : null}
              {discount ? <span className="pos-discount-line">{discountLabel} <strong>-{formatCop(discountCop)}</strong></span> : null}
              <span>Total <strong>{formatCop(total)}</strong></span>
            </>}
          </div>
          {discount ? (
            <div className="pos-discount-actions">
              <button className="ghost-button" onClick={openDiscountModal} type="button"><Pencil size={14} /> Editar</button>
              <button className="ghost-button" onClick={() => setDiscount(null)} type="button"><X size={14} /> Quitar descuento</button>
            </div>
          ) : null}
          {state.status !== "idle" ? (
            <p className={`form-status ${state.status}`}>
              {state.status === "success" && state.order ? `Pedido ${state.order.code} confirmado por ${formatCop(state.order.total_cop)}.` : state.message}
            </p>
          ) : null}
          {printNotice ? <p className="form-status error">{printNotice}</p> : null}
          {hasInvalidSaleProductPrice ? <p className="form-status error">Hay productos sin precio de venta configurado.</p> : null}
          {directSalesOnPlatform ? <p className="form-status error">La venta libre se confirma por caja, transferencia o pendiente; no se puede liquidar como Rappi o DiDi.</p> : null}
          {hasInvalidPlatformPricing ? <p className="form-status error">Corrige los precios unitarios de plataforma antes de registrar el pedido.</p> : null}
          <div className="pos-final-actions">
            <button className="ghost-button pos-client-action-button" onClick={() => setCustomerModalOpen(true)} type="button">
              {customerName || customerPhone ? "Editar cliente" : "+ Agregar cliente"}
            </button>
            <SubmitOrderButton disabled={cart.length === 0 || hasInvalidSaleProductPrice || hasInvalidDirectSale || hasInvalidPlatformPricing || directSalesOnPlatform} />
          </div>
          <button className="ghost-button pos-inventory-preview-action" disabled={cart.length === 0} onClick={() => void openInventoryPreview()} type="button">
            <PackageSearch size={16} /> Ver consumo de inventario
          </button>
          {canRecordPendingStock ? (
            <label className="pos-pending-stock-toggle">
              <input checked={allowPendingStock} name="allow_pending_stock" onChange={(event) => setAllowPendingStock(event.target.checked)} type="checkbox" value="true" />
              <span>Registrar faltantes pendientes de regularización</span>
            </label>
          ) : null}
          {canEditSaleDate ? (
            <section className="pos-sale-date" aria-label="Fecha de venta">
              <label htmlFor="pos-sale-date">Fecha de venta</label>
              <div>
                <input id="pos-sale-date" max={todayBogota()} onChange={(event) => setSaleDate(event.target.value)} type="date" value={saleDate} />
                <button className="ghost-button" onClick={() => setSaleDate(todayBogota())} type="button">Restablecer</button>
              </div>
            </section>
          ) : null}
        </aside>
      </form>

      {directSaleOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Agregar venta libre" aria-modal="true" className="modal-panel pos-direct-sale-modal" role="dialog">
            <header className="modal-header">
              <div><strong>Venta libre</strong><span>Se registra sin movimientos de inventario.</span></div>
              <button className="icon-button" onClick={() => { setDirectSaleOpen(false); setDirectSaleError(""); }} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="form-grid pos-direct-sale-grid">
              {directSaleQuickActions.length ? <label className="field pos-direct-sale-observation"><span>Acción rápida</span><select onChange={(event) => { const selected = directSaleQuickActions[Number(event.target.value)]; if (selected) setDirectSaleDraft({ ...selected, quantity: "1" }); }} defaultValue=""><option value="">Seleccionar referencia guardada</option>{directSaleQuickActions.map((item, index) => <option key={`${item.name}-${index}`} value={index}>{item.name} · {formatCop(Number(item.sale_unit_price_cop || 0))}</option>)}</select></label> : null}
              <label className="field"><span>Producto existente</span><select onChange={(event) => selectDirectSaleProduct(event.target.value)} value={directSaleDraft.inventory_item_id}><option value="">Producto sin registro previo</option>{saleProducts.map((product) => <option key={product.id} value={product.id}>{product.name}{product.presentation ? ` · ${product.presentation}` : ""}</option>)}</select></label>
              <label className="field"><span>Producto</span><input onChange={(event) => setDirectSaleDraft((current) => ({ ...current, name: uppercaseMasterName(event.target.value) }))} placeholder="Nombre del artículo" value={directSaleDraft.name} /></label>
              <label className="field"><span>Cantidad</span><input inputMode="decimal" min="1" onChange={(event) => setDirectSaleDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" value={directSaleDraft.quantity} /></label>
              <label className="field"><span>Precio de venta unitario</span><input inputMode="numeric" onChange={(event) => setDirectSaleDraft((current) => ({ ...current, sale_unit_price_cop: event.target.value.replace(/\D/g, "") }))} placeholder="$ 0" value={directSaleDraft.sale_unit_price_cop} /></label>
              <label className="field"><span>Costo de compra unitario</span><input inputMode="decimal" onChange={(event) => setDirectSaleDraft((current) => ({ ...current, acquisition_unit_cost_cop: event.target.value.replace(/[^\d,]/g, "") }))} placeholder="$ 0" value={directSaleDraft.acquisition_unit_cost_cop} /></label>
              <label className="field"><span>Origen del dinero</span><select onChange={(event) => setDirectSaleDraft((current) => ({ ...current, funds_origin: event.target.value as DirectFundsOrigin }))} value={directSaleDraft.funds_origin}><option value="cash_session">Dinero de caja</option><option value="external">Dinero externo</option></select></label>
              <label className="field pos-direct-sale-observation"><span>Observación</span><textarea onChange={(event) => setDirectSaleDraft((current) => ({ ...current, observation: event.target.value }))} placeholder="Referencia opcional" value={directSaleDraft.observation} /></label>
            </div>
            {directSaleError ? <p className="form-status error">{directSaleError}</p> : null}
            <footer className="modal-actions"><button className="ghost-button" onClick={() => setDirectSaleOpen(false)} type="button">Cancelar</button><button className="ghost-button" onClick={saveDirectSaleQuickAction} type="button">Guardar rápida</button><button className="positive-button" onClick={addDirectSale} type="button">Agregar al pedido</button></footer>
          </section>
        </div>
      ) : null}

      {stockShortageModalOpen && state.stockShortages?.length ? (
        <StockShortageModal
          allowPendingRegularization={allowPendingStock}
          onClose={() => setStockShortageModalOpen(false)}
          onContinueWithPendingRegularization={() => {
            setStockShortageModalOpen(false);
            window.setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          onChooseAlternativeBase={(linePosition) => {
            const line = cart[linePosition - 1];
            if (line?.kind === "pizza") {
              setStockShortageModalOpen(false);
              setBaseLineKey(line.key);
            }
          }}
          onOpenProduction={() => window.open("/panel/produccion", "_blank", "noopener,noreferrer")}
          onOpenPurchases={() => window.open("/panel/compras", "_blank", "noopener,noreferrer")}
          shortages={state.stockShortages}
        />
      ) : null}

      {inventoryPreviewOpen ? (
        <InventoryConsumptionPreviewModal
          error={inventoryPreviewError}
          loading={inventoryPreviewLoading}
          onClose={() => setInventoryPreviewOpen(false)}
          preview={inventoryPreview}
          presentationByInventoryId={new Map(saleProducts.filter((product) => product.presentation).map((product) => [product.id, product.presentation!]))}
        />
      ) : null}

      {productSettingsOpen ? (
        <ProductViewSettingsModal
          canEditPizzaPhotos={isSystemAdmin && canConfigurePizzaPhotos}
          onChange={setProductViewSettings}
          onClose={() => setProductSettingsOpen(false)}
          pizzas={pizzas}
          settings={productViewSettings}
        />
      ) : null}

      {baseLine && baseLineSize && baseLineDefault ? (
        <PizzaBaseSelectorModal
          defaultBase={baseLineDefault}
          onClose={() => setBaseLineKey(null)}
          onSelect={(option) => applyBaseOverride(baseLine.key, option)}
          options={baseLineOptions}
          selectedBase={selectedBaseForLine(baseLine)}
          sizeName={baseLineSize.size_name}
        />
      ) : null}

      {comboWizard ? (
        <ComboSelectorModal
          combo={comboWizard}
          variantId={selectedComboVariantId}
          onPizzaClear={clearComboPizza}
          onPizzaSelect={selectComboPizza}
          onAdd={addConfiguredCombo}
          onClose={() => {
            setComboWizard(null);
            setComboSelections({});
            setSelectedComboVariantId(null);
            setEditingComboLineKey(null);
          }}
          pizzas={pizzas}
          selections={comboSelections}
        />
      ) : null}

      {wizard ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label={wizard.editingLineKey ? "Editar pizza" : "Configurar pizza"} aria-modal="true" className="modal-panel pos-pizza-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>{wizard.editingLineKey ? "Editar pizza" : "Configurar pizza"}</strong>
                <span>{wizard.step === "summary" ? "Resumen final" : "Selecciona las opciones"}</span>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setIngredientModalOpen(false);
                  setWizard(null);
                }}
                title="Cerrar"
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="pos-wizard-body">
              {wizard.step !== "summary" ? <PizzaSummary wizard={wizard} unitPrice={wizardUnitPrice} additions={selectedAdditionsList} /> : null}

              {wizard.step === "size" ? (
                <WizardStep title="Tamano">
                  {wizard.editingLineKey ? (
                    <div className="pos-edit-flavor-picker">
                      <h4>Sabor</h4>
                      <select onChange={(event) => {
                        const nextFlavor = pizzas.find((pizza) => pizza.flavor_id === event.target.value);
                        if (nextFlavor) selectWizardFlavor(nextFlavor);
                      }} value={wizard.flavor.flavor_id}>
                        {pizzas.map((pizza) => <option key={pizza.flavor_id} value={pizza.flavor_id}>{pizza.flavor_name}</option>)}
                      </select>
                    </div>
                  ) : null}
                  <div className="pos-option-grid">
                    {wizard.flavor.prices.filter((price) => price.is_active).map((price) => (
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
                      onClick={() => {
                        setSelectedAdditions({});
                        setAdditionScopes({});
                        setWizard({
                          ...wizard,
                          mode: "whole",
                          secondFlavor: null,
                          removedIngredientKeys: [],
                          step: "summary"
                        });
                      }}
                      type="button"
                    >
                      <span className="pizza-type-illustration whole" />
                      <strong>Pizza entera</strong>
                      <span>{formatCop(selectedPizzaPrice.price_cop ?? 0)}</span>
                    </button>
                    {halfAvailable ? (
                      <button
                        className={wizard.mode === "half" ? "pos-type-card selected" : "pos-type-card"}
                        onClick={() => {
                          setSelectedAdditions({});
                          setAdditionScopes({});
                          setWizard({ ...wizard, mode: "half", removedIngredientKeys: [], step: "half" });
                        }}
                        type="button"
                      >
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
                              setSelectedAdditions({});
                              setAdditionScopes({});
                              setWizard({ ...wizard, secondFlavor: pizza, removedIngredientKeys: [], step: "summary" });
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

              {wizard.step === "summary" ? (
                <WizardStep onBack={() => setWizard({ ...wizard, step: previousStepForSummary(wizard) })} title="Resumen final">
                  <FinalPizzaSummary
                    additions={selectedAdditionsList}
                    customizationAvailable={wizardIngredientChoices.length > 0 || compatibleAdditions.length > 0}
                    onChangeQuantity={(quantity) => setWizard({ ...wizard, quantity })}
                    onOpenIngredients={() => setIngredientModalOpen(true)}
                    removedNotes={wizardRemovedNotes}
                    unitPrice={wizardUnitPrice}
                    wizard={wizard}
                  />
                </WizardStep>
              ) : null}
            </div>

            <div className="form-actions modal-form-actions pos-wizard-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setIngredientModalOpen(false);
                  setWizard(null);
                }}
                type="button"
              >
                Cancelar
              </button>
              {wizard.step === "summary" && !wizard.editingLineKey ? (
                <button className="ghost-button" onClick={addConfiguredPizzaAndOpenProducts} type="button">Agregar bebida</button>
              ) : null}
              {wizard.step === "summary" ? (
                <button className="positive-button" onClick={() => addConfiguredPizza()} type="button">{wizard.editingLineKey ? "Guardar cambios" : "Agregar al pedido"}</button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {customerModalOpen ? (
        <div className="modal-backdrop nested-modal-backdrop" role="presentation">
          <section aria-label="Agregar cliente" aria-modal="true" className="modal-panel compact-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Cliente opcional</strong>
                <span>Datos rapidos para identificar el pedido.</span>
              </div>
              <button className="icon-button" onClick={() => setCustomerModalOpen(false)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="compact-card">
              <div className="form-grid">
                <div className="field">
                  <label>Nombre</label>
                  <input onChange={(event) => setCustomerName(uppercaseMasterName(event.target.value))} placeholder="Cliente" value={customerName} />
                </div>
                <div className="field">
                  <label>Telefono</label>
                  <input inputMode="tel" onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Telefono" value={customerPhone} />
                </div>
              </div>
              <div className="form-actions modal-form-actions">
                <button
                  className="ghost-button"
                  onClick={() => {
                    setCustomerName("");
                    setCustomerPhone("");
                    setCustomerModalOpen(false);
                  }}
                  type="button"
                >
                  Quitar
                </button>
                <button className="primary-button" onClick={() => setCustomerModalOpen(false)} type="button">Guardar</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {discountModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Aplicar descuento" aria-modal="true" className="modal-panel pos-discount-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Aplicar descuento</strong>
                <span>Se descuenta del valor comercial del pedido.</span>
              </div>
              <button className="icon-button" onClick={() => setDiscountModalOpen(false)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="pos-discount-modal-body">
              <div className="pos-discount-type-tabs" role="tablist" aria-label="Tipo de descuento">
                <button className={discountType === "percentage" ? "active" : ""} onClick={() => { setDiscountType("percentage"); setDiscountInput(""); }} role="tab" type="button">Porcentaje %</button>
                <button className={discountType === "amount" ? "active" : ""} onClick={() => { setDiscountType("amount"); setDiscountInput(""); }} role="tab" type="button">Monto $</button>
              </div>
              <label className="pos-discount-input">
                <span>Valor</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  onChange={(event) => setDiscountInput(discountType === "amount" ? event.target.value.replace(/\D/g, "") : event.target.value.replace(/[^\d,.]/g, ""))}
                  placeholder={discountType === "percentage" ? "Ej. 10" : "Ej. 5000"}
                  value={discountInput}
                />
              </label>
              <div className="pos-discount-preview" aria-live="polite">
                <span>Subtotal <strong>{formatCop(subtotal)}</strong></span>
                <span>Descuento{discountType === "percentage" && Number.isFinite(parsedDiscountInput) ? ` ${parsedDiscountInput}%` : ""} <strong>-{formatCop(Math.max(0, Number.isFinite(previewDiscountCop) ? previewDiscountCop : 0))}</strong></span>
                <span className="total">TOTAL <strong>{formatCop(Math.max(0, subtotal - Math.max(0, Number.isFinite(previewDiscountCop) ? previewDiscountCop : 0) + deliveryValue))}</strong></span>
              </div>
              {discountError ? <p className="form-status error">{discountError}</p> : null}
            </div>
            <footer className="modal-footer">
              <button className="secondary-button" onClick={() => setDiscountModalOpen(false)} type="button">Cancelar</button>
              <button className="primary-button" disabled={Boolean(discountError) || subtotal <= 0} onClick={applyDiscount} type="button">Aplicar descuento</button>
            </footer>
          </section>
        </div>
      ) : null}

      {wizard && ingredientModalOpen ? (
        <PizzaCustomizationModal
          activeScopes={additionScopes}
          additions={compatibleAdditions}
          choices={wizardIngredientChoices}
          onClose={() => setIngredientModalOpen(false)}
          onChangeAddition={(id, scope, quantity) =>
            setSelectedAdditions((current) => {
              const key = additionSelectionKey(id, scope);
              if (quantity <= 0) {
                const next = { ...current };
                delete next[key];
                return next;
              }
              return { ...current, [key]: quantity };
            })
          }
          onChangeScope={(id, scope) => setAdditionScopes((current) => ({ ...current, [id]: scope }))}
          onToggle={(key) =>
            setWizard((current) => {
              if (!current) return current;
              const removed = current.removedIngredientKeys.includes(key)
                ? current.removedIngredientKeys.filter((item) => item !== key)
                : [...current.removedIngredientKeys, key];
              return { ...current, removedIngredientKeys: removed };
            })
          }
          removedKeys={wizard.removedIngredientKeys}
          selectedAdditions={selectedAdditions}
          wizard={wizard}
        />
      ) : null}

      {cashModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Cobro en efectivo" aria-modal="true" className="modal-panel cash-payment-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Cobro en efectivo</strong>
                <span>Confirma el dinero recibido antes de registrar el pedido.</span>
              </div>
              <button className="icon-button" onClick={closeCashModal} title="Cerrar" type="button"><X size={18} /></button>
            </header>

            <div className="cash-payment-body">
              <div className="cash-payment-header">
                <div className="cash-total-display">
                  <span>Total a pagar</span>
                  <strong>{formatCop(total)}</strong>
                </div>
                <button
                  className={["cash-exact-button", cashSelectedOption === "exact" ? "selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => {
                    setCashReceived(String(total));
                    setCashSelectedOption("exact");
                    confirmCashPayment(total);
                  }}
                  disabled={cashSubmitting}
                  type="button"
                >
                  <Banknote size={34} />
                  <span>Pago exacto</span>
                  {cashSelectedOption === "exact" ? <CheckCircle2 size={22} /> : null}
                </button>
              </div>

              <section className="cash-other-amounts" aria-label="Otros montos">
                <strong>Otros montos</strong>

                <div className="cash-section-title">
                  <Zap size={16} />
                  <span>Montos rapidos</span>
                </div>
                <div className="cash-denomination-grid">
                  {validCashDenominations.map((amount) => (
                    <button
                      className={[
                        "cash-denomination suggested",
                        cashSelectedOption === `denomination:${amount}` ? "selected" : ""
                      ].filter(Boolean).join(" ")}
                      key={amount}
                      onClick={() => {
                        setCashReceived(String(amount));
                        setCashSelectedOption(`denomination:${amount}`);
                      }}
                      type="button"
                    >
                      <span>{formatCop(amount)}</span>
                      {cashSelectedOption === `denomination:${amount}` ? <CheckCircle2 size={20} /> : null}
                    </button>
                  ))}
                </div>

                {cashSuggestions.length > 0 ? (
                  <section className="cash-suggestions" aria-label="Sugerencias rapidas">
                    <div className="cash-section-title">
                      <Star size={16} />
                      <span>Sugerencias rapidas</span>
                    </div>
                    <div className="cash-denomination-grid">
                      {cashSuggestions.map((amount) => (
                        <button
                          className={[
                            "cash-denomination suggested",
                            cashSelectedOption === `suggestion:${amount}` ? "selected" : ""
                          ].filter(Boolean).join(" ")}
                          key={amount}
                          onClick={() => {
                            setCashReceived(String(amount));
                            setCashSelectedOption(`suggestion:${amount}`);
                          }}
                          type="button"
                        >
                          <span>{formatCop(amount)}</span>
                          {cashSelectedOption === `suggestion:${amount}` ? <CheckCircle2 size={20} /> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                <label className="field cash-manual-amount">
                  <span>Otro monto</span>
                  <div className="cash-manual-input">
                    <WalletCards size={22} />
                    <input
                      inputMode="numeric"
                      onChange={(event) => {
                        setCashReceived(event.target.value.replace(/\D/g, ""));
                        setCashSelectedOption(null);
                      }}
                      placeholder="Ingresar monto"
                      value={cashReceived}
                    />
                    {cashReceived ? (
                      <button
                        aria-label="Limpiar monto"
                        onClick={() => {
                          setCashReceived("");
                          setCashSelectedOption(null);
                        }}
                        type="button"
                      >
                        <X size={16} />
                      </button>
                    ) : null}
                  </div>
                </label>
              </section>

              <div className="cash-change-summary">
                <span className="cash-summary-received">
                  <ReceiptText size={22} />
                  Recibido:<strong>{cashReceivedValue > 0 ? formatCop(cashReceivedValue) : "-"}</strong>
                </span>
                <span className="cash-summary-change">
                  <Repeat2 size={26} />
                  Cambio:<strong>{cashReceivedValue >= total ? formatCop(cashChange) : "-"}</strong>
                </span>
              </div>
              {cashReceivedValue > 0 && cashReceivedValue < total ? <p className="form-status error">El monto recibido no cubre el total.</p> : null}
            </div>

            <footer className="form-actions modal-form-actions cash-payment-footer">
              <div className="cash-payment-footer-left">
                <PaymentPrintSelector onChange={setPrintSelection} value={printSelection} />
                <button className="ghost-button" onClick={closeCashModal} type="button">Cancelar</button>
              </div>
              <button className="positive-button" disabled={cashReceivedValue < total || cashSubmitting} onClick={() => confirmCashPayment(cashReceivedValue)} type="button">
                {cashSubmitting ? "Registrando..." : "Registrar pago"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {paymentConfirmModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label={isPendingPayment ? "Registrar pedido pendiente" : "Confirmar pago"} aria-modal="true" className="modal-panel cash-payment-modal payment-confirmation-modal" role="dialog">
            <header className="modal-header">
              <div><strong>{isPendingPayment ? "Registrar pedido pendiente" : "Confirmar pago"}</strong><span>{isPendingPayment ? "El pedido quedará pendiente de cobro." : "Verifica el pago antes de registrar el pedido."}</span></div>
              <button className="icon-button" onClick={closePaymentConfirmModal} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="payment-confirmation-body">
              <div className="cash-total-display"><span>{platformPayment ? "Total esperado" : "Total a registrar"}</span><strong>{formatCop(registrationTotalCop)}</strong></div>
              <div className="payment-confirmation-method"><span>{isPendingPayment ? "Estado de cobro" : "Método de pago"}</span><strong>{paymentLabel(paymentMethod)}</strong></div>
            </div>
            <footer className="form-actions modal-form-actions cash-payment-footer">
              <div className="cash-payment-footer-left">
                <PaymentPrintSelector onChange={setPrintSelection} value={printSelection} />
                <button className="ghost-button" onClick={closePaymentConfirmModal} type="button">Cancelar</button>
              </div>
              <button className="positive-button" disabled={paymentSubmitting} onClick={confirmNonCashPayment} type="button">{paymentSubmitting ? "Registrando..." : isPendingPayment ? "Registrar pedido pendiente" : "Registrar pago"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {printJob ? <PostPaymentPrintJob job={printJob} onClose={() => setPrintJob(null)} onError={setPrintNotice} /> : null}
    </>
  );
}

function PaymentPrintSelector({ onChange, value }: { onChange: (value: PaymentPrintSelection) => void; value: PaymentPrintSelection }) {
  return (
    <fieldset className="payment-print-selector">
      <legend>Imprimir:</legend>
      <label><input checked={value.kitchen} onChange={(event) => onChange({ ...value, kitchen: event.target.checked })} type="checkbox" /> Comanda</label>
      <label><input checked={value.receipt} onChange={(event) => onChange({ ...value, receipt: event.target.checked })} type="checkbox" /> Ticket</label>
    </fieldset>
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
      {additions.length > 0 ? <small>{additions.map(additionLabel).join(", ")}</small> : null}
      <b>{formatCop(unitPrice)}</b>
    </aside>
  );
}

function FinalPizzaSummary({
  wizard,
  unitPrice,
  additions,
  customizationAvailable,
  removedNotes,
  onChangeQuantity,
  onOpenIngredients
}: {
  wizard: PizzaWizard;
  unitPrice: number;
  additions: CartAddition[];
  customizationAvailable: boolean;
  removedNotes: string;
  onChangeQuantity: (quantity: number) => void;
  onOpenIngredients: () => void;
}) {
  const total = unitPrice * wizard.quantity;
  return (
    <section className="pos-final-summary">
      <div className="pos-final-hero">
        <PizzaFinalVisual wizard={wizard} />
        <div>
          <span>{wizard.mode === "half" ? "Mitad y mitad" : "Pizza entera"}</span>
          <strong>{wizard.mode === "half" && wizard.secondFlavor ? `${wizard.flavor.flavor_name} / ${wizard.secondFlavor.flavor_name}` : wizard.flavor.flavor_name}</strong>
          <small>{wizard.selectedSize?.size_name ?? "Sin tamano"}</small>
        </div>
      </div>
      <div className="pos-final-grid">
        <span><small>Precio unidad</small><strong>{formatCop(unitPrice)}</strong></span>
        <span className="pos-final-quantity-card">
          <small>Cantidad</small>
          <div className="pos-final-quantity-control">
            <button onClick={() => onChangeQuantity(Math.max(1, wizard.quantity - 1))} type="button"><Minus size={18} /></button>
            <strong>{wizard.quantity}</strong>
            <button onClick={() => onChangeQuantity(wizard.quantity + 1)} type="button"><Plus size={18} /></button>
          </div>
        </span>
      </div>
      {additions.length > 0 ? (
        <div className="pos-final-list">
          <small>Adiciones</small>
          {additions.map((addition) => (
            <span key={addition.key}>{additionLabel(addition)} · {formatCop(addition.quantity * addition.unit_price_cop)}</span>
          ))}
        </div>
      ) : null}
      <div className="pos-final-customize-row">
        <div>
          <small>Ingredientes</small>
          <strong>{removedNotes || "Sin cambios"}</strong>
        </div>
        <button className="ghost-button" disabled={!customizationAvailable} onClick={onOpenIngredients} type="button">
          Personalizar pizza
        </button>
      </div>
      <div className="pos-final-total">
        <span>Total pizza</span>
        <strong>{formatCop(total)}</strong>
      </div>
    </section>
  );
}

function PizzaFinalVisual({ wizard }: { wizard: PizzaWizard }) {
  if (wizard.mode !== "half" || !wizard.secondFlavor) {
    return <ProductImage alt={wizard.flavor.flavor_name} src={wizard.flavor.image_src} />;
  }
  return (
    <div className="pos-half-visual" aria-label={`${wizard.flavor.flavor_name} y ${wizard.secondFlavor.flavor_name}`}>
      <span>
        <ProductImage alt={wizard.flavor.flavor_name} src={wizard.flavor.image_src} />
      </span>
      <span>
        <ProductImage alt={wizard.secondFlavor.flavor_name} src={wizard.secondFlavor.image_src} />
      </span>
    </div>
  );
}

function PizzaCustomizationModal({
  activeScopes,
  additions,
  choices,
  selectedAdditions,
  removedKeys,
  wizard,
  onChangeAddition,
  onChangeScope,
  onToggle,
  onClose
}: {
  activeScopes: Record<string, AdditionScope>;
  additions: PosAdditionOption[];
  choices: PizzaIngredientChoice[];
  selectedAdditions: Record<string, number>;
  removedKeys: string[];
  wizard: PizzaWizard;
  onChangeAddition: (id: string, scope: AdditionScope, quantity: number) => void;
  onChangeScope: (id: string, scope: AdditionScope) => void;
  onToggle: (key: string) => void;
  onClose: () => void;
}) {
  const firstChoices = choices.filter((choice) => choice.side === "first");
  const secondChoices = choices.filter((choice) => choice.side === "second");
  const groups =
    wizard.mode === "half" && wizard.secondFlavor
      ? [
          { title: wizard.flavor.flavor_name, choices: firstChoices },
          { title: wizard.secondFlavor.flavor_name, choices: secondChoices }
        ]
      : [{ title: wizard.flavor.flavor_name, choices: firstChoices }];

  return (
    <div className="modal-backdrop nested-modal-backdrop" role="presentation">
      <section aria-label="Personalizar pizza" aria-modal="true" className="modal-panel pos-ingredient-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>Personalizar pizza</strong>
            <span>Quita ingredientes o agrega adiciones.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-ingredient-modal-body">
          <section className="pos-customization-section">
            <h4>Quitar ingredientes</h4>
            {choices.length === 0 ? (
              <p className="empty-state">Sin ingredientes removibles.</p>
            ) : (
              <div className={groups.length > 1 ? "pos-ingredient-columns" : "pos-ingredient-columns single"}>
                {groups.map((group) => (
                  <section className="pos-ingredient-group" key={group.title}>
                    <h4>{group.title}</h4>
                    <div className="pos-ingredient-table" role="table">
                      <div className="pos-ingredient-table-header" role="row"><span role="columnheader">Ingrediente</span><span role="columnheader">Incluir</span></div>
                      {group.choices.map((choice) => {
                        const checked = !removedKeys.includes(choice.key);
                        return (
                          <label className={checked ? "pos-ingredient-option selected" : "pos-ingredient-option"} key={choice.key}>
                            <span>{choice.source_name}</span>
                            <input aria-label={`${checked ? "Quitar" : "Incluir"} ${choice.source_name}`} checked={checked} onChange={() => onToggle(choice.key)} type="checkbox" />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
          <section className="pos-customization-section">
            <h4>Agregar adiciones</h4>
            {additions.length === 0 ? (
              <p className="empty-state">Sin adiciones compatibles.</p>
            ) : (
              <div className="pos-addition-grid">
                {additions.map((addition) => {
                  const scope = wizard.mode === "half" ? activeScopes[addition.id] ?? "whole" : "whole";
                  const selected = selectedAdditions[additionSelectionKey(addition.id, scope)] ?? 0;
                  const totalSelected = (["whole", "left", "right"] as AdditionScope[]).reduce(
                    (sum, item) => sum + (selectedAdditions[additionSelectionKey(addition.id, item)] ?? 0),
                    0
                  );
                  return (
                    <article className={totalSelected > 0 ? "pos-addition-card active" : "pos-addition-card"} key={addition.id}>
                      <ProductImage alt={addition.name} src={addition.image_src} />
                      <span>{addition.name}</span>
                      <strong>{formatCop(addition.price_cop)}</strong>
                      {wizard.mode === "half" && wizard.secondFlavor ? (
                        <div className="pos-addition-scope-chips" aria-label={`Alcance de ${addition.name}`}>
                          {([
                            ["whole", "Toda"],
                            ["left", "Izquierda"],
                            ["right", "Derecha"]
                          ] as Array<[AdditionScope, string]>).map(([value, label]) => (
                            <button
                              className={scope === value ? "active" : ""}
                              key={value}
                              onClick={() => onChangeScope(addition.id, value)}
                              type="button"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="pos-addition-controls">
                        <button disabled={selected === 0} onClick={() => onChangeAddition(addition.id, scope, Math.max(0, selected - 1))} type="button">
                          <Minus size={16} />
                        </button>
                        <b>{selected}</b>
                        <button disabled={totalSelected >= addition.max_allowed} onClick={() => onChangeAddition(addition.id, scope, selected + 1)} type="button">
                          <Plus size={16} />
                        </button>
                      </div>
                      <small>Max {addition.max_allowed}{totalSelected > 0 ? ` · Total ${totalSelected}` : ""}</small>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <footer className="form-actions modal-form-actions">
          <button className="positive-button" onClick={onClose} type="button">Listo</button>
        </footer>
      </section>
    </div>
  );
}

function selectedAdditionItems(selected: Record<string, number>, compatible: PosAdditionOption[], wizard: PizzaWizard | null) {
  return Object.entries(selected)
    .map(([key, quantity]) => {
      const [id, scopeValue] = key.split(":");
      const scope = (scopeValue === "left" || scopeValue === "right" || scopeValue === "whole" ? scopeValue : "whole") as AdditionScope;
      const addition = compatible.find((item) => item.id === id);
      if (!addition || quantity <= 0) return null;
      const scopeLabel =
        wizard?.mode === "half" && wizard.secondFlavor
          ? scope === "left"
            ? `mitad ${wizard.flavor.flavor_name}`
            : scope === "right"
              ? `mitad ${wizard.secondFlavor.flavor_name}`
              : undefined
          : undefined;
      return {
        key,
        id: addition.id,
        name: addition.name,
        sku: addition.sku,
        quantity,
        unit_price_cop: addition.price_cop,
        scope,
        scope_label: scopeLabel
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

function ComboCardVisual({ combo }: { combo: PosComboOption }) {
  if (combo.image_src) return <ProductImage alt={combo.name} src={combo.image_src} />;

  const componentImages = [...new Set(
    combo.variants.flatMap((variant) => variant.groups.flatMap((group) => group.options.map((option) => option.image_src).filter((src): src is string => Boolean(src))))
  )].slice(0, 2);

  if (componentImages.length === 0) return <span className="pos-product-placeholder">Combo</span>;

  return (
    <span aria-label={`Vista previa de ${combo.name}`} className="pos-combo-image-fallback">
      {componentImages.map((src) => <Image alt="" height={96} key={src} src={src} unoptimized width={96} />)}
    </span>
  );
}

function PizzaBaseSelectorModal({
  defaultBase,
  options,
  selectedBase,
  sizeName,
  onSelect,
  onClose
}: {
  defaultBase: PosPizzaBaseOption;
  options: PosPizzaBaseOption[];
  selectedBase: PosPizzaBaseOption | null;
  sizeName: string;
  onSelect: (option: PosPizzaBaseOption) => void;
  onClose: () => void;
}) {
  const visibleOptions = options.filter((option) => option.is_default || option.available_quantity + 0.0001 >= option.quantity_base);
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Base utilizada" aria-modal="true" className="modal-panel compact-modal pos-base-selector-modal" role="dialog">
        <header className="modal-header">
          <div><strong>Base utilizada</strong><span>Selecciona la fuente que realmente usará cocina.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-base-selector-body">
          <div className="pos-base-context">
            <span>Tamaño vendido</span><strong>{sizeName}</strong>
            <span>Base predeterminada</span><strong>{defaultBase.source_name}</strong>
            <small>Stock: {formatStockQuantity(defaultBase.available_quantity, defaultBase.unit)}</small>
          </div>
          <div className="pos-base-option-list" role="radiogroup" aria-label="Fuentes de base disponibles">
            {visibleOptions.map((option) => {
              const selected = selectedBase?.source_kind === option.source_kind && selectedBase.source_id === option.source_id;
              const available = option.available_quantity + 0.0001 >= option.quantity_base;
              return (
                <button
                  aria-checked={selected}
                  className={`pos-base-option${selected ? " selected" : ""}${available ? "" : " unavailable"}`}
                  disabled={!available}
                  key={`${option.source_kind}:${option.source_id}`}
                  onClick={() => onSelect(option)}
                  role="radio"
                  type="button"
                >
                  <span><strong>{option.source_name}</strong><small>{option.source_kind === "preparation" ? "Masa producida" : "Base comprada"}</small></span>
                  <span><small>Disponible: {formatStockQuantity(option.available_quantity, option.unit)}</small><b>Consumirá: {formatStockQuantity(option.quantity_base, option.unit)}</b>{option.is_default ? <em>Predeterminada</em> : null}{!available ? <em>Agotada</em> : null}</span>
                </button>
              );
            })}
            {visibleOptions.length === 0 ? <p className="empty-state">No hay fuentes de base compatibles disponibles.</p> : null}
          </div>
        </div>
        <footer className="form-actions modal-form-actions"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button></footer>
      </section>
    </div>
  );
}

function ProductViewSettingsModal({
  canEditPizzaPhotos,
  onChange,
  onClose,
  pizzas,
  settings
}: {
  canEditPizzaPhotos: boolean;
  onChange: (settings: ProductViewSettings) => void;
  onClose: () => void;
  pizzas: PosPizzaOption[];
  settings: ProductViewSettings;
}) {
  function updateSetting(key: keyof ProductViewSettings, value: boolean) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="Configuración de productos" aria-modal="true" className="modal-panel compact-modal pos-products-settings-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <strong>Configuración de productos</strong>
            <span>Preferencias guardadas en este navegador.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-products-settings-list">
          <label>
            <input checked={settings.showCost} onChange={(event) => updateSetting("showCost", event.target.checked)} type="checkbox" />
            <span>Mostrar costo</span>
          </label>
          <label>
            <input checked={settings.showStock} onChange={(event) => updateSetting("showStock", event.target.checked)} type="checkbox" />
            <span>Mostrar stock</span>
          </label>
          <label>
            <input checked={settings.showSoldOut} onChange={(event) => updateSetting("showSoldOut", event.target.checked)} type="checkbox" />
            <span>Mostrar productos agotados</span>
          </label>
          {canEditPizzaPhotos ? <PosPizzaImageSettings pizzas={pizzas} /> : null}
        </div>
        <footer className="form-actions modal-form-actions"><button className="positive-button" onClick={onClose} type="button">Listo</button></footer>
      </section>
    </div>
  );
}

function PosPizzaImageSettings({ pizzas }: { pizzas: PosPizzaOption[] }) {
  const [state, action, pending] = useActionState(savePosPizzaImage, initialState);
  const [flavorId, setFlavorId] = useState(pizzas[0]?.flavor_id ?? "");
  const router = useRouter();
  const selectedPizza = pizzas.find((pizza) => pizza.flavor_id === flavorId) ?? null;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="pos-pizza-image-settings">
      <strong>Fotos de pizzas para Pedidos</strong>
      <span>Solo cambian las tarjetas de Crear pedido.</span>
      <input name="flavor_id" type="hidden" value={flavorId} />
      <select aria-label="Pizza" onChange={(event) => setFlavorId(event.target.value)} value={flavorId}>
        {pizzas.map((pizza) => <option key={pizza.flavor_id} value={pizza.flavor_id}>{pizza.flavor_name}</option>)}
      </select>
      {selectedPizza?.image_src ? <Image alt={selectedPizza.flavor_name} className="pos-pizza-image-preview" height={64} src={selectedPizza.image_src} unoptimized width={96} /> : null}
      <input accept="image/jpeg,image/png,image/webp" name="pos_pizza_image" type="file" />
      <div className="form-actions">
        <button className="secondary-button" disabled={pending} name="remove_pos_image" type="submit" value="1">Restablecer</button>
        <button className="positive-button" disabled={pending} type="submit">Guardar foto</button>
      </div>
      {state.status !== "idle" ? <small className={state.status}>{state.message}</small> : null}
    </form>
  );
}

function previewDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(date);
}

function InventoryConsumptionPreviewModal({
  error,
  loading,
  onClose,
  preview,
  presentationByInventoryId
}: {
  error: string;
  loading: boolean;
  onClose: () => void;
  preview: PosInventoryConsumptionPreview | null;
  presentationByInventoryId: Map<string, string>;
}) {
  const [view, setView] = useState<"consolidated" | "detailed">("consolidated");
  const [openOrigins, setOpenOrigins] = useState<string[]>([]);
  const packagingPreview = preview?.packaging ?? [];
  const affectedCount = (preview?.consolidated.length ?? 0) + packagingPreview.length;
  const plannedCount = preview?.lines.reduce((sum, line) => sum + line.consumptions.length, 0) ?? 0;
  const shortages = preview?.shortages ?? [];
  const lineGroups = useMemo(() => {
    const groups = new Map<string, PosInventoryConsumptionPreview["lines"]>();
    for (const line of preview?.lines ?? []) {
      const key = line.notes?.startsWith("COMBO ") ? line.notes : "Pedido actual";
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return [...groups.entries()];
  }, [preview?.lines]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="Vista previa de consumo" aria-modal="true" className="modal-panel pos-inventory-preview-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <strong>Vista previa de inventario</strong>
            <span>Este cálculo es informativo. El inventario no será modificado hasta confirmar el pedido.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-inventory-preview-body">
          {loading ? <p className="form-status">Calculando consumos y orígenes previstos…</p> : null}
          {error ? <p className="form-status error">{error}</p> : null}
          {preview?.status === "insufficient" ? (
            <section className="pos-inventory-preview-alert" role="alert">
              <strong>Este pedido no puede completarse con el inventario actual.</strong>
              <span>Los faltantes coinciden con la validación que bloquearía la confirmación.</span>
            </section>
          ) : null}
          {preview ? (
            <>
              <div className="pos-inventory-preview-stats">
                <span>Productos/ingredientes afectados <strong>{affectedCount}</strong></span>
                <span>Consumos previstos <strong>{plannedCount}</strong></span>
                <span>Alertas de stock <strong>{shortages.length}</strong></span>
              </div>
              {packagingPreview.length > 0 ? (
                <section className="pos-inventory-preview-packaging">
                  <h3>Empaques previstos</h3>
                  <div className="pos-inventory-preview-table-wrap">
                    <table className="pos-inventory-preview-table pos-inventory-preview-packaging-table">
                      <thead><tr><th>Empaque/Insumo</th><th>Stock actual</th><th>Consumirá</th><th>Quedará</th><th /></tr></thead>
                      <tbody>{packagingPreview.map((entry) => <tr key={entry.inventory_item_id}>
                        <td><strong>{entry.name}</strong><small>Empaque / insumo</small></td>
                        <td>{formatPreviewStockQuantity(entry.stock_before, "unit")}</td>
                        <td>{formatPreviewStockQuantity(entry.consumption_quantity, "unit")}</td>
                        <td>{formatPreviewStockQuantity(entry.stock_after, "unit")}</td>
                        <td />
                      </tr>)}</tbody>
                    </table>
                  </div>
                </section>
              ) : null}
              <div className="pos-inventory-preview-tabs" role="tablist" aria-label="Vista de auditoría">
                <button aria-selected={view === "consolidated"} className={view === "consolidated" ? "active" : ""} onClick={() => setView("consolidated")} role="tab" type="button">Consolidado</button>
                <button aria-selected={view === "detailed"} className={view === "detailed" ? "active" : ""} onClick={() => setView("detailed")} role="tab" type="button">Desglosado</button>
              </div>
              {view === "consolidated" ? (
                <div className="pos-inventory-preview-table-wrap">
                  {preview.status === "insufficient" ? <PreviewShortages shortages={shortages} /> : (
                    <table className="pos-inventory-preview-table">
                      <thead><tr><th>Producto / ingrediente</th><th>Stock actual</th><th>Consumirá</th><th>Quedará</th><th /></tr></thead>
                      <tbody>{preview.consolidated.map((item) => {
                        const key = `${item.source_kind}:${item.source_id}`;
                        const expanded = openOrigins.includes(key);
                        return <Fragment key={key}>
                          <tr><td><strong>{item.source_name}</strong><small>{item.source_kind === "preparation" ? "Preparación producida" : presentationByInventoryId.get(item.source_id) ?? "Inventario"}</small></td><td>{formatPreviewStockQuantity(item.stock_before, item.unit)}</td><td>{formatPreviewStockQuantity(item.consumption_quantity, item.unit)}</td><td>{formatPreviewStockQuantity(item.stock_after, item.unit)}</td><td><button className="ghost-button compact-button" onClick={() => setOpenOrigins((current) => expanded ? current.filter((id) => id !== key) : [...current, key])} type="button">{expanded ? "Ocultar origen" : "Ver origen"}</button></td></tr>
                          {expanded ? <tr className="pos-inventory-preview-origins"><td colSpan={5}>{item.origins.map((origin, index) => <OriginPreview key={`${origin.origin_label}:${index}`} origin={origin} unit={item.unit} />)}</td></tr> : null}
                        </Fragment>;
                      })}</tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="pos-inventory-preview-lines">
                  {preview.status === "insufficient" ? <PreviewShortages shortages={shortages} /> : lineGroups.map(([groupName, lines]) => (
                    <section className="pos-inventory-preview-line-group" key={groupName}>
                      <h3>{groupName === "Pedido actual" ? "Pedido actual" : groupName.replace(/^COMBO\s+/, "Combo: ")}</h3>
                      {lines.map((line, lineIndex) => <article className="pos-inventory-preview-line" key={line.order_item_id}>
                        <header><span>{line.item_kind === "pizza" ? `Pizza ${lineIndex + 1}` : "Producto"}</span><strong>{line.quantity}× {line.name}</strong></header>
                        <div>{line.consumptions.map((consumption, consumptionIndex) => <div className="pos-inventory-preview-consumption" key={`${consumption.source_id}:${consumptionIndex}`}><span><strong>{consumption.source_name}</strong><small>{formatPreviewStockQuantity(consumption.quantity_base, consumption.base_unit)} · {consumption.origin_label}</small></span><span>{formatPreviewStockQuantity(consumption.origin_stock_before, consumption.base_unit)} → {formatPreviewStockQuantity(consumption.origin_stock_after, consumption.base_unit)}</span></div>)}</div>
                      </article>)}
                    </section>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <footer className="modal-footer"><button className="secondary-button" onClick={onClose} type="button">Cerrar</button></footer>
      </section>
    </div>
  );
}

function PreviewShortages({ shortages }: { shortages: PosStockShortage[] }) {
  return <div className="pos-inventory-preview-shortages">{shortages.map((shortage) => <article key={`${shortage.source_kind}:${shortage.source_id}`}><strong>{shortage.source_name}</strong><span>Stock actual: {formatPreviewStockQuantity(shortage.available_quantity, shortage.unit)}</span><span>Pedido requiere: {formatPreviewStockQuantity(shortage.requested_quantity, shortage.unit)}</span><b>Faltan: {formatPreviewStockQuantity(shortage.missing_quantity, shortage.unit)}</b></article>)}</div>;
}

function formatPreviewStockQuantity(value: number, unit: StockUnit) {
  if (unit === "g" || unit === "kg") {
    const grams = unit === "kg" ? value * 1000 : value;
    return `${formatColombianNumber(Math.round(grams), 0, 0)} G`;
  }
  return formatStockQuantity(value, unit);
}

function OriginPreview({ origin, unit }: { origin: PosInventoryConsumptionPreview["consolidated"][number]["origins"][number]; unit: StockUnit }) {
  const dates = [origin.purchased_at ? `Compra: ${previewDate(origin.purchased_at)}` : null, origin.elaborated_at ? `Elaboración: ${previewDate(origin.elaborated_at)}` : null, origin.purchase_expiration_date || origin.production_expiration_date ? `Vence: ${previewDate(origin.purchase_expiration_date ?? origin.production_expiration_date)}` : null].filter(Boolean);
  return <div className="pos-inventory-preview-origin"><strong>{origin.origin_label}</strong><span>{dates.join(" · ")}</span><span>Saldo: {formatPreviewStockQuantity(origin.stock_before, unit)} · Consumirá: {formatPreviewStockQuantity(origin.consumption_quantity, unit)} · Quedará: {formatPreviewStockQuantity(origin.stock_after, unit)}</span></div>;
}

function SubmitOrderButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button pos-submit-button" disabled={disabled || pending} type="submit">
      {pending ? "Confirmando..." : "Confirmar pedido"}
    </button>
  );
}

type StockShortageDisplayRow = {
  line_position: number;
  line_kind: "pizza" | "sale_product";
  line_label: string;
  line_quantity: number;
  source_name: string;
  source_category: PosStockShortage["source_category"];
  required_quantity: number;
  available_quantity: number;
  missing_quantity: number;
  unit: StockUnit;
};

function shortageDisplayRows(shortages: PosStockShortage[]) {
  return shortages.flatMap((shortage) => {
    let remainingAvailable = Number(shortage.available_quantity ?? 0);
    return shortage.usages
      .slice()
      .sort((left, right) => left.line_position - right.line_position)
      .map((usage) => {
        const required = Number(usage.requested_quantity ?? 0);
        const available = Math.min(required, Math.max(0, remainingAvailable));
        const missing = Math.max(0, required - available);
        remainingAvailable = Math.max(0, remainingAvailable - required);
        return {
          line_position: usage.line_position,
          line_kind: usage.line_kind,
          line_label: usage.line_label,
          line_quantity: Number(usage.line_quantity ?? 0),
          source_name: shortage.source_name,
          source_category: shortage.source_category,
          required_quantity: required,
          available_quantity: available,
          missing_quantity: missing,
          unit: shortage.unit
        } satisfies StockShortageDisplayRow;
      })
      .filter((row) => row.missing_quantity > 0.0001);
  });
}

function StockShortageTable({ title, entries, onChooseAlternativeBase }: { title: string; entries: StockShortageDisplayRow[]; onChooseAlternativeBase?: (linePosition: number) => void }) {
  if (entries.length === 0) return null;
  const grouped = new Map<string, StockShortageDisplayRow[]>();
  for (const entry of entries) {
    const key = `${entry.line_label}:${entry.line_quantity}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return (
    <section className="stock-shortage-section">
      <h3>{title}</h3>
      {[...grouped.entries()].map(([key, group]) => (
        <div className="stock-shortage-line" key={key}>
          <strong>{group[0].line_label}{group[0].line_kind === "pizza" ? ` x${group[0].line_quantity}` : ""}</strong>
          {group[0].line_kind === "pizza" && onChooseAlternativeBase ? <button className="ghost-button compact-base-choice" onClick={() => onChooseAlternativeBase(group[0].line_position)} type="button">Elegir otra base</button> : null}
          <div className="data-table-wrap">
            <table className="data-table compact-data-table stock-shortage-table">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Requiere</th>
                  <th>Disponible</th>
                  <th>Faltan</th>
                </tr>
              </thead>
              <tbody>
                {group.map((entry) => (
                  <tr key={`${entry.source_category}:${entry.source_name}`}>
                    <td>{entry.source_name}</td>
                    <td>{formatStockQuantity(entry.required_quantity, entry.unit)}</td>
                    <td>{formatStockQuantity(entry.available_quantity, entry.unit)}</td>
                    <td><strong className="danger-text">{formatStockQuantity(entry.missing_quantity, entry.unit)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function ComboSelectorModal({
  combo,
  variantId,
  onPizzaClear,
  selections,
  onPizzaSelect,
  onAdd,
  onClose,
  pizzas
}: {
  combo: PosComboOption;
  variantId: string | null;
  onPizzaClear: (slotOrder: number) => void;
  selections: Record<string, string[]>;
  onPizzaSelect: (slotOrder: number, variantId: string, groupId: string, optionId: string, appendHalf?: boolean) => void;
  onAdd: () => void;
  onClose: () => void;
  pizzas: PosPizzaOption[];
}) {
  const [stepTransitionLabel, setStepTransitionLabel] = useState<string | null>(null);
  const [slotModes, setSlotModes] = useState<Record<number, PizzaMode>>({});
  const allGroups = combo.variants.flatMap((candidate) => candidate.groups.map((group) => ({ candidate, group })));
  const pizzaSlots = (combo.variants[0]?.groups ?? [])
    .filter((group) => group.group_kind === "pizza" && group.is_required)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((templateGroup) => ({
      ...templateGroup,
      choices: allGroups
        .filter(({ group }) => group.group_kind === "pizza" && group.sort_order === templateGroup.sort_order)
        .flatMap(({ candidate, group }) => group.options.map((option) => ({ candidate, group, option })))
    }));
  const selectedChoicesBySlot = pizzaSlots.map((slot) => ({
    slot,
    choices: slot.choices.filter(({ group, option }) => (selections[group.id] ?? []).includes(option.id))
  }));
  const selectedPizzaChoices = selectedChoicesBySlot.flatMap(({ slot, choices }) => choices.map((choice) => ({ slot, ...choice })));
  const slotMode = (slot: typeof pizzaSlots[number]): PizzaMode =>
    selectedChoicesBySlot.find((entry) => entry.slot.sort_order === slot.sort_order)?.choices.length === 2
      ? "half"
      : slotModes[slot.sort_order] ?? "whole";
  const requiredSelectionsForSlot = (slot: typeof pizzaSlots[number]) => slotMode(slot) === "half" ? 2 : 1;
  const slotHasHalfEligibleFlavor = (slot: typeof pizzaSlots[number]) =>
    slot.choices.filter(({ option }) => option.pizza_flavor_id && pizzas.find((pizza) => pizza.flavor_id === option.pizza_flavor_id)?.allows_half_and_half).length >= 2;
  const pizzaSlotPresentation = (slot: typeof pizzaSlots[number]) =>
    slot.choices[0]?.option.presentation?.replace(/-([0-9])/, " - $1")
      ?? slot.name
      ?? "esta pizza";
  const slotIsComplete = (slot: typeof pizzaSlots[number]) => {
    const count = selectedChoicesBySlot.find((entry) => entry.slot.sort_order === slot.sort_order)?.choices.length ?? 0;
    return count === requiredSelectionsForSlot(slot);
  };
  const pendingSlot = pizzaSlots.find((slot) => !slotIsComplete(slot)) ?? null;
  const pendingPizzaTypeSlot = pendingSlot && slotHasHalfEligibleFlavor(pendingSlot)
    ? pendingSlot
    : null;
  const pendingPizzaTypePresentation = pendingPizzaTypeSlot ? pizzaSlotPresentation(pendingPizzaTypeSlot) : "esta pizza";
  const needsPizzaTypeChoice = Boolean(
    pendingPizzaTypeSlot
    && (selectedChoicesBySlot.find((entry) => entry.slot.sort_order === pendingPizzaTypeSlot.sort_order)?.choices.length ?? 0) === 0
    && slotModes[pendingPizzaTypeSlot.sort_order] === undefined
  );
  const appliedVariant = combo.variants
    .filter((candidate) => selectedPizzaChoices.some((choice) => choice.candidate.id === candidate.id))
    .sort((left, right) => right.sale_price_cop - left.sale_price_cop)[0] ?? null;
  const variant = combo.variants.find((candidate) => candidate.id === variantId) ?? appliedVariant;
  const includedProductGroups = (variant?.groups ?? []).filter((group) => group.group_kind === "sale_product" && group.is_required);
  const complete = pizzaSlots.every(slotIsComplete) && includedProductGroups.every((group) => (selections[group.id] ?? []).length === group.quantity_to_choose);
  const selectedPizzas = selectedChoicesBySlot
    .filter(({ choices }) => choices.length > 0)
    .map(({ slot, choices }) => ({
      label: choices.map(({ option }) => comboOptionLabel(option)).join(" / "),
      groupName: [...choices].sort((left, right) => right.candidate.sale_price_cop - left.candidate.sale_price_cop)[0]?.candidate.name ?? "",
      slotName: slot.name,
      isHalf: choices.length === 2
    }));
  const selectedBeverages = includedProductGroups.flatMap((group) =>
    (selections[group.id] ?? []).flatMap((optionId) => {
      const option = group.options.find((candidate) => candidate.id === optionId);
      return option ? [comboOptionLabel(option)] : [];
    })
  );
  const summaryProductGroups = includedProductGroups.length
    ? includedProductGroups
    : (combo.variants[0]?.groups ?? []).filter((group) => group.group_kind === "sale_product" && group.is_required);
  const footerBeverages = summaryProductGroups.flatMap((group) => {
    const selected = (selections[group.id] ?? [])
      .map((optionId) => group.options.find((option) => option.id === optionId))
      .filter((option): option is PosComboOption["variants"][number]["groups"][number]["options"][number] => Boolean(option))
      .map(comboOptionLabel);
    return selected.length ? selected : group.options.length === 1 ? [comboOptionLabel(group.options[0])] : [];
  });
  const minimumComboPrice = combo.variants.reduce((lowest, candidate) => Math.min(lowest, candidate.sale_price_cop), combo.sale_price_cop);
  const totalSteps = pizzaSlots.length + 2 + pizzaSlots.filter(slotHasHalfEligibleFlavor).length + pizzaSlots.filter((slot) => slotMode(slot) === "half").length;
  const currentStep = needsPizzaTypeChoice
    ? 2
    : pendingSlot
    ? 2 + pizzaSlots.filter((slot) => slotHasHalfEligibleFlavor(slot) && slotModes[slot.sort_order] !== undefined).length + selectedChoicesBySlot.reduce((sum, entry) => sum + Math.min(entry.choices.length, requiredSelectionsForSlot(entry.slot)), 0)
    : totalSteps;
  const stepLabel = needsPizzaTypeChoice
    ? "Elige el tipo de pizza"
    : pendingSlot
    ? slotMode(pendingSlot) === "half" && (selectedChoicesBySlot.find((entry) => entry.slot.sort_order === pendingSlot.sort_order)?.choices.length ?? 0) === 1
      ? `Elige el segundo sabor de la pizza: ${pizzaSlotPresentation(pendingSlot)}`
      : `Elige el sabor de la pizza: ${pizzaSlotPresentation(pendingSlot)}`
    : "Revisa tu combo";

  useEffect(() => {
    if (!stepTransitionLabel) return;
    const timeoutId = window.setTimeout(() => setStepTransitionLabel(null), 700);
    return () => window.clearTimeout(timeoutId);
  }, [stepTransitionLabel]);

  function handlePizzaSelect(slotOrder: number, candidateVariantId: string, groupId: string, optionId: string) {
    const slot = pizzaSlots.find((candidate) => candidate.sort_order === slotOrder);
    const selectingHalf = slot ? slotMode(slot) === "half" : false;
    const nextSlot = pizzaSlots.find((slot) => slot.sort_order > slotOrder);
    if (selectingHalf && slot && (selectedChoicesBySlot.find((entry) => entry.slot.sort_order === slotOrder)?.choices.length ?? 0) === 0) {
      setStepTransitionLabel(`el segundo sabor de ${slot.name}`);
    } else if (nextSlot) {
      setStepTransitionLabel(`la pizza: ${pizzaSlotPresentation(nextSlot)}`);
    }
    onPizzaSelect(slotOrder, candidateVariantId, groupId, optionId, selectingHalf);
  }

  function changeSlotMode(slot: typeof pizzaSlots[number], mode: PizzaMode) {
    if ((selectedChoicesBySlot.find((entry) => entry.slot.sort_order === slot.sort_order)?.choices.length ?? 0) > 0) {
      onPizzaClear(slot.sort_order);
    }
    setSlotModes((current) => ({ ...current, [slot.sort_order]: mode }));
  }

  function resetPizzaType(slot: typeof pizzaSlots[number]) {
    onPizzaClear(slot.sort_order);
    setSlotModes((current) => {
      const next = { ...current };
      delete next[slot.sort_order];
      return next;
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Configurar combo" aria-modal="true" className="modal-panel pos-pizza-modal pos-combo-selector-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{combo.name}</strong>
            <span className={stepTransitionLabel ? "pos-combo-step-label is-advancing" : "pos-combo-step-label"}>Paso {currentStep} de {totalSteps} · {stepLabel}</span>
            <small>{combo.description ?? "Elige las opciones del combo."}</small>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-wizard-body pos-combo-wizard-body">
          {needsPizzaTypeChoice && pendingPizzaTypeSlot ? <div className="pos-combo-catalog pos-combo-type-choice">
            <WizardStep title="Elige el tipo de pizza">
              <p className="field-hint">Define c&oacute;mo quieres la pizza: <strong>{pendingPizzaTypePresentation}</strong>.</p>
              <div className="pos-option-grid">
                <button className="pos-type-card" onClick={() => changeSlotMode(pendingPizzaTypeSlot, "whole")} type="button">
                  <span className="pizza-type-illustration whole" />
                  <strong>Pizza entera</strong>
                  <span>Desde {formatCop(minimumComboPrice)}</span>
                </button>
                <button className="pos-type-card" onClick={() => changeSlotMode(pendingPizzaTypeSlot, "half")} type="button">
                  <span className="pizza-type-illustration half" />
                  <strong>Mitad y mitad</strong>
                  <span>Precio del sabor mayor</span>
                </button>
              </div>
            </WizardStep>
          </div> : pendingSlot ? <div className="pos-combo-catalog">
            <WizardStep onBack={slotHasHalfEligibleFlavor(pendingSlot) ? () => resetPizzaType(pendingSlot) : undefined} title={stepLabel}>
              {stepTransitionLabel ? <p aria-live="polite" className="pos-combo-next-pizza-notice" role="status">Ahora elige <strong>{stepTransitionLabel}</strong></p> : null}
              <p className="field-hint">Todos los sabores disponibles.</p>
              <div className={stepTransitionLabel ? "pos-combo-flavor-grid is-advancing" : "pos-combo-flavor-grid"}>
                {pendingSlot.choices
                  .filter(({ option }) => slotMode(pendingSlot) !== "half" || !option.pizza_flavor_id || pizzas.find((pizza) => pizza.flavor_id === option.pizza_flavor_id)?.allows_half_and_half)
                  .filter(({ option }) => !selectedChoicesBySlot.find((entry) => entry.slot.sort_order === pendingSlot.sort_order)?.choices.some((choice) => choice.option.pizza_flavor_id === option.pizza_flavor_id))
                  .map(({ candidate, group, option }) => {
                  const projectedPrice = Math.max(candidate.sale_price_cop, ...selectedPizzaChoices.filter((choice) => choice.slot.sort_order !== pendingSlot.sort_order).map((choice) => choice.candidate.sale_price_cop));
                  return (
                    <button className="pos-product-card pos-second-flavor-card pos-combo-choice-card" key={`${group.id}-${option.id}`} onClick={() => handlePizzaSelect(pendingSlot.sort_order, candidate.id, group.id, option.id)} type="button">
                      <ProductImage alt={option.name} src={option.image_src} />
                      <span className="pos-product-title">{option.name}</span>
                      <strong>Combo {formatCop(projectedPrice)}</strong>
                    </button>
                  );
                })}
              </div>
            </WizardStep>
          </div> : <div className="pos-combo-catalog pos-combo-review-body"><WizardStep title="Revisa tu combo">
            <div className="pos-combo-review-list">
              {selectedPizzas.map((item) => {
                const slot = pizzaSlots.find((candidate) => candidate.name === item.slotName);
                return (
                  <div className="pos-combo-review-row" key={`pizza-${item.slotName}`}>
                    <div><span>{item.slotName}{item.isHalf ? " · Mitad y mitad" : ""}</span><strong>1x {item.label}</strong></div>
                    {slot ? <button className="ghost-button" onClick={() => onPizzaClear(slot.sort_order)} type="button">Cambiar</button> : null}
                  </div>
                );
              })}
              {selectedBeverages.map((item) => (
                <div className="pos-combo-review-row" key={`product-${item}`}>
                  <div><span>Bebida incluida</span><strong>1x {item}</strong></div>
                  <span aria-hidden="true" className="pos-combo-review-action-placeholder" />
                </div>
              ))}
            </div>
          </WizardStep></div>}
        </div>
        <footer className="pos-wizard-footer pos-combo-selector-footer">
          <div className="pos-combo-footer-summary" aria-live="polite">
            {pizzaSlots.map((slot, index) => <div key={slot.id}><span>{slot.name || `Pizza ${index + 1}`}</span><strong>{selectedPizzas[index]?.label ?? "Selecciona un sabor"}</strong></div>)}
            <div><span>Bebida</span><strong>{footerBeverages.length ? footerBeverages.join(" · ") : "Incluida"}</strong></div>
            <div className="pos-combo-footer-price"><span>Precio combo</span><strong>{variant ? formatCop(variant.sale_price_cop) : needsPizzaTypeChoice ? `Desde ${formatCop(minimumComboPrice)}` : "Por definir"}</strong></div>
          </div>
          <div className="pos-combo-footer-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <button className="primary-button" disabled={!complete} onClick={onAdd} type="button">Agregar combo al pedido</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function StockShortageModal({
  allowPendingRegularization,
  shortages,
  onClose,
  onContinueWithPendingRegularization,
  onOpenPurchases,
  onOpenProduction,
  onChooseAlternativeBase
}: {
  allowPendingRegularization: boolean;
  shortages: PosStockShortage[];
  onClose: () => void;
  onContinueWithPendingRegularization: () => void;
  onOpenPurchases: () => void;
  onOpenProduction: () => void;
  onChooseAlternativeBase: (linePosition: number) => void;
}) {
  const rows = shortageDisplayRows(shortages);
  const pizzaRows = rows.filter((row) => row.line_kind === "pizza");
  const productRows = rows.filter((row) => row.line_kind === "sale_product");
  const needsProduction = rows.some((row) => row.source_category === "preparation");
  const needsPurchase = rows.some((row) => row.source_category !== "preparation");

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Stock insuficiente para el pedido" aria-modal="true" className="modal-panel stock-shortage-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>NO HAY SUFICIENTE STOCK PARA ELABORAR ESTE PEDIDO</strong>
            <span>El pedido no fue registrado ni descontado del inventario.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="stock-shortage-body">
          <StockShortageTable entries={pizzaRows} onChooseAlternativeBase={onChooseAlternativeBase} title="Pizzas" />
          <StockShortageTable entries={productRows} title="Productos" />
          {allowPendingRegularization ? (
            <p className="field-hint">La venta descontará únicamente el stock disponible y dejará los faltantes pendientes para asociarlos posteriormente a una compra. No creará compras.</p>
          ) : <>
            <p className="field-hint danger">No es posible confirmar el pedido hasta completar el stock requerido.</p>
            {needsPurchase ? <p className="field-hint">Para ingredientes, bases o productos: registra una compra o ajuste de inventario.</p> : null}
            {needsProduction ? <p className="field-hint">Para preparaciones: registra una producción o ingreso histórico/ajuste de la preparación.</p> : null}
          </>}
        </div>
        <footer className="form-actions modal-form-actions">
          <button className="ghost-button" onClick={onClose} type="button">Cerrar</button>
          {allowPendingRegularization ? <button className="positive-button" onClick={onContinueWithPendingRegularization} type="button">Continuar con faltantes</button> : <>
            {needsPurchase ? <button className="primary-button" onClick={onOpenPurchases} type="button">Ir a Compras</button> : null}
            {needsProduction ? <button className="positive-button" onClick={onOpenProduction} type="button">Ir a Producción</button> : null}
          </>}
        </footer>
      </section>
    </div>
  );
}

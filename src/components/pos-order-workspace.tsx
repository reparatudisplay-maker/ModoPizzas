"use client";

import Image from "next/image";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { BadgePercent, Banknote, CheckCircle2, ChevronLeft, Edit3, Minus, Pencil, Plus, ReceiptText, Repeat2, Search, Settings, ShoppingCart, Star, Trash2, WalletCards, X, Zap } from "lucide-react";
import { createPosOrder, type PosOrderActionState, type PosStockShortage } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

type OrderKind = "local" | "pickup" | "delivery";
type PaymentMethod = "cash" | "card" | "transfer" | "mixed" | "pending";
type DiscountType = "percentage" | "amount";

type AppliedDiscount = {
  type: DiscountType;
  value: number;
  amount_cop: number;
};
type CatalogTab = "pizzas" | "products" | "combos";
type PizzaStep = "size" | "type" | "half" | "summary";
type PizzaMode = "whole" | "half";
type AdditionScope = "whole" | "left" | "right";

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

type PizzaBaseOverride = Pick<PosPizzaBaseOption, "source_kind" | "source_id">;

export type PosComboOption = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_src: string | null;
  sale_price_cop: number;
  normal_price_cop: number;
  groups: Array<{
    id: string;
    name: string;
    group_kind: "pizza" | "sale_product";
    quantity_to_choose: number;
    is_required: boolean;
    pizza_size_id: string | null;
    options: Array<{
      id: string;
      name: string;
      image_src: string | null;
      pizza_flavor_id: string | null;
      pizza_price_config_id: string | null;
      inventory_item_id: string | null;
      unit_price_cop: number;
      supplement_cop: number;
    }>;
  }>;
};

type ComboChoice = {
  group_id: string;
  option_id: string;
  kind: "pizza" | "sale_product";
  id: string;
  name: string;
  unit_price_cop: number;
  supplement_cop: number;
  line_key?: string;
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
  kind: "pizza" | "sale_product" | "combo";
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
  combo_name?: string | null;
  combo_sku?: string | null;
  combo_choices?: ComboChoice[];
  combo_normal_price_cop?: number;
  combo_savings_cop?: number;
  combo_unit_price_cop?: number;
  combo_component_normal_price_cop?: number;
  combo_component_label?: string;
  combo_is_primary?: boolean;
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

const initialState: PosOrderActionState = { status: "idle", message: "" };
const minCardScale = 0;
const maxCardScale = 2;
const pizzaCardScaleKey = "modo-pos-pizza-card-scale";
const productCardScaleKey = "modo-pos-product-card-scale";
const productViewSettingsKey = "modo-pos-product-view-settings";
const cashDenominations = [2000, 5000, 10000, 20000, 50000, 100000];

type ProductViewSettings = {
  showCost: boolean;
  showStock: boolean;
  showSoldOut: boolean;
};

const defaultProductViewSettings: ProductViewSettings = { showCost: true, showStock: true, showSoldOut: true };

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

function productKey(line: Omit<CartLine, "key" | "quantity" | "signature">) {
  if (line.combo_instance_id) {
    return `combo-component:${line.combo_instance_id}:${line.kind}:${line.id}:${line.secondary_id ?? "whole"}:${line.combo_component_label ?? ""}`;
  }
  if (line.kind === "sale_product") return `product:${line.id}:${line.unit_price_cop}`;
  if (line.kind === "combo") {
    const choicesKey = (line.combo_choices ?? []).map((choice) => `${choice.group_id}:${choice.option_id}:${choice.supplement_cop}`).sort().join("|");
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

export function PosOrderWorkspace({
  pizzas,
  additions,
  saleProducts,
  combos,
  baseOptions
}: {
  pizzas: PosPizzaOption[];
  additions: PosAdditionOption[];
  saleProducts: PosSaleProductOption[];
  combos: PosComboOption[];
  baseOptions: PosPizzaBaseOption[];
}) {
  const [state, action] = useActionState(createPosOrder, initialState);
  const [tab, setTab] = useState<CatalogTab>("pizzas");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [pizzaCardScale, setPizzaCardScale] = useState(1);
  const [productCardScale, setProductCardScale] = useState(1);
  const [productViewSettings, setProductViewSettings] = useState<ProductViewSettings>(defaultProductViewSettings);
  const [productSettingsOpen, setProductSettingsOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderKind, setOrderKind] = useState<OrderKind>("local");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [delivery, setDelivery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [wizard, setWizard] = useState<PizzaWizard | null>(null);
  const [comboWizard, setComboWizard] = useState<PosComboOption | null>(null);
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
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [stockNotice, setStockNotice] = useState("");
  const [stockShortageModalOpen, setStockShortageModalOpen] = useState(false);
  const [baseLineKey, setBaseLineKey] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cashSubmitLockRef = useRef(false);
  const router = useRouter();
  const normalizedQuery = normalizeMasterText(query);
  const activeCardScale = tab === "pizzas" ? pizzaCardScale : productCardScale;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPizzaCardScale(initialCardScale(pizzaCardScaleKey));
      setProductCardScale(initialCardScale(productCardScaleKey));
      setProductViewSettings(readProductViewSettings());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

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
    if (state.status === "success") {
      const timeout = window.setTimeout(() => {
        setCart([]);
        setDelivery("");
        setCustomerName("");
        setCustomerPhone("");
        setNotes("");
        setOrderKind("local");
        setPaymentMethod("cash");
        setDiscount(null);
        setDiscountInput("");
        setDiscountModalOpen(false);
        setCashModalOpen(false);
        setCashReceived("");
        setCashConfirmed(false);
        setCashSubmitting(false);
        setCashSelectedOption(null);
        setStockNotice("");
        cashSubmitLockRef.current = false;
        router.refresh();
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (state.status === "error" && state.stockShortages?.length) {
      const timeout = window.setTimeout(() => {
        setCashConfirmed(false);
        setCashSubmitting(false);
        setCashModalOpen(false);
        setStockShortageModalOpen(true);
        cashSubmitLockRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (state.status === "error" && paymentMethod === "cash" && cashConfirmed) {
      const timeout = window.setTimeout(() => {
        setCashConfirmed(false);
        setCashSubmitting(false);
        setCashModalOpen(true);
        cashSubmitLockRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [cashConfirmed, paymentMethod, router, state.status, state.stockShortages]);

  const categories = useMemo(() => {
    const unique = new Map<string, string>();
    for (const pizza of pizzas) {
      if (pizza.category_id && pizza.category_name) unique.set(pizza.category_id, pizza.category_name);
    }
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pizzas]);

  const pizzaSuggestions = useMemo(() => pizzas.map((pizza) => pizza.flavor_name), [pizzas]);
  const productSuggestions = useMemo(() => saleProducts.map((product) => `${product.name} ${product.presentation ?? ""}`.trim()), [saleProducts]);
  const comboSuggestions = useMemo(() => combos.map((combo) => combo.name), [combos]);

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

  function saleProductCartQuantity(productId: string, lines = cart) {
    return lines
      .filter((line) => line.kind === "sale_product" && line.id === productId)
      .reduce((sum, line) => sum + line.quantity, 0);
  }

  function saleProductStock(productId: string) {
    return Math.max(0, Math.floor(saleProductById.get(productId)?.stock_base ?? 0));
  }

  function stockMessage(productId: string) {
    return `Stock disponible: ${formatStockQuantity(saleProductStock(productId), "unit")}`;
  }

  const subtotalBeforeComboDiscount = cart.reduce((sum, line) => {
    const additionsSubtotal = line.additions.reduce((additionSum, addition) => additionSum + addition.quantity * addition.unit_price_cop, 0);
    const componentPrice = line.combo_instance_id ? line.combo_component_normal_price_cop ?? line.unit_price_cop : line.unit_price_cop;
    return sum + line.quantity * (componentPrice + additionsSubtotal);
  }, 0);
  const comboDiscountCop = cart.reduce((sum, line) => {
    if (!line.combo_is_primary) return sum;
    return sum + line.quantity * Math.max(0, line.combo_savings_cop ?? 0);
  }, 0);
  const subtotal = Math.max(0, subtotalBeforeComboDiscount - comboDiscountCop);
  const deliveryValue = orderKind === "delivery" ? Number(delivery || 0) : 0;
  const rawDiscountCop = discount?.type === "percentage" ? Math.round(subtotal * discount.value / 100) : discount?.amount_cop ?? 0;
  const discountCop = discount ? Math.min(rawDiscountCop, Math.max(0, subtotal - 1)) : 0;
  const total = Math.max(0, subtotal - discountCop + deliveryValue);
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
    if (saleProductCartQuantity(product.id) >= saleProductStock(product.id)) {
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

  function addConfiguredPizza(source = wizard, additionsToUse = selectedAdditionsList, quantity = wizard?.quantity ?? 1) {
    if (!source) return;
    const line = configuredPizzaLine(source, additionsToUse);
    if (!line) return;
    if (source.editingLineKey) {
      const existingLine = cart.find((item) => item.key === source.editingLineKey);
      if (existingLine?.combo_instance_id) {
        if (line.id !== existingLine.id || line.secondary_id !== existingLine.secondary_id) {
          setStockNotice("Para cambiar el sabor o tamano de un combo usa Editar combo.");
          return;
        }
        const comboLine = {
          ...line,
          combo_instance_id: existingLine.combo_instance_id,
          combo_config_id: existingLine.combo_config_id,
          combo_name: existingLine.combo_name,
          combo_sku: existingLine.combo_sku,
          combo_choices: existingLine.combo_choices,
          combo_normal_price_cop: existingLine.combo_normal_price_cop,
          combo_savings_cop: existingLine.combo_savings_cop,
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
        return;
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
  }

  function openComboWizard(combo: PosComboOption) {
    const initialSelections: Record<string, string[]> = {};
    for (const group of combo.groups) {
      if (group.options.length <= group.quantity_to_choose) {
        initialSelections[group.id] = group.options.slice(0, group.quantity_to_choose).map((option) => option.id);
      } else if (group.quantity_to_choose === 1 && group.options.length === 1) {
        initialSelections[group.id] = [group.options[0].id];
      }
    }
    setComboSelections(initialSelections);
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
    setEditingComboLineKey(line.combo_instance_id);
    setComboWizard(combo);
  }

  function toggleComboOption(groupId: string, optionId: string, limit: number) {
    setComboSelections((current) => {
      const selected = current[groupId] ?? [];
      if (selected.includes(optionId)) return { ...current, [groupId]: selected.filter((id) => id !== optionId) };
      return { ...current, [groupId]: [...selected, optionId].slice(-limit) };
    });
  }

  function addConfiguredCombo() {
    if (!comboWizard) return;
    const choiceDrafts: ComboChoice[] = [];
    for (const group of comboWizard.groups) {
      const selected = comboSelections[group.id] ?? [];
      if (group.is_required && selected.length !== group.quantity_to_choose) {
        setStockNotice(`Selecciona ${group.quantity_to_choose} opcion(es) en ${group.name}.`);
        return;
      }
      for (const optionId of selected) {
        const option = group.options.find((item) => item.id === optionId);
        if (!option) continue;
        const sourceId = group.group_kind === "pizza" ? option.pizza_price_config_id : option.inventory_item_id;
        if (!sourceId) continue;
        choiceDrafts.push({
          group_id: group.id,
          option_id: option.id,
          kind: group.group_kind,
          id: sourceId,
          name: option.name,
          unit_price_cop: option.unit_price_cop,
          supplement_cop: option.supplement_cop
        });
      }
    }
    const supplement = choiceDrafts.reduce((sum, choice) => sum + choice.supplement_cop, 0);
    const normalPrice = choiceDrafts.reduce((sum, choice) => sum + choice.unit_price_cop + choice.supplement_cop, 0);
    const comboUnitPrice = comboWizard.sale_price_cop + supplement;
    const comboSavings = Math.max(0, normalPrice - comboUnitPrice);
    const comboInstanceId = editingComboLineKey ?? cartLineKey();
    const weightTotal = choiceDrafts.reduce((sum, choice) => sum + Math.max(1, choice.unit_price_cop + choice.supplement_cop), 0);
    let allocated = 0;
    const choices = choiceDrafts.map((choice) => ({ ...choice, line_key: cartLineKey() }));
    const nextLines = choices.map((choice, index) => {
      const isLast = index === choices.length - 1;
      const componentNormalPrice = choice.unit_price_cop + choice.supplement_cop;
      const componentNetPrice = isLast ? comboUnitPrice - allocated : Math.round((comboUnitPrice * Math.max(1, componentNormalPrice)) / Math.max(1, weightTotal));
      allocated += componentNetPrice;
      const common = {
        combo_instance_id: comboInstanceId,
        combo_config_id: comboWizard.id,
        combo_name: comboWizard.name,
        combo_sku: comboWizard.sku,
        combo_choices: choices,
        combo_normal_price_cop: normalPrice,
        combo_savings_cop: comboSavings,
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
        return {
          ...common,
          key: choice.line_key!,
          signature: "",
          kind: "pizza" as const,
          id: choice.id,
          secondary_id: null,
          name: `${choice.name}${price?.size_name ? ` ${price.size_name}` : ""}`,
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
        name: product?.presentation ? `${choice.name} ${product.presentation}` : choice.name,
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
        const blocked = groupLines.find((item) => item.kind === "sale_product" && item.quantity >= saleProductStock(item.id));
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
    if (line?.kind === "sale_product" && delta > 0 && line.quantity >= saleProductStock(line.id)) {
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
    secondary_id: line.secondary_id ?? null,
    quantity: line.quantity,
    unit_price_cop: line.unit_price_cop,
    notes: line.notes ?? "",
    removed_components: line.removed_components ?? [],
    base_override: line.base_override ?? null,
    combo_instance_id: line.combo_instance_id ?? null,
    combo_config_id: line.combo_config_id ?? null,
    combo_name: line.combo_name ?? null,
    combo_sku: line.combo_sku ?? null,
    combo_choices: line.combo_choices ?? [],
    combo_normal_price_cop: line.combo_normal_price_cop ?? 0,
    combo_savings_cop: line.combo_savings_cop ?? 0,
    combo_unit_price_cop: line.combo_unit_price_cop ?? 0,
    combo_component_normal_price_cop: line.combo_component_normal_price_cop ?? 0,
    combo_component_label: line.combo_component_label ?? null,
    combo_is_primary: Boolean(line.combo_is_primary),
    additions: line.additions.map((addition) => ({
      id: addition.id,
      quantity: addition.quantity,
      scope: addition.scope,
      scope_label: addition.scope_label ?? null
    }))
  }));
  const baseLine = baseLineKey ? cart.find((line) => line.key === baseLineKey && line.kind === "pizza") ?? null : null;
  const baseLineSize = baseLine ? pizzaPriceById.get(baseLine.id) ?? null : null;
  const baseLineDefault = baseLine ? defaultBaseForLine(baseLine) : null;
  const baseLineOptions = baseLine ? baseOptionsForLine(baseLine) : [];
  const hasInvalidSaleProductPrice = cart.some((line) => line.kind === "sale_product" && (!Number.isFinite(line.unit_price_cop) || line.unit_price_cop <= 0));
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
    if (paymentMethod !== "cash" || cashConfirmed) return;
    event.preventDefault();
    if (cart.length === 0 || hasInvalidSaleProductPrice) return;
    setCashReceived("");
    setCashSelectedOption(null);
    setCashSubmitting(false);
    cashSubmitLockRef.current = false;
    setCashModalOpen(true);
  }

  function confirmCashPayment(received: number) {
    if (received < total) return;
    if (cashSubmitLockRef.current) return;
    cashSubmitLockRef.current = true;
    setCashReceived(String(received));
    setCashConfirmed(true);
    setCashSubmitting(true);
    setCashSelectedOption(null);
    setCashModalOpen(false);
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  }

  function closeCashModal() {
    setCashModalOpen(false);
    setCashReceived("");
    setCashConfirmed(false);
    setCashSubmitting(false);
    setCashSelectedOption(null);
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
        <input name="kind" type="hidden" value={orderKind} />
        <input name="payment_method" type="hidden" value={paymentMethod} />
        <input name="customer_name" type="hidden" value={customerName} />
        <input name="customer_phone" type="hidden" value={customerPhone} />
        <input name="discount_type" type="hidden" value={discount?.type ?? "none"} />
        <input name="discount_value" type="hidden" value={discount?.value ?? 0} />
        <input name="discount_cop" type="hidden" value={discountCop} />
        <input name="delivery_cop" type="hidden" value={deliveryValue} />
        <input name="cash_received_cop" type="hidden" value={paymentMethod === "cash" ? cashReceivedValue : 0} />
        <input name="cash_change_cop" type="hidden" value={paymentMethod === "cash" ? cashChange : 0} />
        <input name="notes" type="hidden" value={notes} />

        <section className="pos-catalog-panel">
          <div className="pos-catalog-toolbar">
            <div className="pos-tabs">
              <button className={tab === "pizzas" ? "active" : ""} onClick={() => setTab("pizzas")} type="button">Pizzas</button>
              <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")} type="button">Productos</button>
              <button className={tab === "combos" ? "active" : ""} onClick={() => setTab("combos")} type="button">Combos</button>
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
            {tab === "pizzas" ? (
              <select className="pos-category-filter" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                <option value="all">Todas las categorias</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            ) : null}
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
                    disabled={product.sale_price_cop <= 0 || saleProductCartQuantity(product.id) >= saleProductStock(product.id)}
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
                    disabled={combo.groups.length === 0 || combo.sale_price_cop <= 0}
                    key={combo.id}
                    onClick={() => openComboWizard(combo)}
                    type="button"
                  >
                    <ProductImage alt={combo.name} src={combo.image_src} />
                    <span className="pos-product-title">{combo.name}</span>
                    <span className="pos-product-meta">{combo.description ?? "Combo configurable"}</span>
                    <strong>{formatCop(combo.sale_price_cop)}</strong>
                    {combo.normal_price_cop > combo.sale_price_cop ? <small>Ahorras {formatCop(combo.normal_price_cop - combo.sale_price_cop)}</small> : null}
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
            {(["local", "pickup", "delivery"] as OrderKind[]).map((kind) => (
              <button className={orderKind === kind ? "active" : ""} key={kind} onClick={() => setOrderKind(kind)} type="button">
                {orderKindLabel(kind)}
              </button>
            ))}
          </div>

          <div className="pos-cart-lines">
            {cartEntries.map((entry) => {
              if (entry.kind === "combo") {
                const { primary, lines } = entry;
                return (
                  <article className="pos-cart-line pos-combo-cart-group" key={entry.id}>
                    <div>
                      <span className="pos-cart-line-title">
                        <strong>{primary.combo_name ?? primary.name}</strong>
                        <button aria-label={`Editar combo ${primary.combo_name ?? primary.name}`} className="icon-button" onClick={() => openEditComboWizard(primary)} title="Editar combo" type="button"><Pencil size={14} /></button>
                      </span>
                      <small>{primary.combo_sku ?? "Sin SKU"} · combo</small>
                      <small>Precio normal: {formatCop(primary.combo_normal_price_cop ?? 0)}</small>
                      {primary.combo_savings_cop && primary.combo_savings_cop > 0 ? <small>Descuento combo: -{formatCop(primary.combo_savings_cop)}</small> : null}
                      <small>Precio combo: {formatCop(primary.combo_unit_price_cop ?? lines.reduce((sum, item) => sum + item.unit_price_cop, 0))}</small>
                      {lines.map((component) => (
                        <small className="pos-combo-component-row" key={component.key}>
                          <span>Incluye: {component.name}{component.combo_component_normal_price_cop && component.combo_component_normal_price_cop !== component.unit_price_cop ? ` (${formatCop(component.combo_component_normal_price_cop)})` : ""}</span>
                          {component.kind === "pizza" ? (
                            <button aria-label={`Personalizar ${component.name}`} className="icon-button" onClick={() => openEditPizzaWizard(component)} title="Personalizar pizza del combo" type="button"><Pencil size={13} /></button>
                          ) : null}
                        </small>
                      ))}
                      {lines.flatMap((component) => component.additions.map((addition) => (
                        <small key={`${component.key}-${addition.key}`}>{component.name}: {additionLabel(addition)} +{formatCop(addition.quantity * addition.unit_price_cop)}</small>
                      )))}
                    </div>
                    <div className="pos-qty-controls">
                      <button onClick={() => updateQuantity(primary.key, -1)} title="Disminuir" type="button"><Minus size={16} /></button>
                      <strong>{primary.quantity}</strong>
                      <button onClick={() => updateQuantity(primary.key, 1)} title="Aumentar" type="button"><Plus size={16} /></button>
                      <button className="danger-button" onClick={() => setCart((current) => current.filter((item) => item.combo_instance_id !== entry.id))} title="Quitar combo" type="button"><Trash2 size={16} /></button>
                    </div>
                  </article>
                );
              }
              const line = entry.line;
              return (
              <article className="pos-cart-line" key={line.key}>
                <div>
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
                  {line.kind === "combo" ? (
                    <>
                      <small>{line.sku ?? "Sin SKU"} · combo</small>
                      {(line.combo_choices ?? []).map((choice) => (
                        <small key={`${choice.group_id}-${choice.option_id}`}>Incluye: {choice.name}{choice.supplement_cop > 0 ? ` +${formatCop(choice.supplement_cop)}` : ""}</small>
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
                  <span>{line.unit_price_cop > 0 ? formatCop(line.unit_price_cop) : "Sin precio"}</span>
                </div>
                <div className="pos-qty-controls">
                  <button onClick={() => updateQuantity(line.key, -1)} title="Disminuir" type="button"><Minus size={16} /></button>
                  <strong>{line.quantity}</strong>
                  <button
                    disabled={line.kind === "sale_product" && line.quantity >= saleProductStock(line.id)}
                    onClick={() => updateQuantity(line.key, 1)}
                    title={line.kind === "sale_product" && line.quantity >= saleProductStock(line.id) ? stockMessage(line.id) : "Aumentar"}
                    type="button"
                  ><Plus size={16} /></button>
                  <button className="danger-button" onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))} title="Quitar" type="button"><Trash2 size={16} /></button>
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
          <textarea onChange={(event) => setNotes(uppercaseMasterName(event.target.value))} placeholder="Observaciones" value={notes} />

          <div className="pos-payment-grid">
            {(["cash", "transfer", "mixed", "pending"] as PaymentMethod[]).map((method) => (
              <button className={paymentMethod === method ? "active" : ""} key={method} onClick={() => setPaymentMethod(method)} type="button">
                {paymentLabel(method)}
              </button>
            ))}
          </div>

          <button className="pos-discount-action" disabled={subtotal <= 0} onClick={openDiscountModal} type="button">
            <BadgePercent size={17} /> {discount ? "Editar descuento" : "Aplicar descuento"}
          </button>
          <div className="pos-total-box">
            {comboDiscountCop > 0 ? <span className="pos-subtotal-line">Subtotal componentes <strong>{formatCop(subtotalBeforeComboDiscount)}</strong></span> : null}
            {comboDiscountCop > 0 ? <span className="pos-discount-line">Descuento combo <strong>-{formatCop(comboDiscountCop)}</strong></span> : null}
            {discount ? <span className="pos-subtotal-line">Subtotal <strong>{formatCop(subtotal)}</strong></span> : null}
            {discount ? <span className="pos-discount-line">{discountLabel} <strong>-{formatCop(discountCop)}</strong></span> : null}
            <span>Total <strong>{formatCop(total)}</strong></span>
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
          {hasInvalidSaleProductPrice ? <p className="form-status error">Hay productos sin precio de venta configurado.</p> : null}
          <div className="pos-final-actions">
            <button className="ghost-button pos-client-action-button" onClick={() => setCustomerModalOpen(true)} type="button">
              {customerName || customerPhone ? "Editar cliente" : "+ Agregar cliente"}
            </button>
            <SubmitOrderButton disabled={cart.length === 0 || hasInvalidSaleProductPrice} />
          </div>
        </aside>
      </form>

      {stockShortageModalOpen && state.stockShortages?.length ? (
        <StockShortageModal
          onClose={() => setStockShortageModalOpen(false)}
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

      {productSettingsOpen ? (
        <ProductViewSettingsModal
          onChange={setProductViewSettings}
          onClose={() => setProductSettingsOpen(false)}
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
          onAdd={addConfiguredCombo}
          onClose={() => {
            setComboWizard(null);
            setComboSelections({});
            setEditingComboLineKey(null);
          }}
          onToggle={toggleComboOption}
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

            <footer className="form-actions modal-form-actions">
              <button className="ghost-button" onClick={closeCashModal} type="button">Cancelar</button>
              <button className="positive-button" disabled={cashReceivedValue < total || cashSubmitting} onClick={() => confirmCashPayment(cashReceivedValue)} type="button">
                {cashSubmitting ? "Registrando..." : "Registrar pago"}
              </button>
            </footer>
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
                    <div className="pos-ingredient-options">
                      {group.choices.map((choice) => {
                        const checked = !removedKeys.includes(choice.key);
                        return (
                          <label className={checked ? "pos-ingredient-option selected" : "pos-ingredient-option"} key={choice.key}>
                            <input checked={checked} onChange={() => onToggle(choice.key)} type="checkbox" />
                            <span>{choice.source_name}</span>
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
  onChange,
  onClose,
  settings
}: {
  onChange: (settings: ProductViewSettings) => void;
  onClose: () => void;
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
        </div>
        <footer className="form-actions modal-form-actions"><button className="positive-button" onClick={onClose} type="button">Listo</button></footer>
      </section>
    </div>
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
  selections,
  onToggle,
  onAdd,
  onClose
}: {
  combo: PosComboOption;
  selections: Record<string, string[]>;
  onToggle: (groupId: string, optionId: string, limit: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const selectedOptions = combo.groups.flatMap((group) => (selections[group.id] ?? []).map((optionId) => group.options.find((option) => option.id === optionId)).filter(Boolean) as PosComboOption["groups"][number]["options"]);
  const supplement = selectedOptions.reduce((sum, option) => sum + Number(option.supplement_cop ?? 0), 0);
  const complete = combo.groups.every((group) => !group.is_required || (selections[group.id] ?? []).length === group.quantity_to_choose);
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Configurar combo" aria-modal="true" className="modal-panel pos-pizza-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{combo.name}</strong>
            <span>{combo.description ?? "Elige las opciones del combo."}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="pos-wizard-body">
          {combo.groups.map((group, index) => {
            const selected = new Set(selections[group.id] ?? []);
            return (
              <WizardStep key={group.id} title={`Paso ${index + 1}: ${group.name}`}>
                <p className="field-hint">Elige {group.quantity_to_choose}. {group.is_required ? "Obligatorio." : "Opcional."}</p>
                <div className="pos-half-grid">
                  {group.options.map((option) => (
                    <button
                      className={selected.has(option.id) ? "pos-product-card pos-second-flavor-card active" : "pos-product-card pos-second-flavor-card"}
                      key={option.id}
                      onClick={() => onToggle(group.id, option.id, group.quantity_to_choose)}
                      type="button"
                    >
                      <ProductImage alt={option.name} src={option.image_src} />
                      <span className="pos-product-title">{option.name}</span>
                      <strong>{option.supplement_cop > 0 ? `+${formatCop(option.supplement_cop)}` : "Incluido"}</strong>
                    </button>
                  ))}
                </div>
              </WizardStep>
            );
          })}
          <div className="pos-summary-card">
            <strong>Total combo: {formatCop(combo.sale_price_cop + supplement)}</strong>
            {supplement > 0 ? <small>Suplementos: {formatCop(supplement)}</small> : null}
          </div>
        </div>
        <footer className="pos-wizard-footer">
          <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
          <button className="primary-button" disabled={!complete} onClick={onAdd} type="button">Agregar combo</button>
        </footer>
      </section>
    </div>
  );
}

function StockShortageModal({
  shortages,
  onClose,
  onOpenPurchases,
  onOpenProduction,
  onChooseAlternativeBase
}: {
  shortages: PosStockShortage[];
  onClose: () => void;
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
          <p className="field-hint danger">No es posible confirmar el pedido hasta completar el stock requerido.</p>
          {needsPurchase ? <p className="field-hint">Para ingredientes, bases o productos: registra una compra o ajuste de inventario.</p> : null}
          {needsProduction ? <p className="field-hint">Para preparaciones: registra una producción o ingreso histórico/ajuste de la preparación.</p> : null}
        </div>
        <footer className="form-actions modal-form-actions">
          <button className="ghost-button" onClick={onClose} type="button">Cerrar</button>
          {needsPurchase ? <button className="primary-button" onClick={onOpenPurchases} type="button">Ir a Compras</button> : null}
          {needsProduction ? <button className="positive-button" onClick={onOpenProduction} type="button">Ir a Producción</button> : null}
        </footer>
      </section>
    </div>
  );
}

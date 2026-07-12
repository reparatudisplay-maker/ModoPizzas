import { createClient } from "@supabase/supabase-js";
import { fallbackCatalog } from "@/lib/menu-data";
import { getSupabaseEnv } from "@/lib/supabase-server";
import type { Combo, PizzaExtra, PizzaFlavor, PizzaSize, PublicCatalog, SiteSettings } from "@/types/modo-pizzas";

type DbSiteSettings = {
  business_name: string;
  whatsapp_number: string;
  whatsapp_enabled: boolean;
  whatsapp_button_text: string;
};

type DbPizzaSize = {
  code: string;
  name: string;
  description: string | null;
  display_order: number;
};

type DbPizzaFlavor = {
  code: string;
  name: string;
  description: string;
  allergens: string[];
  is_featured: boolean;
};

type DbPizzaFlavorPrice = {
  price_cop: number;
  pizza_flavors: { code: string } | null;
  pizza_sizes: { code: string } | null;
};

type DbPizzaExtra = {
  code: string;
  name: string;
  price_cop: number;
  extra_kind: string;
};

type DbCombo = {
  code: string;
  name: string;
  description: string;
  price_cop: number;
};

type DbComboItem = {
  item_label: string;
  combos: { code: string } | null;
};

function getPublicSupabaseClient() {
  const { url, publishableKey: key } = getSupabaseEnv();

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
}

function mapSettings(row: DbSiteSettings | null): SiteSettings {
  if (!row) return fallbackCatalog.siteSettings;

  return {
    businessName: row.business_name,
    whatsappNumber: row.whatsapp_number,
    whatsappEnabled: row.whatsapp_enabled,
    whatsappButtonText: row.whatsapp_button_text
  };
}

function mapSizes(rows: DbPizzaSize[]): PizzaSize[] {
  return rows.map((row) => ({
    id: row.code,
    name: row.name,
    description: row.description ?? "",
    order: row.display_order
  }));
}

function mapExtras(rows: DbPizzaExtra[], kind: string): PizzaExtra[] {
  return rows
    .filter((row) => row.extra_kind === kind)
    .map((row) => ({
      id: row.code,
      name: row.name,
      price: row.price_cop
    }));
}

function mapFlavors(rows: DbPizzaFlavor[], prices: DbPizzaFlavorPrice[]): PizzaFlavor[] {
  const priceMap = new Map<string, Record<string, number>>();

  prices.forEach((row) => {
    const flavorCode = row.pizza_flavors?.code;
    const sizeCode = row.pizza_sizes?.code;
    if (!flavorCode || !sizeCode) return;

    const current = priceMap.get(flavorCode) ?? {};
    current[sizeCode] = row.price_cop;
    priceMap.set(flavorCode, current);
  });

  return rows.map((row) => ({
    id: row.code,
    name: row.name,
    description: row.description,
    allergens: row.allergens,
    featured: row.is_featured,
    prices: priceMap.get(row.code) ?? {}
  }));
}

function mapCombos(rows: DbCombo[], items: DbComboItem[]): Combo[] {
  return rows.map((row) => ({
    id: row.code,
    name: row.name,
    description: row.description,
    price: row.price_cop,
    items: items.filter((item) => item.combos?.code === row.code).map((item) => item.item_label)
  }));
}

export async function getPublicCatalog(): Promise<PublicCatalog> {
  const supabase = getPublicSupabaseClient();
  if (!supabase) return fallbackCatalog;

  try {
    const [settingsResult, sizesResult, flavorsResult, pricesResult, extrasResult, combosResult, comboItemsResult] =
      await Promise.all([
        supabase.from("site_settings").select("business_name, whatsapp_number, whatsapp_enabled, whatsapp_button_text").single(),
        supabase.from("pizza_sizes").select("code, name, description, display_order").eq("is_active", true).order("display_order"),
        supabase
          .from("pizza_flavors")
          .select("code, name, description, allergens, is_featured")
          .eq("is_public", true)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("pizza_flavor_prices")
          .select("price_cop, pizza_flavors!inner(code), pizza_sizes!inner(code)"),
        supabase.from("pizza_extras").select("code, name, price_cop, extra_kind").eq("is_active", true).order("name"),
        supabase.from("combos").select("code, name, description, price_cop").eq("is_public", true).eq("is_active", true),
        supabase.from("combo_items").select("item_label, combos!inner(code)")
      ]);

    const results = [settingsResult, sizesResult, flavorsResult, pricesResult, extrasResult, combosResult, comboItemsResult];
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error("Supabase public catalog error", failed.error.message);
      return fallbackCatalog;
    }

    const catalog = {
      siteSettings: mapSettings(settingsResult.data),
      pizzaSizes: mapSizes(sizesResult.data ?? []),
      pizzaFlavors: mapFlavors(flavorsResult.data ?? [], (pricesResult.data ?? []) as unknown as DbPizzaFlavorPrice[]),
      crusts: mapExtras(extrasResult.data ?? [], "crust"),
      extras: mapExtras(extrasResult.data ?? [], "addition"),
      combos: mapCombos(combosResult.data ?? [], (comboItemsResult.data ?? []) as unknown as DbComboItem[])
    };

    return {
      siteSettings: catalog.siteSettings,
      pizzaSizes: catalog.pizzaSizes.length > 0 ? catalog.pizzaSizes : fallbackCatalog.pizzaSizes,
      pizzaFlavors: catalog.pizzaFlavors.length > 0 ? catalog.pizzaFlavors : fallbackCatalog.pizzaFlavors,
      crusts: catalog.crusts.length > 0 ? catalog.crusts : fallbackCatalog.crusts,
      extras: catalog.extras.length > 0 ? catalog.extras : fallbackCatalog.extras,
      combos: catalog.combos.length > 0 ? catalog.combos : fallbackCatalog.combos
    };
  } catch (error) {
    console.error("Supabase public catalog exception", error);
    return fallbackCatalog;
  }
}

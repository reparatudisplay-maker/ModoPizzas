import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { saveCombo, savePizzaExtra, savePizzaFlavor, savePizzaSize } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type MenuPageProps = {
  searchParams: Promise<{ section?: string }>;
};

export const dynamic = "force-dynamic";

type PizzaSizeRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  supports_half_and_half: boolean;
};

type PizzaFlavorRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  allergens: string[];
  is_featured: boolean;
  is_public: boolean;
  is_active: boolean;
};

type PizzaFlavorPriceRow = {
  flavor_id: string;
  size_id: string;
  price_cop: number;
};

type PizzaExtraRow = {
  id: string;
  code: string;
  name: string;
  price_cop: number;
  extra_kind: string;
  is_active: boolean;
};

type ComboRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  price_cop: number;
  is_public: boolean;
  is_active: boolean;
  combo_items: Array<{ item_label: string; quantity: number }>;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

function tabClass(active: string, value: string) {
  return active === value ? "ghost-button active-tab" : "ghost-button";
}

function priceFor(prices: PizzaFlavorPriceRow[], flavorId: string, sizeId: string) {
  return prices.find((price) => price.flavor_id === flavorId && price.size_id === sizeId)?.price_cop ?? 0;
}

function SectionTabs({ active }: { active: string }) {
  return (
    <nav className="section-tabs" aria-label="Secciones de menu">
      <Link className={tabClass(active, "sabores")} href="/panel/menu?section=sabores">
        Sabores y precios
      </Link>
      <Link className={tabClass(active, "tamanos")} href="/panel/menu?section=tamanos">
        Tamanos
      </Link>
      <Link className={tabClass(active, "extras")} href="/panel/menu?section=extras">
        Bordes y extras
      </Link>
      <Link className={tabClass(active, "combos")} href="/panel/menu?section=combos">
        Promociones
      </Link>
    </nav>
  );
}

function SizeForm({ size }: { size?: PizzaSizeRow }) {
  return (
    <form action={savePizzaSize} className="compact-card">
      {size ? <input name="id" type="hidden" value={size.id} /> : null}
      <div>
        <h3>{size ? size.name : "Nuevo tamano"}</h3>
        {size ? <span className="badge">{size.is_active ? "Activo" : "Oculto"}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={size?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={size?.code} name="code" placeholder="mediana" />
        </div>
        <div className="field">
          <label>Orden</label>
          <input defaultValue={size?.display_order ?? 0} min="0" name="display_order" type="number" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <input defaultValue={size?.description ?? ""} name="description" />
        </div>
      </div>
      <div className="check-grid">
        <label className="check-option">
          <input defaultChecked={size?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={size?.supports_half_and_half ?? true} name="supports_half_and_half" type="checkbox" />
          <span>Mitad y mitad</span>
        </label>
      </div>
      <button className="primary-button" type="submit">
        Guardar tamano
      </button>
    </form>
  );
}

function FlavorForm({
  flavor,
  sizes,
  prices
}: {
  flavor?: PizzaFlavorRow;
  sizes: PizzaSizeRow[];
  prices: PizzaFlavorPriceRow[];
}) {
  return (
    <form action={savePizzaFlavor} className="compact-card">
      {flavor ? <input name="id" type="hidden" value={flavor.id} /> : null}
      <div>
        <h3>{flavor ? flavor.name : "Nuevo sabor"}</h3>
        {flavor ? <span className="badge">{flavor.is_active && flavor.is_public ? "Publico" : "Oculto"}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={flavor?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={flavor?.code} name="code" placeholder="hawaiana" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <textarea defaultValue={flavor?.description} name="description" />
        </div>
        <div className="field full">
          <label>Alergenos separados por coma</label>
          <input defaultValue={flavor?.allergens.join(", ")} name="allergens" placeholder="lacteos, gluten" />
        </div>
      </div>
      <div className="price-editor">
        {sizes.map((size) => (
          <div className="field" key={size.id}>
            <label>{size.name}</label>
            <input
              defaultValue={flavor ? priceFor(prices, flavor.id, size.id) : 0}
              min="0"
              name={`price_${size.id}`}
              type="number"
            />
          </div>
        ))}
      </div>
      <div className="check-grid">
        <label className="check-option">
          <input defaultChecked={flavor?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={flavor?.is_public ?? true} name="is_public" type="checkbox" />
          <span>Visible publico</span>
        </label>
        <label className="check-option">
          <input defaultChecked={flavor?.is_featured ?? false} name="is_featured" type="checkbox" />
          <span>Popular</span>
        </label>
      </div>
      <button className="primary-button" type="submit">
        Guardar sabor
      </button>
    </form>
  );
}

function ExtraForm({ extra }: { extra?: PizzaExtraRow }) {
  return (
    <form action={savePizzaExtra} className="compact-card">
      {extra ? <input name="id" type="hidden" value={extra.id} /> : null}
      <div>
        <h3>{extra ? extra.name : "Nuevo borde o extra"}</h3>
        {extra ? <span className="badge">{extra.extra_kind === "crust" ? "Borde" : "Extra"}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={extra?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={extra?.code} name="code" />
        </div>
        <div className="field">
          <label>Precio COP</label>
          <input defaultValue={extra?.price_cop ?? 0} min="0" name="price_cop" type="number" />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select defaultValue={extra?.extra_kind ?? "addition"} name="extra_kind">
            <option value="crust">Borde</option>
            <option value="addition">Adicion</option>
          </select>
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={extra?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar borde/extra
      </button>
    </form>
  );
}

function ComboForm({ combo }: { combo?: ComboRow }) {
  return (
    <form action={saveCombo} className="compact-card">
      {combo ? <input name="id" type="hidden" value={combo.id} /> : null}
      <div>
        <h3>{combo ? combo.name : "Nueva promocion"}</h3>
        {combo ? <span className="badge">{formatCop(combo.price_cop)}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={combo?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={combo?.code} name="code" />
        </div>
        <div className="field">
          <label>Precio COP</label>
          <input defaultValue={combo?.price_cop ?? 0} min="0" name="price_cop" type="number" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <textarea defaultValue={combo?.description} name="description" />
        </div>
        <div className="field full">
          <label>Items, uno por linea</label>
          <textarea defaultValue={combo?.combo_items.map((item) => item.item_label).join("\n")} name="items" />
        </div>
      </div>
      <div className="check-grid">
        <label className="check-option">
          <input defaultChecked={combo?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={combo?.is_public ?? true} name="is_public" type="checkbox" />
          <span>Visible publico</span>
        </label>
      </div>
      <button className="primary-button" type="submit">
        Guardar promocion
      </button>
    </form>
  );
}

export default async function MenuAdminPage({ searchParams }: MenuPageProps) {
  const { section = "sabores" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const canManageMenu = roles?.some((item) => managerRoles.has(item.role)) ?? false;
  if (!canManageMenu) {
    notFound();
  }

  const [sizesResult, flavorsResult, pricesResult, extrasResult, combosResult] = await Promise.all([
    supabase.from("pizza_sizes").select("*").order("display_order"),
    supabase.from("pizza_flavors").select("*").order("name"),
    supabase.from("pizza_flavor_prices").select("*"),
    supabase.from("pizza_extras").select("*").order("extra_kind").order("name"),
    supabase.from("combos").select("*, combo_items(item_label, quantity)").order("name")
  ]);

  const sizes = (sizesResult.data ?? []) as PizzaSizeRow[];
  const flavors = (flavorsResult.data ?? []) as PizzaFlavorRow[];
  const prices = (pricesResult.data ?? []) as PizzaFlavorPriceRow[];
  const extras = (extrasResult.data ?? []) as PizzaExtraRow[];
  const combos = (combosResult.data ?? []) as unknown as ComboRow[];
  const error = sizesResult.error ?? flavorsResult.error ?? pricesResult.error ?? extrasResult.error ?? combosResult.error;

  return (
    <main className="panel-page">
      <header className="panel-header">
        <div>
          <Link className="ghost-button" href="/panel">
            Volver al panel
          </Link>
          <h1 className="section-title">Gestion de menu</h1>
          <p className="section-copy">Administra tamanos, sabores, precios, bordes, adiciones y promociones publicas.</p>
        </div>
        <Link className="primary-button" href="/panel/nuevo-pedido">
          Crear pedido
        </Link>
      </header>

      <SectionTabs active={section} />

      {error ? <p className="alert">{error.message}</p> : null}

      {section === "tamanos" ? (
        <section className="editor-grid">
          <SizeForm />
          {sizes.map((size) => (
            <SizeForm key={size.id} size={size} />
          ))}
        </section>
      ) : null}

      {section === "sabores" ? (
        <section className="editor-grid">
          <FlavorForm prices={prices} sizes={sizes} />
          {flavors.map((flavor) => (
            <FlavorForm flavor={flavor} key={flavor.id} prices={prices} sizes={sizes} />
          ))}
        </section>
      ) : null}

      {section === "extras" ? (
        <section className="editor-grid">
          <ExtraForm />
          {extras.map((extra) => (
            <ExtraForm extra={extra} key={extra.id} />
          ))}
        </section>
      ) : null}

      {section === "combos" ? (
        <section className="editor-grid">
          <ComboForm />
          {combos.map((combo) => (
            <ComboForm combo={combo} key={combo.id} />
          ))}
        </section>
      ) : null}
    </main>
  );
}

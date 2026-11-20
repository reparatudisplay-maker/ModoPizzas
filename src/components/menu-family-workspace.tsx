"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, ChefHat, CirclePlus, Package, Tags, UtensilsCrossed, X } from "lucide-react";
import { saveMenuFamily, type FormActionState } from "@/app/admin/actions";

export type MenuFamilyRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
};

const initialState: FormActionState = { status: "idle", message: "" };

const modules = [
  { label: "Recetas", description: "Ingredientes, cantidades, unidades y sustituciones.", icon: ChefHat },
  { label: "Presentaciones", description: "Tamaños, porciones, variantes y opciones.", icon: Boxes },
  { label: "Precios", description: "Precio vigente e histórico por presentación.", icon: Tags },
  { label: "Combos", description: "Componentes, alternativas y cantidades configurables.", icon: CirclePlus },
  { label: "Adiciones", description: "Extras compatibles, límites y consumo asociado.", icon: UtensilsCrossed },
  { label: "Empaques", description: "Consumo automático por canal y presentación.", icon: Package }
];

function FamilyForm({ onClose }: { onClose: () => void }) {
  const [state, action] = useActionState(saveMenuFamily, initialState);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [onClose, state.status]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Crear familia de platos" aria-modal="true" className="modal-panel family-modal" role="dialog">
        <header className="modal-header">
          <div><strong>Nueva familia</strong><span>La configuración se reutiliza para cualquier tipo de plato.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card family-form">
          <div className="form-grid">
            <div className="field full">
              <label>Nombre de la familia</label>
              <input autoComplete="off" name="name" onInput={(event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); }} placeholder="Ej. ALITAS" required />
            </div>
            <div className="field full">
              <label>Descripción</label>
              <textarea name="description" placeholder="Uso interno opcional" />
            </div>
          </div>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button><button className="primary-button" type="submit">Crear familia</button></div>
        </form>
      </section>
    </div>
  );
}

export function MenuFamilyWorkspace({ families, migrationReady }: { families: MenuFamilyRecord[]; migrationReady: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="family-workspace">
      <header className="family-workspace-header">
        <div className="family-workspace-title"><span><UtensilsCrossed size={24} /></span><div><p>MENÚ</p><h1>Familias de platos</h1><small>Una estructura compartida para recetas, venta, cocina e inventario.</small></div></div>
        <button className="primary-button" disabled={!migrationReady} onClick={() => setIsOpen(true)} title={migrationReady ? "Crear familia" : "Pendiente de aplicar migración 0157"} type="button"><CirclePlus size={18} /> Agregar familia</button>
      </header>

      {!migrationReady ? <p className="alert">La migración 0157 está preparada y pendiente de aplicar. Las familias no se pueden crear hasta entonces.</p> : null}

      <div className="family-module-grid" aria-label="Módulos disponibles por familia">
        {modules.map(({ label, description, icon: Icon }) => <article key={label}><span><Icon size={20} /></span><div><strong>{label}</strong><small>{description}</small></div></article>)}
      </div>

      {families.length ? <div className="family-list" aria-label="Familias configuradas">
        {families.map((family) => <article key={family.id}><div><strong>{family.name}</strong><small>{family.description || "Sin descripción"}</small></div><div><span className={family.is_active ? "status-pill success" : "status-pill"}>{family.is_active ? "Activa" : "Inactiva"}</span><Link className="ghost-button" href={`/panel/menu/familias/${family.id}`}>Configurar</Link></div></article>)}
      </div> : migrationReady ? <div className="family-empty-state"><UtensilsCrossed size={24} /><strong>Aún no hay familias adicionales</strong><span>Crea una familia cuando tengas su catálogo, recetas y reglas operativas definidos.</span></div> : null}
      {isOpen ? <FamilyForm onClose={() => setIsOpen(false)} /> : null}
    </section>
  );
}

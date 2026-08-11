"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveKitchenSettings, type FormActionState } from "@/app/admin/actions";

export type KitchenSettingsFormData = {
  oven_count: number;
  oven_width_cm: number;
  oven_depth_cm: number;
  sound_enabled_default: boolean;
  warning_threshold_minutes: number;
  delay_threshold_minutes: number;
};

export type KitchenSizeSettingsFormData = {
  pizza_size_id: string;
  name: string;
  diameter_cm: number | null;
  simultaneous_capacity: number;
  assembly_minutes: number;
  baking_minutes: number;
  finishing_minutes: number;
};

const initialState: FormActionState = { status: "idle", message: "" };

export function KitchenSettingsModule({
  settings,
  sizes
}: {
  settings: KitchenSettingsFormData;
  sizes: KitchenSizeSettingsFormData[];
}) {
  const [state, action] = useActionState(saveKitchenSettings, initialState);

  return (
    <section className="module-stack">
      <div className="section-title-row">
        <h1>Cocina</h1>
      </div>
      <form action={action} className="form-panel kitchen-settings-form">
        <section className="settings-section">
          <h2>Datos generales</h2>
          <div className="form-grid">
            <label className="field">
              <span>Cantidad de hornos</span>
              <input defaultValue={settings.oven_count} min={1} name="oven_count" type="number" />
            </label>
            <label className="field">
              <span>Ancho util del horno (cm)</span>
              <input defaultValue={settings.oven_width_cm} min={1} name="oven_width_cm" step="0.01" type="number" />
            </label>
            <label className="field">
              <span>Fondo util del horno (cm)</span>
              <input defaultValue={settings.oven_depth_cm} min={1} name="oven_depth_cm" step="0.01" type="number" />
            </label>
            <label className="checkbox-card">
              <input defaultChecked={settings.sound_enabled_default} name="sound_enabled_default" type="checkbox" />
              <span>Sonido activado por defecto</span>
            </label>
            <label className="field">
              <span>Umbral de advertencia (min)</span>
              <input defaultValue={settings.warning_threshold_minutes} min={0} name="warning_threshold_minutes" type="number" />
            </label>
            <label className="field">
              <span>Umbral de retraso (min)</span>
              <input defaultValue={settings.delay_threshold_minutes} min={0} name="delay_threshold_minutes" type="number" />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h2>Tiempos por tamano</h2>
          <div className="responsive-table-wrapper">
            <table className="data-table kitchen-settings-table">
              <thead>
                <tr>
                  <th>Tamano</th>
                  <th>Diametro</th>
                  <th>Capacidad</th>
                  <th>Armado</th>
                  <th>Horneado</th>
                  <th>Terminacion</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((size, index) => (
                  <tr key={size.pizza_size_id}>
                    <td>
                      <strong>{size.name}</strong>
                      <input name={`sizes[${index}][pizza_size_id]`} type="hidden" value={size.pizza_size_id} />
                    </td>
                    <td>{size.diameter_cm ? `${size.diameter_cm.toLocaleString("es-CO")} cm` : "-"}</td>
                    <td><input defaultValue={size.simultaneous_capacity} min={1} name={`sizes[${index}][simultaneous_capacity]`} type="number" /></td>
                    <td><input defaultValue={size.assembly_minutes} min={0} name={`sizes[${index}][assembly_minutes]`} type="number" /></td>
                    <td><input defaultValue={size.baking_minutes} min={1} name={`sizes[${index}][baking_minutes]`} type="number" /></td>
                    <td><input defaultValue={size.finishing_minutes} min={0} name={`sizes[${index}][finishing_minutes]`} type="number" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">La capacidad sugerida es editable para calibrar el horno real.</p>
        </section>

        {state.message ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        <div className="form-actions">
          <SubmitButton />
        </div>
      </form>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : "Guardar configuracion"}
    </button>
  );
}

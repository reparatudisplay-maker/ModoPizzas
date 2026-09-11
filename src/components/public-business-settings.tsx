"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { savePublicBusinessSettings, type FormActionState } from "@/app/admin/actions";

export type OpeningHour = { day: string; is_open: boolean; opens_at: string; closes_at: string };

export type PublicBusinessSettingsData = {
  business_name: string;
  whatsapp_number: string;
  public_phone: string | null;
  public_address: string | null;
  public_neighborhood: string | null;
  public_city: string | null;
  public_weekday_hours: string | null;
  public_weekend_hours: string | null;
  public_opening_hours: OpeningHour[] | null;
  public_maps_url: string | null;
  public_info_text: string | null;
  public_instagram_url: string | null;
  public_facebook_url: string | null;
};

const days = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
const defaultHours: OpeningHour[] = days.map((day) => ({ day, is_open: true, opens_at: day === "Domingo" ? "04:00" : "11:30", closes_at: "22:00" }));
const initialState: FormActionState = { status: "idle", message: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="positive-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar web publica"}</button>;
}

export function PublicBusinessSettings({ settings }: { settings: PublicBusinessSettingsData }) {
  const [state, action] = useActionState(savePublicBusinessSettings, initialState);
  const [hours, setHours] = useState<OpeningHour[]>(() => days.map((day) => settings.public_opening_hours?.find((item) => item.day === day) ?? defaultHours.find((item) => item.day === day)!));
  const updateHour = (index: number, patch: Partial<OpeningHour>) => setHours((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  return (
    <form action={action} className="form-panel public-business-settings">
      <input name="opening_hours" type="hidden" value={JSON.stringify(hours)} />
      <div className="form-section-title"><div><span>WEB PUBLICA</span><h2>Informacion del negocio</h2></div><p>Se muestra en la carta publica y define el enlace de pedido por WhatsApp.</p></div>
      {state.status !== "idle" ? <p className={state.status === "error" ? "alert" : "success-message"}>{state.message}</p> : null}
      <div className="form-grid">
        <label>Nombre comercial<input defaultValue={settings.business_name} name="business_name" required /></label>
        <label>WhatsApp de pedidos<input defaultValue={settings.whatsapp_number} inputMode="numeric" name="whatsapp_number" required placeholder="573170135775" /></label>
        <label>Telefono publico<input defaultValue={settings.public_phone ?? ""} name="public_phone" placeholder="+57 317 013 5775" /></label>
        <label>Direccion<input defaultValue={settings.public_address ?? ""} name="public_address" placeholder="Direccion del local" /></label>
        <label>Barrio<input defaultValue={settings.public_neighborhood ?? ""} name="public_neighborhood" /></label>
        <label>Ciudad<input defaultValue={settings.public_city ?? ""} name="public_city" /></label>
        <label>Instagram<input defaultValue={settings.public_instagram_url ?? ""} name="public_instagram_url" placeholder="https://instagram.com/..." type="url" /></label>
        <label>Facebook<input defaultValue={settings.public_facebook_url ?? ""} name="public_facebook_url" placeholder="https://facebook.com/..." type="url" /></label>
        <label className="span-2">Enlace de Google Maps<input defaultValue={settings.public_maps_url ?? ""} name="public_maps_url" placeholder="https://maps.app.goo.gl/..." type="url" /></label>
        <label className="span-2">Texto comercial<input defaultValue={settings.public_info_text ?? ""} name="public_info_text" placeholder="Un mensaje corto para quienes visitan la pizzeria." /></label>
      </div>
      <section className="public-hours-editor"><div><span>HORARIOS</span><h3>Atencion semanal</h3></div>{hours.map((hour, index) => <div className="public-hour-row" key={hour.day}><strong>{hour.day}</strong><label><input checked={hour.is_open} onChange={(event) => updateHour(index, { is_open: event.target.checked })} type="checkbox"/> Abierto</label><input aria-label={`Apertura ${hour.day}`} disabled={!hour.is_open} onChange={(event) => updateHour(index, { opens_at: event.target.value })} type="time" value={hour.opens_at}/><span>a</span><input aria-label={`Cierre ${hour.day}`} disabled={!hour.is_open} onChange={(event) => updateHour(index, { closes_at: event.target.value })} type="time" value={hour.closes_at}/></div>)}</section>
      <div className="form-actions"><SaveButton /></div>
    </form>
  );
}

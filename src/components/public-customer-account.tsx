"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LogOut, MapPin, Plus, RotateCcw, Trash2 } from "lucide-react";
import { formatCop } from "@/lib/format";
import { createClient } from "@/lib/supabase-browser";

type Address = { id: string; label: string; address_line: string; complement: string | null; is_default: boolean };
type Request = { id: string; channel: "whatsapp" | "direct"; status: string; kind: "pickup" | "delivery"; customer_name: string; customer_phone: string; delivery_address: string | null; notes: string | null; items: unknown; total_cop: number; created_at: string; accepted_order_id: string | null; rejection_reason: string | null };
type Customer = { id: string; full_name: string; phone: string; email: string };

function requestStatus(status: string) {
  return ({ whatsapp_opened: "Preparado para WhatsApp", pending: "En revisión", accepted: "Aceptado", rejected: "No aceptado", cancelled: "Cancelado" } as Record<string, string>)[status] ?? status;
}

export function PublicCustomerAccount({ customer: initialCustomer, addresses: initialAddresses, requests }: { customer: Customer; addresses: Address[]; requests: Request[] }) {
  const [customer, setCustomer] = useState(initialCustomer);
  const [addresses, setAddresses] = useState(initialAddresses);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const { error: updateError } = await createClient().from("profiles").update({ full_name: customer.full_name.trim(), phone: customer.phone.trim() }).eq("id", customer.id);
    setSaving(false);
    if (updateError) setError(updateError.message); else setMessage("Tus datos fueron actualizados.");
  }

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const { data, error: insertError } = await createClient().from("customer_addresses").insert({
      customer_id: customer.id,
      label: String(form.get("label") ?? "Dirección"),
      address_line: String(form.get("address_line") ?? ""),
      complement: String(form.get("complement") ?? "") || null,
      is_default: addresses.length === 0
    }).select("id, label, address_line, complement, is_default").single();
    setSaving(false);
    if (insertError || !data) { setError(insertError?.message ?? "No fue posible guardar la dirección."); return; }
    setAddresses((current) => [...current, data]); event.currentTarget.reset(); setMessage("Dirección guardada.");
  }

  async function deleteAddress(id: string) {
    const { error: deleteError } = await createClient().from("customer_addresses").delete().eq("id", id);
    if (deleteError) { setError(deleteError.message); return; }
    setAddresses((current) => current.filter((address) => address.id !== id));
  }

  async function signOut() { await createClient().auth.signOut(); window.location.assign("/"); }
  function reorder(items: unknown) { localStorage.setItem("modopizzas-public-reorder", JSON.stringify(items)); window.location.assign("/"); }

  return <main className="public-account-page"><header><Link href="/"><ArrowLeft size={18}/>Volver al menú</Link><button onClick={signOut} type="button"><LogOut size={17}/>Cerrar sesión</button></header><section className="public-account-heading"><span>MI CUENTA</span><h1>Hola, {customer.full_name || "cliente"}</h1><p>Consulta tus datos, direcciones y solicitudes recientes.</p></section>{error ? <p className="public-account-alert error" role="alert">{error}</p> : null}{message ? <p className="public-account-alert">{message}</p> : null}<div className="public-account-grid"><section><h2>Mis datos</h2><form onSubmit={saveProfile}><label>Nombre<input onChange={(event) => setCustomer((current) => ({ ...current, full_name: event.target.value }))} required value={customer.full_name}/></label><label>Teléfono<input inputMode="tel" onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))} required value={customer.phone}/></label><label>Correo<input disabled value={customer.email}/></label><button disabled={saving} type="submit">Guardar cambios</button></form></section><section><h2>Direcciones</h2><div className="public-address-list">{addresses.length ? addresses.map((address) => <article key={address.id}><MapPin size={18}/><div><b>{address.label}{address.is_default ? " · Predeterminada" : ""}</b><span>{address.address_line}{address.complement ? `, ${address.complement}` : ""}</span></div><button aria-label={`Eliminar ${address.label}`} onClick={() => deleteAddress(address.id)} type="button"><Trash2 size={16}/></button></article>) : <p>Aún no tienes direcciones guardadas.</p>}</div><form className="public-address-form" onSubmit={addAddress}><label>Nombre de la dirección<input defaultValue="Casa" name="label" required/></label><label>Dirección<input name="address_line" required/></label><label>Complemento<input name="complement"/></label><button disabled={saving} type="submit"><Plus size={16}/>Guardar dirección</button></form></section></div><section className="public-orders-history"><h2>Mis pedidos</h2>{requests.length ? <div>{requests.map((request) => <article key={request.id}><div><b>{request.kind === "delivery" ? "Domicilio" : "Recoger"}</b><span>{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.created_at))}</span></div><strong>{formatCop(request.total_cop)}</strong><span className={`public-request-status ${request.status}`}>{requestStatus(request.status)}</span><button onClick={() => reorder(request.items)} type="button"><RotateCcw size={15}/>Volver a pedir</button>{request.rejection_reason ? <small>{request.rejection_reason}</small> : null}</article>)}</div> : <p>Tus solicitudes nuevas aparecerán aquí.</p>}</section></main>;
}

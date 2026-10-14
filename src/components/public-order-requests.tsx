"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { acceptPublicOrderRequest, rejectPublicOrderRequest, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";

export type PublicOrderRequestRow = {
  id: string;
  channel: "whatsapp" | "direct";
  status: string;
  kind: "pickup" | "delivery";
  customer_name: string;
  customer_phone: string;
  delivery_address: string | null;
  notes: string | null;
  items: Array<{ quantity?: number; kind?: string }>;
  total_cop: number;
  created_at: string;
};

const initialState: FormActionState = { status: "idle", message: "" };

function RequestActions({ request }: { request: PublicOrderRequestRow }) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptPublicOrderRequest, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectPublicOrderRequest, initialState);
  return <div className="public-request-actions"><form action={acceptAction}><input name="request_id" type="hidden" value={request.id}/><button disabled={accepting || rejecting} type="submit"><Check size={15}/>{accepting ? "Aceptando..." : "Aceptar"}</button></form><form action={rejectAction}><input name="request_id" type="hidden" value={request.id}/><button disabled={accepting || rejecting} type="submit"><X size={15}/>{rejecting ? "Rechazando..." : "Rechazar"}</button></form>{acceptState.status !== "idle" ? <small className={acceptState.status}>{acceptState.message}</small> : null}{rejectState.status !== "idle" ? <small className={rejectState.status}>{rejectState.message}</small> : null}</div>;
}

export function PublicOrderRequests({ requests }: { requests: PublicOrderRequestRow[] }) {
  if (!requests.length) return null;
  return <section className="panel-card public-request-queue"><div><p className="eyebrow">Pedidos públicos</p><h2>Solicitudes por revisar</h2></div><div>{requests.map((request) => <article key={request.id}><div><strong>{request.customer_name}</strong><span>{request.customer_phone} · {request.kind === "delivery" ? request.delivery_address || "Domicilio" : "Recoger"}</span><small>{request.channel === "direct" ? "Pedido directo" : "WhatsApp abierto"} · {new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(request.created_at))}</small></div><p>{request.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)} productos · {formatCop(request.total_cop)}{request.notes ? ` · ${request.notes}` : ""}</p><RequestActions request={request}/></article>)}</div></section>;
}

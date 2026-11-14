import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypes = new Set(["page_view", "product_view", "product_order", "combo_select", "cta_click"]);
const entityKinds = new Set(["pizza_price", "sale_product", "combo"]);
const actions = new Set(["view", "order_now", "menu", "whatsapp", "checkout_whatsapp", "checkout_direct", "order", "select"]);

type SubmittedEvent = { type?: unknown; action?: unknown; entityKind?: unknown; entityId?: unknown };

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clientContext(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /CriOS|Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Other";
  const deviceType = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent) ? "tablet" : /Mobi|Android|iPhone|iPod/i.test(userAgent) ? "mobile" : userAgent ? "desktop" : "other";
  const operatingSystem = /Windows/i.test(userAgent) ? "Windows" : /Android/i.test(userAgent) ? "Android" : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS" : /Mac OS X/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : "Other";
  const safeHeader = (name: string) => {
    const value = request.headers.get(name) ?? "";
    try { return decodeURIComponent(value).replace(/[\r\n]/g, "").slice(0, 80); } catch { return ""; }
  };
  return {
    browser,
    deviceType,
    operatingSystem,
    country: safeHeader("x-vercel-ip-country"),
    city: safeHeader("x-vercel-ip-city")
  };
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") return false;
  if (!origin) return process.env.NODE_ENV !== "production";
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });

  let payload: { events?: SubmittedEvent[] };
  try { payload = await request.json() as { events?: SubmittedEvent[] }; } catch { return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 }); }
  const events = Array.isArray(payload.events) ? payload.events.slice(0, 12) : [];
  if (!events.length) return new NextResponse(null, { status: 204 });

  const context = clientContext(request);
  const accepted = events.flatMap((event) => {
    const type = text(event.type, 32);
    const action = text(event.action, 40);
    const entityKind = text(event.entityKind, 32);
    const entityId = text(event.entityId, 36);
    if (!eventTypes.has(type) || !actions.has(action)) return [];
    if ((entityKind || entityId) && (!entityKinds.has(entityKind) || !UUID.test(entityId))) return [];
    if (type === "page_view" && (entityKind || entityId)) return [];
    if (["product_view", "product_order"].includes(type) && !["pizza_price", "sale_product"].includes(entityKind)) return [];
    if (type === "combo_select" && entityKind !== "combo") return [];
    return [{ type, action, entityKind, entityId }];
  });
  if (!accepted.length) return new NextResponse(null, { status: 204 });

  const admin = createSupabaseAdminClient();
  if (!admin) return new NextResponse(null, { status: 204 });
  const grouped = new Map<string, { type: string; action: string; entityKind: string; entityId: string; count: number }>();
  for (const event of accepted) {
    const key = `${event.type}:${event.action}:${event.entityKind}:${event.entityId}`;
    const current = grouped.get(key) ?? { ...event, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  await Promise.all([...grouped.values()].map((event) => admin.rpc("increment_public_web_analytics", {
    p_hour_bucket: new Date().toISOString(),
    p_event_type: event.type,
    p_event_action: event.action,
    p_page_path: "/",
    p_entity_kind: event.entityKind,
    p_entity_id: event.entityId || null,
    p_browser: context.browser,
    p_device_type: context.deviceType,
    p_operating_system: context.operatingSystem,
    p_country: context.country,
    p_city: context.city,
    p_event_count: event.count
  })));
  return new NextResponse(null, { status: 204 });
}

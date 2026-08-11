"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Clock, Flame, PackageCheck } from "lucide-react";
import { updateKitchenOrderItemStatus, type FormActionState } from "@/app/admin/actions";
import { estimateKitchenMinutes, kitchenTimingState, type KitchenSettings } from "@/lib/kitchen-estimates";
import { createClient } from "@/lib/supabase-browser";
import { normalizeMasterText } from "@/lib/master-normalization";

export type KitchenItemStatus = "pending" | "in_preparation" | "prepared";

export type KitchenKdsItem = {
  id: string;
  order_id: string;
  order_item_id: string;
  order_code: string;
  order_kind: string;
  order_notes: string | null;
  confirmed_at: string;
  received_at: string;
  started_at: string | null;
  prepared_at: string | null;
  status: KitchenItemStatus;
  quantity: number;
  size_id: string | null;
  name: string;
  notes: string | null;
  additions: Array<{
    id: string;
    name: string;
    quantity: number;
    scope_label: string | null;
  }>;
};

const initialState: FormActionState = { status: "idle", message: "" };
const soundPreferenceKey = "modo-kitchen-sound-enabled";

const statusGroups: Array<{ key: KitchenItemStatus; title: string }> = [
  { key: "pending", title: "Pendientes" },
  { key: "in_preparation", title: "En preparacion" },
  { key: "prepared", title: "Preparados" }
];

function kindLabel(kind: string) {
  if (kind === "local") return "Local";
  if (kind === "pickup") return "Recoger";
  return "Domicilio";
}

function elapsedLabel(value: string, tick: number, endValue?: string | null) {
  void tick;
  const start = new Date(value).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  const diff = Math.max(0, end - start);
  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function minutesSince(value: string, tick: number, endValue?: string | null) {
  void tick;
  const start = new Date(value).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  return Math.floor(Math.max(0, end - start) / 60000);
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Bogota"
  }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Bogota"
  }).format(new Date(value));
}

function additionText(addition: KitchenKdsItem["additions"][number]) {
  const scope = addition.scope_label ? ` (${addition.scope_label})` : "";
  return `+ ${addition.name} x${addition.quantity}${scope}`;
}

export function KitchenKdsBoard({ items, settings }: { items: KitchenKdsItem[]; settings: KitchenSettings }) {
  const router = useRouter();
  const [boardItems, setBoardItems] = useState(items);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [newItemIds, setNewItemIds] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(soundPreferenceKey);
    return saved === null ? true : saved === "true";
  });
  const [soundReady, setSoundReady] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const normalizedQuery = normalizeMasterText(query);

  useEffect(() => {
    window.localStorage.setItem(soundPreferenceKey, String(soundEnabled));
  }, [soundEnabled]);

  function playKitchenTone() {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return false;
      const context = new AudioContextClass();
      if (context.state === "suspended") {
        void context.close();
        return false;
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
      window.setTimeout(() => void context.close(), 320);
      setSoundReady(true);
      setSoundBlocked(false);
      return true;
    } catch {
      return false;
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      const played = playKitchenTone();
      setSoundReady(played);
      setSoundBlocked(!played);
    } else {
      setSoundReady(false);
      setSoundBlocked(false);
    }
  }

  async function fetchKitchenItem(id: string): Promise<KitchenKdsItem | null> {
    const supabase = createClient();
    const { data: kitchenRow } = await supabase
      .from("kitchen_order_items")
      .select("id, order_id, order_item_id, status, received_at, started_at, prepared_at, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!kitchenRow) return null;

    const [{ data: order }, { data: orderItem }, { data: additions }] = await Promise.all([
      supabase
        .from("pos_orders")
        .select("id, code, kind, notes, created_at, status")
        .eq("id", kitchenRow.order_id)
        .maybeSingle(),
      supabase
        .from("pos_order_items")
        .select("id, quantity, product_name_snapshot, notes, pizza_price_configs(size_id)")
        .eq("id", kitchenRow.order_item_id)
        .maybeSingle(),
      supabase
        .from("pos_order_item_additions")
        .select("id, order_item_id, name_snapshot, quantity, scope_label")
        .eq("order_item_id", kitchenRow.order_item_id)
        .order("created_at")
    ]);

    if (!order || !orderItem || order.status === "cancelled" || order.status === "delivered") return null;
    const priceConfig = Array.isArray(orderItem.pizza_price_configs) ? orderItem.pizza_price_configs[0] : orderItem.pizza_price_configs;
    return {
      id: kitchenRow.id,
      order_id: kitchenRow.order_id,
      order_item_id: kitchenRow.order_item_id,
      order_code: order.code,
      order_kind: order.kind,
      order_notes: order.notes,
      confirmed_at: order.created_at,
      received_at: kitchenRow.received_at ?? kitchenRow.created_at,
      started_at: kitchenRow.started_at,
      prepared_at: kitchenRow.prepared_at,
      status: kitchenRow.status as KitchenItemStatus,
      quantity: Number(orderItem.quantity ?? 0),
      size_id: priceConfig?.size_id ?? null,
      name: orderItem.product_name_snapshot,
      notes: orderItem.notes,
      additions: (additions ?? []).map((addition) => ({
        id: addition.id,
        name: addition.name_snapshot,
        quantity: Number(addition.quantity ?? 0),
        scope_label: addition.scope_label
      }))
    };
  }

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!soundEnabled || soundReady) return undefined;
    const unlock = () => {
      const played = playKitchenTone();
      setSoundReady(played);
      setSoundBlocked(!played);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundEnabled, soundReady]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("kitchen-kds")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kitchen_order_items" }, async (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (!id) return;
        const item = await fetchKitchenItem(id);
        if (!item) return;
        setBoardItems((current) => (current.some((existing) => existing.id === item.id) ? current : [...current, item]));
        setNewItemIds((current) => [...current, item.id]);
        window.setTimeout(() => setNewItemIds((current) => current.filter((newId) => newId !== item.id)), 2800);
        if (soundEnabled) {
          const played = playKitchenTone();
          if (!played) setSoundBlocked(true);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kitchen_order_items" }, async (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (!id) return;
        const item = await fetchKitchenItem(id);
        setBoardItems((current) => (item ? current.map((existing) => (existing.id === id ? item : existing)) : current.filter((existing) => existing.id !== id)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "kitchen_order_items" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        setBoardItems((current) => current.filter((item) => item.id !== id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_orders" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_order_items" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_order_item_additions" }, () => router.refresh())
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") router.refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, soundEnabled]);

  const filteredItems = useMemo(
    () =>
      boardItems.filter((item) => {
        const text = [
          item.order_code,
          item.name,
          item.notes,
          item.order_notes,
          kindLabel(item.order_kind),
          ...item.additions.map(additionText)
        ].join(" ");
        return !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
      }),
    [boardItems, normalizedQuery]
  );

  const sortedItems = useMemo(
    () => [...filteredItems].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime()),
    [filteredItems]
  );

  const estimateById = useMemo(() => {
    const result = new Map<string, number>();
    const activeItems = sortedItems.filter((item) => item.status !== "prepared");
    activeItems.forEach((item, index) => {
      result.set(item.id, estimateKitchenMinutes(item, activeItems.slice(0, index), settings));
    });
    sortedItems.filter((item) => item.status === "prepared").forEach((item) => result.set(item.id, estimateKitchenMinutes(item, [], settings)));
    return result;
  }, [settings, sortedItems]);

  return (
    <section className="kds-board-shell">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Pedidos en cocina</h2>
        <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
          <button
            className="ghost-button icon-text-button"
            onClick={toggleSound}
            type="button"
          >
            {soundEnabled ? "🔊 Sonido activado" : "🔇 Sonido desactivado"}
          </button>
          <label className="pos-search compact-search">
            <Flame size={18} />
            <input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pedido o pizza" value={query} />
          </label>
        </form>
      </div>
      <div className="kds-board">
        {statusGroups.map((group) => {
          const groupItems = sortedItems.filter((item) => item.status === group.key);
          return (
            <section className={`kds-column ${group.key}`} key={group.key}>
              <header>
                <strong>{group.title}</strong>
                <span>{groupItems.length}</span>
              </header>
              <div className="kds-card-stack">
                {groupItems.map((item) => (
                  <KitchenCard
                    estimateMinutes={estimateById.get(item.id) ?? 0}
                    isNew={newItemIds.includes(item.id)}
                    item={item}
                    key={item.id}
                    settings={settings}
                    tick={tick}
                  />
                ))}
                {groupItems.length === 0 ? <p className="empty-state">Sin lineas.</p> : null}
              </div>
            </section>
          );
        })}
      </div>
      {soundBlocked && soundEnabled ? <p className="form-status error">Activa el sonido con el boton para recibir avisos audibles.</p> : null}
    </section>
  );
}

function KitchenCard({
  estimateMinutes,
  isNew,
  item,
  settings,
  tick
}: {
  estimateMinutes: number;
  isNew: boolean;
  item: KitchenKdsItem;
  settings: KitchenSettings;
  tick: number;
}) {
  const elapsedMinutes = minutesSince(item.received_at, tick, item.status === "prepared" ? item.prepared_at : null);
  const timingState = kitchenTimingState(elapsedMinutes, estimateMinutes, settings);
  return (
    <article className={`kds-card ${item.status} timing-${timingState} ${isNew ? "new-arrival" : ""}`}>
      <header className="kds-card-header">
        <div>
          <strong>{item.order_code}</strong>
          <span>{kindLabel(item.order_kind)}</span>
        </div>
        <span className="kds-timer"><Clock size={16} /> {elapsedLabel(item.received_at, tick, item.status === "prepared" ? item.prepared_at : null)}</span>
      </header>
      <div className="kds-arrival">
        <strong>{timeLabel(item.received_at)}</strong>
        <small>{dateLabel(item.received_at)}</small>
      </div>
      <div className="kds-item-main">
        <span className="kds-quantity">x{item.quantity}</span>
        <div>
          <strong>{item.name}</strong>
          {item.name.includes("/") ? <small>Mitad y mitad</small> : null}
        </div>
      </div>
      {item.notes ? <p className="kds-note">{item.notes}</p> : null}
      {item.additions.length > 0 ? (
        <div className="kds-additions">
          {item.additions.map((addition) => (
            <span key={addition.id}>{additionText(addition)}</span>
          ))}
        </div>
      ) : null}
      {item.order_notes ? <p className="kds-note muted">Obs: {item.order_notes}</p> : null}
      <p className="kds-eta">Estimado: <strong>{estimateMinutes} min</strong></p>
      <div className="kds-card-actions">
        {item.status === "pending" ? <KitchenStatusButton id={item.id} nextStatus="in_preparation" label="Iniciar preparacion" /> : null}
        {item.status === "in_preparation" ? <KitchenStatusButton id={item.id} nextStatus="prepared" label="Marcar preparado" /> : null}
        {item.status === "prepared" ? <span className="stock-pill ok"><PackageCheck size={14} /> Preparado</span> : null}
      </div>
    </article>
  );
}

function KitchenStatusButton({ id, nextStatus, label }: { id: string; nextStatus: KitchenItemStatus; label: string }) {
  const [state, action] = useActionState(updateKitchenOrderItemStatus, initialState);
  return (
    <form action={action} className="kds-action-form">
      <input name="kitchen_order_item_id" type="hidden" value={id} />
      <input name="status" type="hidden" value={nextStatus} />
      <SubmitKitchenButton label={label} />
      {state.status === "error" ? <span className="row-action-message error">{state.message}</span> : null}
    </form>
  );
}

function SubmitKitchenButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="positive-button kds-status-button" disabled={pending} type="submit">
      {pending ? "Actualizando..." : label}
    </button>
  );
}

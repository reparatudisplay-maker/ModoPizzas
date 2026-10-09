"use client";

import { BellRing, Check, Clock3, MessageCircle, Moon, PhoneCall, Send, Sun, X } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

type ThemeMode = "light" | "dark";
type TogglePosition = { x: number; y: number };
type OperationsModule = "caja" | "cocina";
type CommunicationKind = "message" | "call";
type Communication = { id: string; origin_module: OperationsModule; target_module: OperationsModule; communication_kind: CommunicationKind; body: string; sender_user_id: string; sender_name_snapshot: string; created_at: string; acknowledged_at: string | null };

const positionStorageKey = "modoPizzasThemeTogglePosition";
const toggleSize = 44;
const edgePadding = 14;
const quickMessages = ["Pedido listo", "Ven a caja", "Revisa este pedido", "Necesito apoyo", "Cliente esperando"];

function readStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem("modo-pizzas-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clampPosition(position: TogglePosition) {
  if (typeof window === "undefined") return position;
  return { x: Math.min(Math.max(edgePadding, position.x), Math.max(edgePadding, window.innerWidth - toggleSize - edgePadding)), y: Math.min(Math.max(edgePadding, position.y), Math.max(edgePadding, window.innerHeight - toggleSize - edgePadding)) };
}

function initialPosition(): TogglePosition {
  if (typeof window === "undefined") return { x: edgePadding, y: edgePadding };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(positionStorageKey) ?? "{}");
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return clampPosition({ x: parsed.x, y: parsed.y });
  } catch {
    window.localStorage.removeItem(positionStorageKey);
  }
  return clampPosition({ x: edgePadding, y: window.innerHeight - toggleSize - 128 });
}

function moduleLabel(module: OperationsModule) { return module === "cocina" ? "Cocina" : "Caja"; }
function timeLabel(value: string) { return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(new Date(value)); }

function playAttentionTone() {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(980, context.currentTime + 0.13);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
    window.setTimeout(() => void context.close(), 450);
  } catch {
    // Browsers can require a prior interaction before permitting notification audio.
  }
}

export function ThemeToggle({ communicationModule }: { communicationModule?: OperationsModule | null }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [position, setPosition] = useState<TogglePosition>({ x: edgePadding, y: edgePadding });
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Communication[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<Communication | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<Communication | null>(null);
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean; position: TogglePosition } | null>(null);

  const destinationModule = communicationModule === "caja" ? "cocina" : "caja";
  const unreadMessages = useMemo(() => messages.filter((item) => item.target_module === communicationModule && !item.acknowledged_at && item.sender_user_id !== currentUserId), [communicationModule, currentUserId, messages]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setTheme(readStoredTheme()); setPosition(initialPosition()); }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    function keepInsideViewport() {
      setPosition((current) => {
        const next = clampPosition(current);
        window.localStorage.setItem(positionStorageKey, JSON.stringify(next));
        return next;
      });
    }
    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, []);

  useEffect(() => {
    if (!communicationModule) return;
    const supabase = createClient();
    let active = true;
    const load = async () => {
      const [{ data: auth }, { data, error }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("internal_operations_communications").select("id, origin_module, target_module, communication_kind, body, sender_user_id, sender_name_snapshot, created_at, acknowledged_at").order("created_at", { ascending: false }).limit(30)
      ]);
      if (!active) return;
      setCurrentUserId(auth.user?.id ?? null);
      if (!error) setMessages((data ?? []) as Communication[]);
    };
    void load();
    const channel = supabase
      .channel(`internal-operations-${communicationModule}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_operations_communications" }, (payload) => {
        const item = payload.new as Communication;
        if (!item?.id) return;
        setMessages((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 30));
        if (item.target_module === communicationModule && item.sender_user_id !== currentUserId) {
          if (item.communication_kind === "call") {
            setIncomingCall(item);
            playAttentionTone();
          } else {
            setIncomingMessage(item);
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "internal_operations_communications" }, (payload) => {
        const item = payload.new as Communication;
        setMessages((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [communicationModule, currentUserId]);

  async function refreshMessages() {
    if (!communicationModule) return;
    const { data } = await createClient().from("internal_operations_communications").select("id, origin_module, target_module, communication_kind, body, sender_user_id, sender_name_snapshot, created_at, acknowledged_at").order("created_at", { ascending: false }).limit(30);
    if (data) setMessages(data as Communication[]);
  }

  async function acknowledge(ids: string[]) {
    if (!ids.length) return;
    const { error } = await createClient().rpc("acknowledge_internal_operations_communications", { p_communication_ids: ids });
    if (!error) setMessages((current) => current.map((item) => (ids.includes(item.id) ? { ...item, acknowledged_at: new Date().toISOString() } : item)));
  }

  function closeSecondaryPanels() {
    setComposerOpen(false);
    setIncomingMessage(null);
  }

  function openComposer() {
    closeSecondaryPanels();
    if (incomingCall) void acknowledge([incomingCall.id]);
    setIncomingCall(null);
    setCalling(false);
    setNotice("");
    setComposerOpen(true);
    void acknowledge(unreadMessages.map((item) => item.id));
  }

  function selectTheme() {
    closeSecondaryPanels();
    if (incomingCall) void acknowledge([incomingCall.id]);
    setIncomingCall(null);
    setCalling(false);
    setNotice("");
    toggleTheme();
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("modo-pizzas-theme", nextTheme);
  }

  function moveToggle(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = clampPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY });
    if (Math.abs(next.x - position.x) > 1 || Math.abs(next.y - position.y) > 1) drag.moved = true;
    drag.position = next;
    setPosition(next);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finalPosition = clampPosition(drag.position);
    window.localStorage.setItem(positionStorageKey, JSON.stringify(finalPosition));
    setPosition(finalPosition);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function send(kind: CommunicationKind, body?: string) {
    if (!communicationModule || sending || calling) return;
    const text = (body ?? message).trim();
    if (kind === "message" && !text) { setNotice("Escribe un mensaje antes de enviarlo."); return; }
    setNotice("");
    if (kind === "call") {
      closeSecondaryPanels();
      if (incomingCall) void acknowledge([incomingCall.id]);
      setIncomingCall(null);
      setCalling(true);
    }
    else setSending(true);
    const { error } = await createClient().rpc("send_internal_operations_communication", { p_origin_module: communicationModule, p_target_module: destinationModule, p_communication_kind: kind, p_body: text || null });
    if (error) setNotice(error.message);
    else {
      if (kind === "message") { setMessage(""); setComposerOpen(false); setNotice("Mensaje enviado."); }
      else setNotice(`Llamando a ${moduleLabel(destinationModule)}.`);
      void refreshMessages();
    }
    if (kind === "call") window.setTimeout(() => setCalling(false), 5000);
    else setSending(false);
  }

  const isRightSide = typeof window !== "undefined" && position.x > window.innerWidth / 2;
  const recentMessages = messages.slice(0, 5);

  return (
    <div className={`theme-toggle-shell ${isRightSide ? "is-right" : ""}`} style={{ left: `${position.x}px`, top: `${position.y}px` }}>
      {communicationModule && menuOpen ? <section aria-label="Comunicacion interna" className="operations-quick-panel">
        <div className="operations-quick-heading"><div><strong>{moduleLabel(communicationModule)}</strong><span>Canal con {moduleLabel(destinationModule)}</span></div>{unreadMessages.length ? <b aria-label={`${unreadMessages.length} mensajes sin leer`}>{unreadMessages.length}</b> : null}</div>
        <div className="operations-quick-actions">
          <button onClick={selectTheme} type="button"><span>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</span>Cambiar tema</button>
          <button onClick={openComposer} type="button"><span><MessageCircle size={17} /></span>Mensaje a {moduleLabel(destinationModule)}</button>
          <button disabled={calling} onClick={() => void send("call")} type="button"><span><PhoneCall size={17} /></span>{calling ? "Llamando..." : `Llamar a ${moduleLabel(destinationModule)}`}</button>
        </div>
        <div className="operations-history"><div><Clock3 size={14} /><strong>Recientes</strong></div>{recentMessages.length ? recentMessages.map((item) => <article className={!item.acknowledged_at && item.target_module === communicationModule ? "unread" : ""} key={item.id}><span>{item.communication_kind === "call" ? <BellRing size={13} /> : <MessageCircle size={13} />}</span><p><strong>{item.sender_name_snapshot}</strong>{item.body}<small>{timeLabel(item.created_at)}</small></p></article>) : <p className="operations-history-empty">Aún no hay mensajes.</p>}</div>
        {notice ? <p className="operations-quick-notice">{notice}</p> : null}
      </section> : null}
      <button aria-label={communicationModule ? "Abrir comunicación y tema" : "Cambiar tema"} className="theme-toggle" onClick={() => {
        if (dragRef.current?.moved) { dragRef.current = null; return; }
        dragRef.current = null;
        if (!communicationModule) toggleTheme();
        else {
          setMenuOpen((current) => !current);
          void refreshMessages();
          void acknowledge(unreadMessages.map((item) => item.id));
        }
      }} onPointerCancel={(event) => { finishDrag(event); dragRef.current = null; }} onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - position.x, offsetY: event.clientY - position.y, moved: false, position };
      }} onPointerMove={moveToggle} onPointerUp={finishDrag} title={communicationModule ? `Comunicación con ${moduleLabel(destinationModule)}` : "Cambiar tema"} type="button">
        {theme === "dark" ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
        {communicationModule && unreadMessages.length ? <b className="operations-unread-badge">{unreadMessages.length > 9 ? "9+" : unreadMessages.length}</b> : null}
      </button>
      {communicationModule && composerOpen ? <div aria-modal="true" className="operations-message-dialog" role="dialog">
        <header><div><span>Mensaje a {moduleLabel(destinationModule)}</span><strong>Comunicación interna</strong></div><button aria-label="Cerrar mensaje" className="icon-button" onClick={() => setComposerOpen(false)} type="button"><X size={17} /></button></header>
        <div className="operations-quick-replies">{quickMessages.map((item) => <button key={item} onClick={() => setMessage(item)} type="button">{item}</button>)}</div>
        <textarea autoFocus maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder={`Escribe para ${moduleLabel(destinationModule)}...`} value={message} />
        {notice ? <p className="operations-dialog-notice">{notice}</p> : null}
        <footer><button className="ghost-button" onClick={() => setComposerOpen(false)} type="button">Cancelar</button><button className="primary-button" disabled={sending || !message.trim()} onClick={() => void send("message")} type="button"><Send size={16} />{sending ? "Enviando" : "Enviar"}</button></footer>
      </div> : null}
      {incomingCall ? <div aria-live="assertive" aria-modal="true" className="operations-call-alert" role="alertdialog"><BellRing aria-hidden="true" size={27} /><div><span>Llamada interna</span><strong>{incomingCall.sender_name_snapshot} está llamando a {moduleLabel(communicationModule!)}</strong><p>{incomingCall.body}</p></div><button onClick={() => { void acknowledge([incomingCall.id]); setIncomingCall(null); }} type="button"><Check size={17} />Entendido</button></div> : null}
      {incomingMessage ? <div aria-live="polite" className="operations-message-alert" role="status"><MessageCircle aria-hidden="true" size={20} /><div><span>Mensaje de {incomingMessage.sender_name_snapshot}</span><strong>{incomingMessage.body}</strong></div><button onClick={() => { setMenuOpen(true); void acknowledge([incomingMessage.id]); setIncomingMessage(null); }} type="button">Ver</button><button aria-label="Cerrar aviso" className="icon-button" onClick={() => setIncomingMessage(null)} type="button"><X size={15} /></button></div> : null}
    </div>
  );
}

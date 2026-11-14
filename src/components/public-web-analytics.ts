"use client";

import { useCallback, useEffect, useRef } from "react";

type EntityKind = "pizza_price" | "sale_product" | "combo";
type EventType = "page_view" | "product_view" | "product_order" | "combo_select" | "cta_click";

export type PublicAnalyticsEvent = {
  type: EventType;
  action?: string;
  entityKind?: EntityKind;
  entityId?: string;
};

const sentPageViews = new Set<string>();

function send(events: PublicAnalyticsEvent[]) {
  if (!events.length) return;
  const body = JSON.stringify({ events });
  void fetch("/api/public-analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin"
  }).catch(() => {
    // Analytics must never interrupt a public ordering flow.
  });
}

export function usePublicWebAnalytics() {
  const tracked = useRef(new Set<string>());

  useEffect(() => {
    const pageKey = window.location.pathname;
    if (sentPageViews.has(pageKey)) return;
    sentPageViews.add(pageKey);
    send([{ type: "page_view", action: "view" }]);
  }, []);

  return useCallback((event: PublicAnalyticsEvent) => {
    const key = `${event.type}:${event.action ?? ""}:${event.entityKind ?? ""}:${event.entityId ?? ""}`;
    if (tracked.current.has(key) && event.type === "product_view") return;
    tracked.current.add(key);
    send([event]);
  }, []);
}

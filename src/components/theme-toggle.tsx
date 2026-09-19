"use client";

import { Moon, Sun } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

type ThemeMode = "light" | "dark";
type TogglePosition = { x: number; y: number };

const positionStorageKey = "modoPizzasThemeTogglePosition";
const toggleSize = 44;
const edgePadding = 14;

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("modo-pizzas-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clampPosition(position: TogglePosition) {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(edgePadding, position.x), Math.max(edgePadding, window.innerWidth - toggleSize - edgePadding)),
    y: Math.min(Math.max(edgePadding, position.y), Math.max(edgePadding, window.innerHeight - toggleSize - edgePadding))
  };
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

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [position, setPosition] = useState<TogglePosition>(initialPosition);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean; position: TogglePosition } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  return (
    <button
      aria-label="Cambiar tema"
      className="theme-toggle"
      onClick={() => {
        if (dragRef.current?.moved) {
          dragRef.current = null;
          return;
        }
        dragRef.current = null;
        toggleTheme();
      }}
      onPointerCancel={(event) => {
        finishDrag(event);
        dragRef.current = null;
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - position.x, offsetY: event.clientY - position.y, moved: false, position };
      }}
      onPointerMove={moveToggle}
      onPointerUp={finishDrag}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      title="Cambiar tema"
      type="button"
    >
      {theme === "dark" ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
    </button>
  );
}

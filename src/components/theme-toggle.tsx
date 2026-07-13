"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("modo-pizzas-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("modo-pizzas-theme", nextTheme);
  }

  return (
    <button className="theme-toggle" title="Cambiar modo claro/oscuro" type="button" onClick={toggleTheme}>
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
      <span>{theme === "dark" ? "Claro" : "Oscuro"}</span>
    </button>
  );
}

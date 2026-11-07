"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";
const storageKey = "modo-pizzas-theme";

function getInitialTheme(): ThemeMode {
  const saved = window.localStorage.getItem(storageKey);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemePreferencesModule() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const timeout = window.setTimeout(() => setTheme(getInitialTheme()), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function selectTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  return (
    <section aria-labelledby="appearance-settings-title" className="form-panel settings-preferences-panel">
      <div className="settings-preferences-heading">
        <div>
          <p>Preferencias</p>
          <h2 id="appearance-settings-title">Apariencia</h2>
        </div>
      </div>
      <div className="settings-preference-row">
        <div>
          <strong>Tema del sistema</strong>
          <span>Se guarda solo en este navegador.</span>
        </div>
        <div aria-label="Tema del sistema" className="segmented-control" role="group">
          <button aria-pressed={theme === "light"} className={theme === "light" ? "active" : ""} onClick={() => selectTheme("light")} type="button"><Sun size={16} />Claro</button>
          <button aria-pressed={theme === "dark"} className={theme === "dark" ? "active" : ""} onClick={() => selectTheme("dark")} type="button"><Moon size={16} />Oscuro</button>
        </div>
      </div>
    </section>
  );
}

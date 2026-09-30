"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = next === "dark" ? "#0f1714" : "#f5f6f3";
    setTheme(next);
  }
  useEffect(() => {
    apply(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        apply(event.newValue === "light" ? "light" : "dark");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const label = theme === "dark" ? "Activar modo claro" : "Activar modo oscuro";
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        apply(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          /* The toggle still works when browser storage is blocked. */
        }
      }}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

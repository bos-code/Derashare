import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// The theme lives on <html data-theme>, set before paint by themeInitScript in the layout.
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {}
  };

  return { dark, toggleTheme };
}

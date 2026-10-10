import { useEffect, useState } from "react";

const STORAGE_KEY = "dera-theme";

export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    setDark(saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  const toggleTheme = () =>
    setDark((v) => {
      localStorage.setItem(STORAGE_KEY, !v ? "dark" : "light");
      return !v;
    });

  return { dark, toggleTheme };
}

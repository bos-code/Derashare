export const THEME_STORAGE_KEY = "dera-theme";

// Runs inline in <head> before first paint, so a saved or system dark theme never flashes light.
// Keep it dependency-free: it is injected as a string.
export const themeInitScript = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

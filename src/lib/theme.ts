export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "payadmin_theme";
export const THEME_BOOTSTRAP = `(()=>{let theme="dark";try{const saved=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(saved==="light"||saved==="dark")theme=saved;}catch{}document.documentElement.dataset.theme=theme;})();`;

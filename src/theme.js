const storageKey = "panghu-theme";

export function getTheme() {
  return document.documentElement.dataset.theme || "light";
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(storageKey, theme);
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

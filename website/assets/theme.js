(() => {
  const key = "dayboard-site-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const validChoice = (value) => (value === "light" || value === "dark" ? value : null);
  let choice = null;
  try {
    choice = validChoice(localStorage.getItem(key));
  } catch {
    // A blocked storage area still permits changing this page's appearance.
  }

  const apply = () => {
    const theme = choice ?? (system.matches ? "dark" : "light");
    root.dataset.theme = theme;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.removeAttribute("media");
      meta.content = theme === "dark" ? "#151412" : "#f6f2ea";
    }
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.title = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
      button.setAttribute(
        "aria-label",
        `${theme === "dark" ? "Dark" : "Light"} theme. ${button.title}`,
      );
      button.querySelector(".theme-label").textContent = theme === "dark" ? "Dark" : "Light";
    }
  };

  // This script runs before the stylesheet, so saved appearance is applied before first paint.
  apply();
  system.addEventListener("change", () => {
    if (choice === null) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    choice = validChoice(event.newValue);
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.hidden = false;
      button.addEventListener("click", () => {
        choice = root.dataset.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(key, choice);
        } catch {
          // Keep the current page usable when the browser disables persistent storage.
        }
        apply();
      });
    }
    apply();
  });
})();

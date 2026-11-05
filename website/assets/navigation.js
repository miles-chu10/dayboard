for (const menu of document.querySelectorAll(".mobile-menu")) {
  const trigger = menu.querySelector("summary");
  const close = (restoreFocus = false) => {
    menu.open = false;
    if (restoreFocus) trigger.focus();
  };
  menu.addEventListener("toggle", () => {
    trigger.setAttribute("aria-label", menu.open ? "Close navigation" : "Open navigation");
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      close(true);
    }
  });
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (event) => {
    if (event.matches) close();
  });
}

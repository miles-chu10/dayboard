// Moves the pinned source notes out of the way once the hero video starts, so they don't cover it.
const player = document.querySelector(".c-player");
player?.addEventListener("play", () => player.closest(".board")?.classList.add("is-playing"), {
  once: true,
});

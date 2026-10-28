// Plays the hero video muted while at least half of it is on screen, and pauses it when it scrolls
// away, until the viewer takes over (pauses, seeks or turns the sound on) or it ends. Skipped when
// the viewer prefers reduced motion or saves data. The pinned source notes step aside once it plays.
const player = document.querySelector(".c-player");
const unmute = document.querySelector(".c-unmute");

if (player) {
  player.addEventListener("play", () => player.closest(".board")?.classList.add("is-playing"), {
    once: true,
  });

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData === true;
  if (!reduceMotion && !saveData && "IntersectionObserver" in window) autoplay(player);
}

function autoplay(video) {
  let pausing = false;
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.intersectionRatio >= 0.5) {
        // Browsers can still refuse (Low Power Mode, site settings); the poster and controls stay.
        video.play().catch(() => {});
      } else if (!video.paused) {
        pausing = true;
        video.pause();
      }
    },
    { threshold: 0.5 },
  );
  const release = () => observer.disconnect();
  const showUnmute = () => {
    if (unmute) unmute.hidden = !(video.muted && !video.paused);
  };

  video.muted = true;
  video.addEventListener("pause", () => {
    if (!pausing && !video.ended) release();
    pausing = false;
    showUnmute();
  });
  video.addEventListener("playing", showUnmute);
  video.addEventListener("seeking", release);
  video.addEventListener("ended", release);
  video.addEventListener("volumechange", () => {
    if (!video.muted) release();
    showUnmute();
  });
  unmute?.addEventListener("click", () => {
    video.muted = false;
    video.play().catch(() => {});
  });
  observer.observe(video);
}

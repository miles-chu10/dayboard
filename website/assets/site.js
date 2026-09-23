// Set these values only after the release artifacts and merchant checkout are verified.
// Keep all public release destinations in this one file.
const SITE_CONFIG = Object.freeze({
  downloadUrl: "",
  checkoutUrl: "",
  screenshotUrl: "assets/agenda-demo.png",
  priceLabel: "",
  trialLabel: "",
});

function isPublicUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

for (const element of document.querySelectorAll("[data-download]")) {
  if (isPublicUrl(SITE_CONFIG.downloadUrl)) {
    element.href = SITE_CONFIG.downloadUrl;
    element.textContent = "Download for macOS";
    element.removeAttribute("aria-disabled");
    element.classList.remove("is-unavailable");
  }
}

if (isPublicUrl(SITE_CONFIG.downloadUrl)) {
  for (const element of document.querySelectorAll("[data-release-status]")) {
    element.textContent = "Official macOS download available";
  }
  for (const element of document.querySelectorAll("[data-release-note]")) {
    element.textContent = "Download the official macOS build from this site.";
  }
}

for (const element of document.querySelectorAll("[data-checkout]")) {
  if (isPublicUrl(SITE_CONFIG.checkoutUrl)) {
    element.href = SITE_CONFIG.checkoutUrl;
    element.textContent = "Buy the official build";
    element.hidden = false;
  }
}

for (const element of document.querySelectorAll("[data-price]")) {
  if (SITE_CONFIG.priceLabel) {
    element.textContent = SITE_CONFIG.priceLabel;
    element.hidden = false;
  }
}

for (const element of document.querySelectorAll("[data-trial]")) {
  if (SITE_CONFIG.trialLabel) {
    element.textContent = SITE_CONFIG.trialLabel;
    element.hidden = false;
  }
}

for (const element of document.querySelectorAll("[data-screenshot]")) {
  if (isPublicUrl(SITE_CONFIG.screenshotUrl) || SITE_CONFIG.screenshotUrl.startsWith("assets/")) {
    const image = new Image();
    image.src = SITE_CONFIG.screenshotUrl;
    image.alt = "DayBoard Agenda shown with fictional example data";
    image.onload = () => {
      element.replaceChildren(image);
      element.classList.add("has-screenshot");
    };
  }
}

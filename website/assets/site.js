// Public destinations live here. Point betaSignupUrl at the deployed DayBoard service's
// /v1/beta-signup endpoint, and set contactEmail to the private address people use to ask for
// removal. The signup forms stay closed until both are set.
const SITE_CONFIG = Object.freeze({
  betaSignupUrl: "https://api.getdayboard.com/v1/beta-signup",
  contactEmail: "hello@getdayboard.com",
});

const contactEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(SITE_CONFIG.contactEmail)
  ? SITE_CONFIG.contactEmail
  : null;
for (const link of document.querySelectorAll("a[data-contact]")) {
  if (!contactEmail) continue;
  link.href = `mailto:${contactEmail}`;
  link.textContent = contactEmail;
}

const MESSAGES = {
  invalid: "Enter a valid email address.",
  invalid_email: "That email address doesn't look right.",
  rate_limited: "Too many tries from this network. Wait a minute and try again.",
  failed: "Something went wrong on our side. Try again in a moment.",
  offline: "Couldn't reach the signup service. Check your connection and try again.",
};

function signupEndpoint() {
  try {
    const url = new URL(SITE_CONFIG.betaSignupUrl);
    // Plain HTTP is accepted only while previewing the site on this Mac.
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    return url.protocol === "https:" || (local && url.protocol === "http:") ? url.href : null;
  } catch {
    return null;
  }
}

function markJoined(form) {
  const done = document.createElement("div");
  done.className = "signup-done";
  done.tabIndex = -1;
  done.innerHTML =
    '<span class="check" aria-hidden="true">✓</span><div><strong>You\'re on the list.</strong>' +
    "<p>We'll email you a download link when your beta invite is ready.</p></div>";
  form.replaceChildren(done);
  return done;
}

function setupSignup(form, endpoint) {
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".signup-status");
  const note = form.querySelector(".signup-note");

  // Controls ship disabled so the form can't submit without this script.
  if (!endpoint || !contactEmail) {
    note.textContent = "Beta signups open soon. Check back shortly.";
    return;
  }
  input.disabled = false;
  button.disabled = false;

  const fail = (message) => {
    status.dataset.tone = "error";
    status.textContent = message;
    button.disabled = false;
    button.textContent = button.dataset.label;
    form.removeAttribute("aria-busy");
  };

  button.dataset.label = button.textContent;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.checkValidity()) {
      fail(MESSAGES.invalid);
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "Joining…";
    form.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: input.value.trim(),
          company: form.elements.company.value,
        }),
      });
      if (response.ok) {
        const forms = document.querySelectorAll("form[data-signup]");
        const done = markJoined(form);
        for (const other of forms) if (other !== form) markJoined(other);
        done.focus();
        return;
      }
      const body = await response.json().catch(() => ({}));
      fail(MESSAGES[body.error] ?? MESSAGES.failed);
    } catch {
      fail(MESSAGES.offline);
    }
  });
}

const endpoint = signupEndpoint();
for (const form of document.querySelectorAll("form[data-signup]")) setupSignup(form, endpoint);

// Screenshot tabs (e.g. Calendar week/month).
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const revealed = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealed.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -12% 0px" },
);
for (const element of document.querySelectorAll("[data-reveal], .merge")) revealed.observe(element);

// Public destinations live here. Point waitlistUrl at the deployed DayBoard service's /v1/waitlist
// endpoint, and set contactEmail to the private address people use to ask for removal. The
// waitlist forms stay closed until both are set.
const SITE_CONFIG = Object.freeze({
  waitlistUrl: "https://api.getdayboard.com/v1/waitlist",
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
  offline: "Couldn't reach the waitlist. Check your connection and try again.",
  timeout: "The waitlist didn't answer in time. Check your connection and try again.",
};
// A stalled request is abandoned after this long, so the form never stays stuck.
const TIMEOUT_MS = 15000;

function signupEndpoint() {
  try {
    const url = new URL(SITE_CONFIG.waitlistUrl);
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
    '<span class="check" aria-hidden="true">✓</span>' +
    "<div><strong>You're on the waitlist.</strong>" +
    "<p>We invite people in small groups, with no set dates. If a spot opens for you, we'll" +
    " email this address.</p></div>";
  form.replaceChildren(done);
  form.removeAttribute("aria-busy");
  return done;
}

// Resolves to "ok" only for the API's exact {"ok": true} success; anything else is a MESSAGES key.
async function postSignup(endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (controller.signal.aborted) return "timeout";
    if (response.ok && body?.ok === true) return "ok";
    return Object.hasOwn(MESSAGES, body?.error) ? body.error : "failed";
  } catch {
    return controller.signal.aborted ? "timeout" : "offline";
  } finally {
    clearTimeout(timer);
  }
}

function setupSignup(form, endpoint) {
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".signup-status");
  const note = form.querySelector(".signup-note");

  // Controls ship disabled so the form can't submit without this script.
  if (!endpoint || !contactEmail) {
    note.textContent = "The waitlist opens soon. Check back shortly.";
    return;
  }
  input.disabled = false;
  button.disabled = false;

  // Every failure re-enables the form and keeps the address, so trying again is one step.
  const fail = (message) => {
    status.dataset.tone = "error";
    status.textContent = message;
    button.disabled = false;
    button.textContent = button.dataset.label;
    form.removeAttribute("aria-busy");
    input.focus();
  };

  let busy = false;
  button.dataset.label = button.textContent;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!input.checkValidity()) {
      fail(MESSAGES.invalid);
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = "Joining…";
    form.setAttribute("aria-busy", "true");
    status.textContent = "";
    const outcome = await postSignup(endpoint, {
      email: input.value.trim(),
      company: form.elements.company.value,
    });
    busy = false;
    if (outcome !== "ok") {
      fail(MESSAGES[outcome]);
      return;
    }
    const forms = document.querySelectorAll("form[data-signup]");
    const done = markJoined(form);
    for (const other of forms) if (other !== form) markJoined(other);
    done.focus();
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

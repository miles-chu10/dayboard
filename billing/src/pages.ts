import { ORDER_ACCESS_DAYS } from "./config.ts";

// The one support address every buyer-facing page links to.
export const SUPPORT_EMAIL = "support@getdayboard.com";
// The public website, for the pricing and refund links when SITE_ORIGIN isn't configured.
export const DEFAULT_SITE_ORIGIN = "https://getdayboard.com";
const REFUND_DAYS = 14;

export interface PageContext {
  site: string;
  activationLimit: number;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const macs = (count: number) => `${count} Mac${count === 1 ? "" : "s"}`;
const supportLink = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;

const styles = `<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101217;color:#eef1f5;min-height:100vh}main{max-width:640px;margin:0 auto;padding:64px 24px}header{font-size:14px;color:#aeb7c5;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(34px,6vw,54px);line-height:1.08;margin:48px 0 18px}h2{font-size:22px;margin:40px 0 0}p,ul,ol{color:#b8c1cf;font-size:18px;line-height:1.55}ul,ol{padding-left:24px}li{margin:8px 0}strong{color:#eef1f5}.price{font-size:24px;font-weight:600;color:#eef1f5}.warn{border:1px solid #8a7440;background:#2a2518;border-radius:6px;padding:14px 16px;color:#f5e6c4;font-size:16px}.warn strong{color:#ffe9b0}kbd{font:inherit;border:1px solid #485363;border-radius:4px;padding:0 5px}button{border:0;border-radius:6px;background:#e9f4cb;color:#182118;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid #9fd2ff;outline-offset:3px}.panel{border-top:1px solid #39424f;margin-top:48px;padding-top:24px}.secondary{background:#2b333e;color:#fff;margin-left:8px}a{color:#b7ddff}code{display:block;overflow-wrap:anywhere;background:#232a32;border:1px solid #485363;border-radius:6px;padding:16px;margin:24px 0;color:#f0ffda}small{display:block;color:#9daabb;margin-top:32px;line-height:1.55}#message{min-height:28px}
</style>`;
const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>DayBoard license</title>`;
const layout = (body: string, script = "") =>
  `<!doctype html><html lang="en"><head>${head}${styles}${script ? `<script src="${script}" defer></script>` : ""}</head><body><main><header>DayBoard</header>${body}</main></body></html>`;

export const buyPage = (orderId: string, { site, activationLimit }: PageContext) => {
  const origin = escapeHtml(site);
  return layout(
    `<h1>DayBoard Pro</h1><p class="price">$5 once (launch price). No subscription.</p><ul><li><strong>Unlocks DayBoard's AI features.</strong> Everything else in DayBoard stays free. You bring your own AI provider; Pro doesn't include AI usage.</li><li><strong>Use on up to ${macs(activationLimit)}</strong> with one license key.</li><li><strong>${REFUND_DAYS}-day refunds.</strong> Ask within ${REFUND_DAYS} days of buying for a full refund.</li></ul><p>See <a href="${origin}/pricing">pricing</a> and the <a href="${origin}/refund">refund policy</a>. Questions? Email ${supportLink}.</p><div class="panel"><button id="buy" type="button" data-order-id="${escapeHtml(orderId)}">Continue to checkout</button><p id="message" role="status" aria-live="polite"></p></div><small>Checkout opens securely with Stripe. Link, Stripe's checkout service, is the seller of record and emails your receipt. After you pay, your license key appears on the receipt page in this browser.</small>`,
    "/buy.js",
  );
};
export const receiptPage = ({ site, activationLimit }: PageContext) =>
  layout(
    `<h1 id="title">Checking your order</h1><p id="message" role="status" aria-live="polite">Your payment may take a moment to confirm.</p><a id="retry" href="/buy" hidden>Start a new checkout</a><div id="license" class="panel" hidden><p class="warn"><strong>Copy or download your license key now.</strong> This page works only in this browser, and only for ${ORDER_ACCESS_DAYS} days after you started checkout. After that, it can't show your key again.</p><code id="key"></code><button id="copy" type="button">Copy license</button><button id="download" class="secondary" type="button">Download license</button><h2>Activate DayBoard Pro</h2><ol><li>Open DayBoard and choose <strong>DayBoard → Settings…</strong> (or press <kbd>⌘,</kbd>).</li><li>Click the <strong>License</strong> tab.</li><li>Paste your key into <strong>License key</strong>, then click <strong>Activate</strong>.</li></ol><p>Use the same key on up to ${macs(activationLimit)}. To move it, open <strong>Settings → License</strong> on the old Mac and click <strong>Deactivate this device</strong>.</p></div><small>Lost your key or need help? Email ${supportLink} with your Stripe receipt. Never send your card number. Refunds within ${REFUND_DAYS} days: see the <a href="${escapeHtml(site)}/refund">refund policy</a>.</small>`,
    "/receipt.js",
  );
// GET /buy is rate limited per network; a shared address can hit the limit without abuse.
export const busyPage = layout(
  `<h1>Too many checkout attempts</h1><p>Wait a minute, then reload this page. If this keeps happening, email ${supportLink}.</p>`,
);
export const buyScript = `const button=document.getElementById('buy'),message=document.getElementById('message'),orderId=button.dataset.orderId;button.onclick=async()=>{button.disabled=true;message.textContent='Opening checkout…';try{const response=await fetch('/v1/checkout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});const data=await response.json();if(!response.ok||!data.url)throw new Error();location.assign(data.url)}catch{message.textContent='Checkout could not open. Reload this page and try again, or email support.';button.disabled=false}};`;
export const receiptScript =
  `const title=document.getElementById('title'),message=document.getElementById('message'),box=document.getElementById('license'),key=document.getElementById('key'),orderId=new URL(location.href).searchParams.get('order');let licenseKey='';const show=(heading,text)=>{title.textContent=heading;message.textContent=text};async function poll(){if(!orderId||!%ORDER_PATTERN%.test(orderId)){show('Order access unavailable','Open the return link from your checkout in the browser you paid with, or email support with your Stripe receipt.');return}try{const response=await fetch('/v1/checkout/status?order='+encodeURIComponent(orderId),{credentials:'same-origin',cache:'no-store'});if(response.status===401){show('Order access unavailable','This page works only in the browser you used for checkout, for ${ORDER_ACCESS_DAYS} days. Email support with your Stripe receipt to recover your key.');return}if(!response.ok)throw new Error();const status=await response.json();if(status.state==='pending'){show('Checking your order','Your payment may take a moment to confirm.');setTimeout(poll,2500);return}if(status.state==='revoked'){show('License unavailable','This payment was refunded or disputed, so the license is turned off. Email support if you need help.');return}if(status.state==='failed'){show('Payment incomplete','No license was issued. Start a new checkout, or email support.');document.getElementById('retry').hidden=false;return}const claim=await fetch('/v1/checkout/claim',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});if(!claim.ok)throw new Error();licenseKey=(await claim.json()).licenseKey;key.textContent=licenseKey;box.hidden=false;show('Your DayBoard Pro license','Payment confirmed. Your license key is below.')}catch{show('Still checking','The order could not be checked right now. Retrying…');setTimeout(poll,4000)}}poll();document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(licenseKey);message.textContent='License copied.'}catch{message.textContent='Copy is unavailable. Select the license above to copy it.'}};document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([licenseKey+'\\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dayboard-license.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};`.replace(
    "%ORDER_PATTERN%",
    "/^[A-Za-z0-9_-]{32}$/",
  );

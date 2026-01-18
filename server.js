// server.js
/**
 * ============================
 *  MANUAL SETTINGS (EDIT ME)
 * ============================
 * Safer option: leave placeholders, and set Cloud Run env vars:
 *   FISERV_STORE_ID, FISERV_SHARED_SECRET, FISERV_FORM_ACTION, DEFAULT_CURRENCY, DEFAULT_TIMEZONE
 *
 * Email (SMTP) env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME
 */

// ✅ Fiserv credentials (recommended to set via env vars)
const FISERV_STORE_ID = process.env.FISERV_STORE_ID || "PASTE_STORE_ID_HERE";
const FISERV_SHARED_SECRET = process.env.FISERV_SHARED_SECRET || "PASTE_SHARED_SECRET_HERE";

// ✅ Fiserv TEST form action URL (CI)
const FISERV_FORM_ACTION =
  process.env.FISERV_FORM_ACTION || "https://test.ipg-online.com/connect/gateway/processing";

// ✅ Defaults
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "840"; // 388 JMD, 840 USD
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || "UTC";

// ✅ Email (SMTP) settings (set these in Cloud Run env vars)
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || "465");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "Exclusive Comfort";

import express from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(express.urlencoded({ extended: false }));

// ===== Luxe UI (safe: CSS + markup only; does not affect payment fields) =====
const LUXE_CSS = `
:root{
  --blue:#0C2C7A; --gold:#E6B652; --gold2:#B98A2F;
  --ink:#0E0E0E; --muted:#4B4A46; --line:rgba(12,44,122,.12);
  --bg: radial-gradient(1200px 780px at 50% 6%, #ffffff 0%, #ffffff 55%, rgba(12,44,122,.08) 76%, rgba(12,44,122,.15) 100%);
  --shadow:0 50px 120px rgba(12,44,122,.22);
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink);
  background:var(--bg);
}
.wrap{max-width:980px;margin:0 auto;padding:clamp(18px,4vw,34px)}
.card{
  border-radius:22px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.78);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
  overflow:hidden;
}
.head{
  padding:16px 18px;
  border-bottom:1px solid rgba(12,44,122,.10);
  background:linear-gradient(180deg, rgba(255,255,255,.86), rgba(244,247,255,.86));
  display:flex;align-items:center;justify-content:space-between;gap:12px;
}
.brand{
  display:flex;align-items:center;gap:10px;
  font-weight:800;color:rgba(12,44,122,.95);
  letter-spacing:.2px;
}
.brand .dot{width:10px;height:10px;border-radius:999px;background:linear-gradient(135deg,var(--gold),var(--gold2));box-shadow:0 10px 18px rgba(185,138,47,.30)}
.badge{
  font-size:12px;font-weight:800;
  padding:6px 10px;border-radius:999px;
  border:1px solid rgba(12,44,122,.12);
  background:#fff;
  color:rgba(12,44,122,.9);
}
.body{padding:18px}
h1{
  font-family:"Playfair Display",ui-serif,Georgia,serif;
  margin:0;
  font-size:clamp(22px,4.5vw,34px);
  color:rgba(12,44,122,.98);
  letter-spacing:.2px;
}
p{margin:10px 0 0; color:rgba(75,74,70,.92); line-height:1.65}
.grid{display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px}
@media(min-width:820px){.grid{grid-template-columns:1fr 1fr}}
.field{
  border:1px solid rgba(12,44,122,.12);
  border-radius:16px;
  background:rgba(255,255,255,.9);
  padding:10px 12px;
}
label{display:block;font-weight:800;color:rgba(12,44,122,.92);font-size:12.5px}
input{
  width:100%;
  margin-top:6px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid rgba(12,44,122,.16);
  outline:none;
  font-weight:700;
}
input:focus-visible{outline:3px solid rgba(44,109,255,.35);outline-offset:2px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.btn{
  display:inline-flex;align-items:center;justify-content:center;
  padding:10px 14px;border-radius:999px;
  border:1px solid rgba(12,44,122,.18);
  background:linear-gradient(#fff,#F4F7FF);
  font-weight:800;
  cursor:pointer;
  text-decoration:none;
  transition:transform .12s ease, box-shadow .2s ease;
}
.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(12,44,122,.16)}
.btn:focus-visible{outline:3px solid rgba(44,109,255,.35);outline-offset:2px}
.btn.gold{
  border:0;
  background:linear-gradient(135deg,var(--gold),var(--gold2));
  color:#111;
  box-shadow:0 12px 26px rgba(185,138,47,.28);
  position:relative;
  overflow:hidden;
}
.btn.gold::after{
  content:"";position:absolute;inset:-120% -40% auto -40%;height:220%;
  background:linear-gradient(120deg,transparent 45%,rgba(255,255,255,.9) 50%,transparent 55%);
  animation:shine2 3.2s linear infinite;
}
@keyframes shine2{to{transform:translateX(160%)}}
.small{font-size:12.5px;opacity:.82}
pre{
  background:rgba(255,255,255,.9);
  border:1px solid rgba(12,44,122,.10);
  border-radius:14px;
  padding:12px;
  overflow:auto;
}
.ok{color:#0b6b3a;font-weight:900}
.bad{color:#9a2b2b;font-weight:900}
`;

// ======== HELPERS ========
function makeTxnDateTimeUTC() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Force dot-decimal format like "10.00" (avoids comma issues)
function normalizeAmount(input, fallback = "10.00") {
  let s = String(input ?? "").trim();
  if (!s) return fallback;
  s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n.toFixed(2);
}

function buildHashExtended(params, sharedSecret) {
  const keys = Object.keys(params).sort();
  const valueString = keys.map((k) => params[k]).join("|");
  const hmac = crypto.createHmac("sha256", sharedSecret);
  hmac.update(valueString, "utf8");
  return hmac.digest("base64");
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeOid() {
  try {
    const a = crypto.randomBytes(16).toString("hex");
    return `C-${a}`;
  } catch {
    return `C-${Date.now()}`;
  }
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString();
  return `${proto}://${req.get("host")}`;
}

function isValidEmail(email) {
  const e = String(email || "").trim();
  if (!e) return false;
  // simple, safe check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function safePick(data, keys) {
  for (const k of keys) {
    const v = data?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function formatDateTimeForReceipt() {
  // Processing date: UTC ISO-ish
  return new Date().toISOString();
}

function currencyLabelFromCode(code) {
  const c = String(code || "").trim();
  if (c === "840") return "USD";
  if (c === "388") return "JMD";
  return c || "—";
}

// ---- Email transporter (lazy init) ----
let RB_MAILER = null;
function getMailer() {
  const ok = SMTP_HOST && SMTP_USER && SMTP_PASS;
  if (!ok) return null;
  if (RB_MAILER) return RB_MAILER;

  RB_MAILER = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 true, 587 false
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return RB_MAILER;
}

async function sendPlainTextReceipt({ to, tradeName, processingDate, orderNumber, cardType, amount, currency, approvalCode }) {
  const mailer = getMailer();
  if (!mailer) {
    throw new Error("Email not configured (missing SMTP env vars).");
  }

  const subject = `${tradeName} — Payment Receipt (${orderNumber || "Order"})`;

  const body =
`${tradeName}
PAYMENT RECEIPT

Processing date: ${processingDate}
Order number: ${orderNumber || "—"}
Card type: ${cardType || "—"}
Transaction amount: ${amount || "—"}
Currency: ${currency || "—"}
Authorization / approval code: ${approvalCode || "—"}

If you have questions, reply to this email.
`;

  await mailer.sendMail({
    from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM}>` : SMTP_FROM,
    to,
    subject,
    text: body,
  });
}

// ======== ROUTES ========

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Exclusive Comfort — Payment Test</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
  <style>${LUXE_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="brand"><span class="dot"></span> Exclusive Comfort</div>
        <div class="badge">Test Checkout</div>
      </div>

      <div class="body">
        <h1>Secure checkout handoff</h1>
        <p>Enter your email and amount and we’ll securely redirect you to our payment partner. After approval, we’ll email your receipt automatically.</p>

        <form method="GET" action="/start-payment" class="grid" style="margin-top:14px">
          <div class="field" style="grid-column:1/-1">
            <label for="email">Email (receipt will be sent here)</label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
            <div class="small" style="margin-top:6px">Make sure this is correct — we’ll send the receipt here.</div>
          </div>

          <div class="field">
            <label for="amount">Amount</label>
            <input id="amount" name="amount" inputmode="decimal" value="10.00" />
            <div class="small" style="margin-top:6px">Tip: use dot-decimal (10.00)</div>
          </div>

          <div class="field">
            <label for="currency">Currency Code</label>
            <input id="currency" name="currency" value="${esc(DEFAULT_CURRENCY)}" />
            <div class="small" style="margin-top:6px">840 = USD, 388 = JMD (when enabled)</div>
          </div>

          <div class="actions" style="grid-column:1/-1">
            <button class="btn gold" type="submit">Continue to Secure Payment</button>
            <a class="btn" href="https://www.exclusivecomfortdecor.com/shop" target="_blank" rel="noreferrer">Storefront</a>
          </div>
        </form>

        <p class="small" style="margin-top:12px">If you are seeing errors, confirm Cloud Run env vars are set correctly.</p>
      </div>
    </div>
  </div>
</body>
</html>`);
});

app.get("/start-payment", (req, res) => {
  if (!FISERV_STORE_ID || FISERV_STORE_ID.includes("PASTE_")) {
    return res.status(500).send("Missing FISERV_STORE_ID (set env var or edit server.js).");
  }
  if (!FISERV_SHARED_SECRET || FISERV_SHARED_SECRET.includes("PASTE_")) {
    return res.status(500).send("Missing FISERV_SHARED_SECRET (set env var or edit server.js).");
  }

  const amount = normalizeAmount(req.query.amount, "10.00");
  const currency = req.query.currency ? String(req.query.currency) : DEFAULT_CURRENCY;

  // Customer email to receive receipt
  const customerEmailRaw = String(req.query.email || "").trim();
  const customerEmail = isValidEmail(customerEmailRaw) ? customerEmailRaw : "";

  // Accept oid from storefront if provided, else generate
  const oid = req.query.oid ? String(req.query.oid) : makeOid();

  const txndatetime = makeTxnDateTimeUTC();
  const origin = baseUrl(req);

  // Keep your original return pattern (same endpoints; only add "email" + "oid" as pre-set query params)
  // Most gateways will append their params onto your existing query string.
  const responseSuccessURL = `${origin}/payment-result?redirect=success&oid=${encodeURIComponent(
    oid
  )}&email=${encodeURIComponent(customerEmail)}`;
  const responseFailURL = `${origin}/payment-result?redirect=fail&oid=${encodeURIComponent(
    oid
  )}&email=${encodeURIComponent(customerEmail)}`;

  const params = {
    storename: FISERV_STORE_ID,
    txntype: "sale",
    timezone: DEFAULT_TIMEZONE,
    txndatetime,
    chargetotal: amount,
    currency,
    oid, // helpful order reference
    checkoutoption: "combinedpage",
    responseSuccessURL,
    responseFailURL,
    hash_algorithm: "HMACSHA256",
  };

  const hashExtended = buildHashExtended(params, FISERV_SHARED_SECRET);

  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Secure Checkout</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
  <style>${LUXE_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="brand"><span class="dot"></span> Exclusive Comfort</div>
        <div class="badge">Secure Checkout</div>
      </div>

      <div class="body">
        <h1>Taking you to secure payment…</h1>
        <p>We’re opening our payment partner in a secure session. If it doesn’t load in a moment, tap continue.</p>
        <p class="small" style="margin-top:10px">
          Order reference: <strong>${esc(oid)}</strong> • Amount: <strong>${esc(amount)}</strong> • Currency: <strong>${esc(currency)}</strong><br/>
          Receipt email: <strong>${esc(customerEmail || "—")}</strong>
        </p>

        <div class="actions">
          <button class="btn gold" type="submit" form="payForm">Continue</button>
          <a class="btn" href="/">Back</a>
        </div>

        <p class="small" style="margin-top:12px">Tip: Don’t refresh during checkout.</p>

        <form id="payForm" method="POST" action="${esc(FISERV_FORM_ACTION)}" style="display:none">
          ${Object.entries(params)
            .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
            .join("\n")}
          <input type="hidden" name="hashExtended" value="${esc(hashExtended)}" />
        </form>
      </div>
    </div>
  </div>

  <script>document.getElementById("payForm").submit();</script>
</body>
</html>`);
});

app.all("/payment-result", async (req, res) => {
  const data = { ...req.query, ...req.body };

  const approved =
    String(data.approval_code || "").startsWith("Y") ||
    String(data.status || "").toUpperCase().includes("APROB") ||
    String(data.processor_response_code || "") === "00";

  // Receipt fields (best-effort across gateway variations)
  const tradeName = "Exclusive Comfort";
  const processingDate = formatDateTimeForReceipt();

  const orderNumber =
    safePick(data, ["oid"]) ||
    safePick(data, ["merchantTransactionId", "orderId"]) ||
    "—";

  const approvalCode =
    safePick(data, ["approval_code", "approvalCode", "authCode", "authorization_code"]) ||
    safePick(data, ["processor_approval_code"]) ||
    "—";

  const cardType =
    safePick(data, ["card_type", "cardType", "paymentMethod", "ccbrand", "cardBrand", "brand"]) ||
    "—";

  const amount =
    safePick(data, ["chargetotal", "amount"]) ||
    "—";

  const currencyCode =
    safePick(data, ["currency"]) ||
    DEFAULT_CURRENCY;

  const currency = currencyLabelFromCode(currencyCode);

  const customerEmailRaw = safePick(data, ["email", "customerEmail", "billEmail", "billemail"]);
  const customerEmail = isValidEmail(customerEmailRaw) ? customerEmailRaw : "";

  let emailSent = false;
  let emailError = "";

  // Send receipt only on approved payments
  if (approved && customerEmail) {
    try {
      await sendPlainTextReceipt({
        to: customerEmail,
        tradeName,
        processingDate,
        orderNumber,
        cardType,
        amount,
        currency,
        approvalCode,
      });
      emailSent = true;
    } catch (e) {
      emailSent = false;
      emailError = String(e?.message || e || "Email send failed");
    }
  }

  const emailStatusLine = approved
    ? (customerEmail
        ? (emailSent
            ? `<p class="small ok" style="margin-top:10px">Receipt emailed to: <strong>${esc(customerEmail)}</strong></p>`
            : `<p class="small bad" style="margin-top:10px">Payment approved, but receipt email failed: <strong>${esc(emailError)}</strong></p>`)
        : `<p class="small bad" style="margin-top:10px">Payment approved, but we didn’t receive an email address to send your receipt.</p>`)
    : "";

  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Payment Result</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
  <style>${LUXE_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="brand"><span class="dot"></span> Exclusive Comfort</div>
        <div class="badge">${approved ? "Approved" : "Payment Update"}</div>
      </div>

      <div class="body">
        <h1>${approved ? "Payment approved ✅" : "We couldn’t complete that payment"}</h1>
        <p>${approved ? "Thank you — your order is confirmed." : "No worries — you can try again."}</p>

        <p class="small" style="margin-top:10px">
          Reference: <strong>${esc(orderNumber)}</strong>
          &nbsp;•&nbsp; Transaction: <strong>${esc(safePick(data, ["ipgTransactionId", "transactionId"]) || "—")}</strong>
        </p>

        ${emailStatusLine}

        <div class="actions">
          <a class="btn gold" href="/">Return</a>
          ${approved ? "" : `<a class="btn" href="/">Try Again</a>`}
        </div>

        <details style="margin-top:14px">
          <summary class="small" style="cursor:pointer;font-weight:800;color:rgba(12,44,122,.92)">View technical details</summary>
          <pre>${esc(JSON.stringify(data, null, 2))}</pre>
        </details>
      </div>
    </div>
  </div>
</body>
</html>`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));

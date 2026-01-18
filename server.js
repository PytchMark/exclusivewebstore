import express from "express";

import { getSupabaseClient, isSupabaseConfigured } from "./services/supabase.js";
import { buildHashExtended, makeOid, makeTxnDateTimeUTC, normalizeAmount } from "./payments/fiserv.js";

const app = express();

const FISERV_STORE_ID = process.env.FISERV_STORE_ID || "";
const FISERV_SHARED_SECRET = process.env.FISERV_SHARED_SECRET || "";
const FISERV_FORM_ACTION = process.env.FISERV_FORM_ACTION || "";
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "388";
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || "UTC";
const STORE_RETURN_URL = process.env.STORE_RETURN_URL || "/";

const FISERV_REQUIRED = ["FISERV_STORE_ID", "FISERV_SHARED_SECRET", "FISERV_FORM_ACTION"];
const missingFiserv = FISERV_REQUIRED.filter((key) => !process.env[key]);
const fiservConfigured = missingFiserv.length === 0;
const supabaseConfigured = isSupabaseConfigured();

if (!fiservConfigured) {
  console.error(`Missing required Fiserv env vars: ${missingFiserv.join(", ")}`);
}
if (!supabaseConfigured) {
  console.error("Missing required Supabase env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

function getOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https");
  return `${proto}://${req.get("host")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  return items.map((item, index) => {
    const sku = String(item?.sku || "").trim();
    const name = String(item?.name || "").trim();
    const price = Number(item?.price);
    const qty = Number(item?.qty);

    if (!sku || !name || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid item at index ${index}`);
    }

    return { sku, name, price, qty };
  });
}

function computeSubtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "";
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "exclusivewebstore",
    supabaseConfigured,
    fiservConfigured,
    defaultCurrency: DEFAULT_CURRENCY,
  });
});

app.post("/api/checkout/start", (req, res) => {
  if (!fiservConfigured) {
    return res.status(500).send("Fiserv is not configured. Set FISERV_STORE_ID, FISERV_SHARED_SECRET, FISERV_FORM_ACTION.");
  }

  let items;
  try {
    items = parseItems(req.body?.items);
  } catch (err) {
    return res.status(400).send(err.message);
  }

  const subtotal = computeSubtotal(items);
  if (subtotal <= 0) {
    return res.status(400).send("Cart subtotal must be greater than zero.");
  }
  const amount = normalizeAmount(subtotal);
  const currency = String(req.body?.currency || DEFAULT_CURRENCY);
  const cartId = req.body?.cartId ? String(req.body.cartId) : "";
  const oid = makeOid(cartId);
  const txndatetime = makeTxnDateTimeUTC();
  const origin = getOrigin(req);

  const responseSuccessURL = `${origin}/payment-result?redirect=success`;
  const responseFailURL = `${origin}/payment-result?redirect=fail`;

  const params = {
    storename: FISERV_STORE_ID,
    txntype: "sale",
    timezone: DEFAULT_TIMEZONE,
    txndatetime,
    chargetotal: amount,
    currency,
    oid,
    checkoutoption: "combinedpage",
    responseSuccessURL,
    responseFailURL,
    hash_algorithm: "HMACSHA256",
  };

  const hashExtended = buildHashExtended(params, FISERV_SHARED_SECRET);

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redirecting to Secure Payment</title>
</head>
<body>
  <p>Redirecting to secure payment…</p>
  <form id="fiservForm" method="POST" action="${escapeHtml(FISERV_FORM_ACTION)}">
    ${Object.entries(params)
      .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
      .join("\n")}
    <input type="hidden" name="hashExtended" value="${escapeHtml(hashExtended)}" />
  </form>
  <script>document.getElementById('fiservForm').submit();</script>
</body>
</html>`);
});

app.post("/api/cart/save", async (req, res) => {
  if (!supabaseConfigured) {
    return res.status(500).json({ success: false, error: "Supabase is not configured." });
  }

  const cartId = String(req.body?.cartId || "").trim();
  const customerName = String(req.body?.name || "").trim();
  const customerEmail = String(req.body?.email || "").trim();
  const customerPhone = String(req.body?.phone || "").trim();

  if (!cartId || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({
      success: false,
      error: "cartId, name, email, and phone are required.",
    });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const parsedItems = items
    .map((item) => ({
      sku: String(item?.sku || ""),
      name: String(item?.name || ""),
      price: Number(item?.price || 0),
      qty: Number(item?.qty || 0),
      image: item?.image || item?.img || "",
    }))
    .filter((item) => item.sku && item.qty > 0);

  const subtotal = parsedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const payload = {
    cart_id: cartId,
    expires_at: expiresAt,
    site: String(req.body?.site || ""),
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    items_json: parsedItems,
    subtotal,
    currency: String(req.body?.currency || DEFAULT_CURRENCY),
    source: String(req.body?.source || "storefront"),
    user_agent: req.get("user-agent") || "",
    ip: getClientIp(req),
  };

  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.from("carts_24h").insert(payload);
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.json({ success: true, cartId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Insert failed" });
  }
});

app.all("/payment-result", (req, res) => {
  const data = { ...req.query, ...req.body };
  const approved =
    String(data.approval_code || "").startsWith("Y") ||
    String(data.status || "").toUpperCase().includes("APROB") ||
    String(data.processor_response_code || "") === "00";

  const oid = String(data.oid || data.merchantTransactionId || data.orderId || "—");
  const transactionId = String(data.ipgTransactionId || data.transactionId || "—");
  const redirect = approved ? "Approved ✅" : "Failed ❌";
  const returnUrl = STORE_RETURN_URL || "/";

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Result</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; padding: 32px; background: #f7f7fb; color: #111; }
    .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.08); max-width: 680px; margin: 0 auto; }
    h1 { margin-top: 0; }
    .meta { color: #555; }
    .actions { margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { display: inline-flex; padding: 10px 16px; border-radius: 999px; border: 1px solid #ddd; text-decoration: none; color: #111; background: #fff; font-weight: 600; }
    .btn.primary { background: #0C2C7A; color: #fff; border-color: #0C2C7A; }
    details { margin-top: 18px; }
    pre { background: #f2f2f8; padding: 12px; border-radius: 12px; overflow: auto; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${redirect}</h1>
    <p class="meta">Reference: <strong>${escapeHtml(oid)}</strong></p>
    <p class="meta">Transaction: <strong>${escapeHtml(transactionId)}</strong></p>
    <div class="actions">
      <a class="btn primary" href="${escapeHtml(returnUrl)}">Return to Store</a>
      ${approved ? "" : `<a class="btn" href="${escapeHtml(returnUrl)}">Try Again</a>`}
    </div>
    <details>
      <summary>View technical details</summary>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    </details>
  </div>
</body>
</html>`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on ${PORT}`);
});

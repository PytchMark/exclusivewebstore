import crypto from "crypto";

export function makeTxnDateTimeUTC() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function normalizeAmount(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  return n.toFixed(2);
}

export function buildHashExtended(params, sharedSecret) {
  const keys = Object.keys(params).sort();
  const valueString = keys.map((k) => params[k]).join("|");
  const hmac = crypto.createHmac("sha256", sharedSecret);
  hmac.update(valueString, "utf8");
  return hmac.digest("base64");
}

export function makeOid(cartId = "") {
  let suffix = "";
  try {
    suffix = crypto.randomBytes(8).toString("hex");
  } catch {
    suffix = String(Date.now());
  }

  if (cartId) {
    return `CART-${String(cartId)}-${suffix}`;
  }
  return `CART-${suffix}`;
}

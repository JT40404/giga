// Shared helpers for the serverless functions.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function getMint() {
  const mint = (process.env.TOKEN_MINT || "").trim();
  return BASE58.test(mint) ? mint : null;
}

export function send(res, status, body, cacheSeconds = 0) {
  if (cacheSeconds > 0) {
    res.setHeader("Cache-Control", `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 3}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.status(status).json(body);
}

// pump.fun's frontend API is unofficial and sits behind bot protection,
// so we send ordinary browser-like headers and fail soft.
export const PUMP_API = "https://frontend-api-v3.pump.fun";
export const PUMP_HEADERS = {
  Accept: "application/json",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
};

export async function fetchJson(url, headers = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

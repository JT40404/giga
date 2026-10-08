// Fetches a coin's pump.fun comment thread. pump.fun moves this unofficial
// endpoint from time to time, so the address is configurable:
//   PUMP_REPLIES_URL = full URL with {mint}, {limit} and {offset} placeholders
// If unset (or it fails), known addresses are tried in order.
import { PUMP_HEADERS } from "./env.js";

const CANDIDATES = [
  "https://frontend-api-v3.pump.fun/replies/{mint}?limit={limit}&offset={offset}&reverseOrder=true",
  "https://frontend-api-v3.pump.fun/replies/{mint}?limit={limit}&offset={offset}",
  "https://frontend-api-v2.pump.fun/replies/{mint}?limit={limit}&offset={offset}&reverseOrder=true",
];

function listFrom(data) {
  if (Array.isArray(data)) return data;
  for (const k of ["replies", "comments", "data", "items", "results"]) {
    if (Array.isArray(data?.[k])) return data[k];
    if (Array.isArray(data?.data?.[k])) return data.data[k];
  }
  return null;
}

export async function fetchReplies(mint, { limit = 50, offset = 0 } = {}) {
  const custom = process.env.PUMP_REPLIES_URL?.trim();
  const templates = custom ? [custom, ...CANDIDATES] : CANDIDATES;
  const headers = { ...PUMP_HEADERS };
  if (process.env.PUMP_AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.PUMP_AUTH_TOKEN.trim()}`;

  const tried = [];
  for (const t of templates) {
    const url = t.replaceAll("{mint}", mint).replaceAll("{limit}", limit).replaceAll("{offset}", offset);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(url, { headers, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!r.ok) { tried.push(`${r.status} ${new URL(url).host}${new URL(url).pathname.replace(mint, "{mint}")}`); continue; }
      const list = listFrom(await r.json());
      if (list) return { list, source: url.split("?")[0].replace(mint, "{mint}") };
      tried.push(`unexpected format from ${new URL(url).host}`);
    } catch (e) {
      tried.push(`${e.name === "AbortError" ? "timeout" : "error"} ${new URL(url).host}`);
    }
  }
  throw new Error(`no working comments address (tried: ${tried.join("; ")})`);
}

// Comment objects differ between API versions; read the common field names.
export function pick(r) {
  let ts = Number(r.timestamp ?? r.created_timestamp ?? r.createdAt ?? r.created_at ?? 0);
  if (!ts && typeof (r.createdAt ?? r.created_at) === "string") ts = Date.parse(r.createdAt ?? r.created_at);
  if (ts && ts < 1e12) ts *= 1000;
  const user = r.user ?? r.user_address ?? r.wallet ?? r.address ?? r.author?.address ?? null;
  return {
    id: String(r.id ?? r.reply_id ?? r.comment_id ?? r.signature ?? `${user}-${ts}`),
    text: String(r.text ?? r.content ?? r.body ?? r.message ?? ""),
    user: typeof user === "string" ? user : null,
    username: r.username ?? r.user_name ?? r.author?.username ?? null,
    avatar: r.profile_image ?? r.author?.profile_image ?? null,
    file: r.file ?? r.image ?? r.image_uri ?? null,
    ts: ts || null,
    hidden: Boolean(r.hidden ?? r.is_hidden),
    isBuy: typeof r.is_buy === "boolean" ? r.is_buy : null,
    solAmount: r.sol_amount ?? null,
  };
}

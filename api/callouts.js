import { getMint, send, fetchJson, PUMP_API, PUMP_HEADERS } from "./_lib/env.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function normalize(r) {
  let ts = Number(r.timestamp ?? r.created_timestamp ?? 0);
  if (ts && ts < 1e12) ts *= 1000;
  const wallet = typeof r.user === "string" && BASE58.test(r.user) ? r.user : null;
  const file = typeof r.file === "string" && r.file.startsWith("https://") ? r.file : null;
  return {
    id: String(r.id ?? r.signature ?? `${wallet}-${ts}`),
    text: String(r.text ?? "").slice(0, 2000),
    wallet,
    username: r.username || null,
    avatar: typeof r.profile_image === "string" && r.profile_image.startsWith("https://") ? r.profile_image : null,
    image: file,
    timestamp: ts || null,
    isBuy: typeof r.is_buy === "boolean" ? r.is_buy : null,
    sol: r.sol_amount != null ? Number(r.sol_amount) / 1e9 : null,
  };
}

export default async function handler(req, res) {
  const mint = getMint();
  if (!mint) return send(res, 200, { configured: false, callouts: [] });

  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const data = await fetchJson(
      `${PUMP_API}/replies/${mint}?limit=${limit}&offset=${offset}&reverseOrder=true`,
      PUMP_HEADERS
    );
    const list = Array.isArray(data) ? data : data.replies || data.data || [];
    const callouts = list
      .filter((r) => !r.hidden && (r.text || r.file))
      .map(normalize)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    send(res, 200, { configured: true, callouts, offset, hasMore: list.length === limit }, 10);
  } catch (e) {
    send(res, 502, { configured: true, callouts: [], error: `pump.fun thread unavailable (${e.message})` });
  }
}

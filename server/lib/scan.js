// GIGA's coin scanner: pulls Solana pools from CoinGecko's on-chain API and
// scores each coin on four gauges. Same scoring for the board and for "Ask GIGA".
import { cgClient } from "./data.js";
import { fetchJson } from "./env.js";

const n = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(x)));
const pct = (x) => `${x > 0 ? "+" : ""}${Math.abs(x) >= 100 ? Math.round(x) : x.toFixed(1)}%`;
const usd = (x) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);

// Quote tokens and big non-meme assets we never put on the board.
const SKIP = new Set(["SOL", "WSOL", "USDC", "USDT", "USD1", "PYUSD", "JUP", "JTO", "RAY", "JITOSOL", "MSOL", "BSOL", "JUPSOL", "WBTC", "CBBTC", "WETH", "ETH", "BTC"]);

function cg() {
  const c = cgClient();
  if (!c) throw new Error("COINGECKO_API_KEY is not set");
  return c;
}

// Normalize CoinGecko pool + included token into one coin record.
function toCoin(pool, included) {
  const a = pool.attributes || {};
  const tokenRef = pool.relationships?.base_token?.data?.id;
  const t = (included || []).find((x) => x.id === tokenRef)?.attributes || {};
  const tx = a.transactions || {};
  const side = (k) => ({ buys: n(tx[k]?.buys) ?? 0, sells: n(tx[k]?.sells) ?? 0, buyers: n(tx[k]?.buyers) ?? 0, sellers: n(tx[k]?.sellers) ?? 0 });
  return {
    address: t.address || (tokenRef ? tokenRef.replace(/^solana_/, "") : null),
    symbol: t.symbol || (a.name || "").split(" / ")[0] || "?",
    name: t.name || null,
    image: t.image_url && t.image_url !== "missing.png" ? t.image_url : null,
    pool: a.address || null,
    poolCreatedAt: a.pool_created_at || null,
    price: n(a.base_token_price_usd),
    marketCap: n(a.market_cap_usd) ?? n(a.fdv_usd),
    liquidity: n(a.reserve_in_usd),
    change: { h1: n(a.price_change_percentage?.h1), h6: n(a.price_change_percentage?.h6), h24: n(a.price_change_percentage?.h24) },
    volume: { h1: n(a.volume_usd?.h1), h6: n(a.volume_usd?.h6), h24: n(a.volume_usd?.h24) },
    txns: { h1: side("h1"), h6: side("h6"), h24: side("h24") },
  };
}

// Mint and freeze authority for many tokens in one RPC call.
export async function authorities(addresses) {
  const out = {};
  if (!addresses.length) return out;
  try {
    const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addresses, { encoding: "jsonParsed" }] }),
    });
    const vals = (await r.json())?.result?.value || [];
    addresses.forEach((addr, i) => {
      const info = vals[i]?.data?.parsed?.info;
      out[addr] = info ? { mint: info.mintAuthority ? "on" : "off", freeze: info.freezeAuthority ? "on" : "off" } : { mint: "unknown", freeze: "unknown" };
    });
  } catch {
    addresses.forEach((a) => (out[a] = { mint: "unknown", freeze: "unknown" }));
  }
  return out;
}

/* ---------- the four gauges ---------- */

function pressure(c) {
  let s = 50; const why = [];
  const h1 = c.change.h1, h6 = c.change.h6;
  if (h1 !== null) { s += h1 > 0 ? Math.min(20, h1) : Math.max(-25, h1 * 1.2); why.push(`${pct(h1)} in the last hour.`); }
  if (h6 !== null) {
    if (h6 > 0) { s += Math.min(10, h6 / 5); why.push(`Climbing over 6h (${pct(h6)}).`); }
    else { s -= Math.min(15, Math.abs(h6) / 3); why.push(`Sliding over 6h (${pct(h6)}).`); }
  }
  if (c.volume.h1 && c.volume.h24) {
    const pace = c.volume.h1 / (c.volume.h24 / 24);
    if (pace > 1.5) { s += 12; why.push(`Volume running ${pace.toFixed(1)}x its daily pace.`); }
    else if (pace < 0.5) { s -= 10; why.push(`Volume cooling (${pace.toFixed(1)}x the daily pace).`); }
  }
  const t = c.txns.h1, tot = t.buys + t.sells;
  if (tot >= 20) {
    const share = t.buys / tot;
    if (share > 0.6) { s += 10; why.push(`Buyers are ${Math.round(share * 100)}% of trades this hour.`); }
    else if (share < 0.45) { s -= 12; why.push(`Sellers own the hour (${Math.round((1 - share) * 100)}% of trades).`); }
  }
  return { gauge: "pressure", score: clamp(s), why };
}

function flow(c) {
  let s = 50; const why = [];
  const t = c.txns.h6;
  if (t.buyers && t.sellers) {
    s += Math.max(-30, Math.min(25, (t.buyers / t.sellers - 1) * 40));
    why.push(`${t.buyers.toLocaleString("en-US")} unique buyers vs ${t.sellers.toLocaleString("en-US")} sellers over 6h.`);
    const perBuyer = t.buys / t.buyers;
    if (perBuyer > 6) { s -= 10; why.push(`~${Math.round(perBuyer)} buys per buyer, which smells like bots.`); }
  }
  if (c.volume.h24 && c.liquidity) {
    const turn = c.volume.h24 / c.liquidity;
    if (turn > 60) { s -= 25; why.push(`Volume is ${Math.round(turn)}x liquidity: likely wash trading.`); }
    else if (turn >= 2 && turn <= 30) { s += 8; why.push(`Turnover ${turn.toFixed(1)}x liquidity: busy but believable.`); }
    else if (turn < 0.3) { s -= 10; why.push("Barely trading for its pool size."); }
  }
  return { gauge: "flow", score: clamp(s), why };
}

function safety(c, auth) {
  let s = 70; const why = []; let veto = null;
  if (auth?.mint === "on") veto = "Mint authority is still on: the dev can print more.";
  else if (auth?.freeze === "on") veto = "Freeze authority is still on: the dev can lock wallets.";
  else if (auth?.mint === "off") why.push("Mint and freeze authority are off.");
  else { s -= 5; why.push("Couldn't verify mint and freeze authority."); }
  const liq = c.liquidity;
  if (liq !== null) {
    if (liq < 30_000) { s -= 25; why.push(`Very shallow pool: ${usd(liq)} liquidity.`); }
    else if (liq < 80_000) { s -= 10; why.push(`Shallow pool: ${usd(liq)} liquidity.`); }
    else if (liq > 500_000) { s += 10; why.push(`Deep pool: ${usd(liq)} liquidity.`); }
  }
  if (c.poolCreatedAt) {
    const hrs = (Date.now() - Date.parse(c.poolCreatedAt)) / 3.6e6;
    if (hrs < 6) { s -= 15; why.push(`Pool is ${Math.max(1, Math.round(hrs))}h old: no track record.`); }
    else if (hrs < 24) { s -= 8; why.push(`Pool is only ${Math.round(hrs)}h old.`); }
  }
  if (veto) return { gauge: "safety", score: 5, why: [veto], veto: true };
  return { gauge: "safety", score: clamp(s), why, veto: false };
}

function heat(c) {
  let s = 55; const why = [];
  const d = c.change.h24;
  if (d !== null) {
    if (d > 300) { s -= 30; why.push(`Up ${pct(d)} in 24h: the crowd is already in.`); }
    else if (d > 100) { s -= 15; why.push(`Up ${pct(d)} in 24h: running hot.`); }
    else if (d < -50) { s -= 10; why.push(`Down ${pct(d)} in 24h and still sliding.`); }
    else if (d >= -15 && d <= 30) { s += 10; why.push(`Only ${pct(d)} on the day: not overheated.`); }
  }
  if (c.marketCap !== null && c.marketCap < 300_000) { s -= 10; why.push(`${usd(c.marketCap)} market cap: coin-flip territory.`); }
  const t = c.txns.h6;
  if (t.buyers > t.sellers * 1.15 && c.change.h1 !== null && Math.abs(c.change.h1) < 5) {
    s += 10; why.push("Buyers outnumber sellers without a spike: quiet accumulation.");
  }
  return { gauge: "heat", score: clamp(s), why };
}

const signal = (score) => (score >= 65 ? "BUY" : score <= 40 ? "AVOID" : "WATCH");

export function scoreCoin(c, auth) {
  const gauges = [pressure(c), flow(c), safety(c, auth), heat(c)].map((g) => ({ ...g, signal: g.veto ? "AVOID" : signal(g.score) }));
  const buys = gauges.filter((g) => g.signal === "BUY").length;
  const avoids = gauges.filter((g) => g.signal === "AVOID").length;
  const safe = gauges[2];
  const verdict = safe.signal === "AVOID" ? "AVOID" : buys >= 3 ? "BUY" : avoids >= 2 ? "AVOID" : "WATCH";
  const top = gauges.filter((g) => g.gauge !== "safety").sort((a, b) => b.score - a.score)[0];
  const low = [...gauges].sort((a, b) => a.score - b.score)[0];
  const summary =
    safe.signal === "AVOID" && safe.score <= 40 ? `Safety valve shut: ${safe.why[0] || "failed the safety check."}`
    : verdict === "BUY" ? `${buys} of 4 gauges in the green. ${top.why[0] || ""}`
    : verdict === "AVOID" ? `${avoids} of 4 gauges in the red. ${low.why[0] || ""}`
    : `Mixed readings (${buys} green, ${avoids} red). Worth watching, not chasing.`;
  return {
    coin: { ...c, authorities: auth || { mint: "unknown", freeze: "unknown" } },
    gauges,
    verdict,
    vetoed: safe.signal === "AVOID",
    buyCount: buys,
    conviction: Math.round(gauges.reduce((s, g) => s + g.score, 0) / 4),
    summary: summary.trim(),
  };
}

/* ---------- data sources ---------- */

export async function trendingBoard(limit = 12) {
  const c = cg();
  const pages = await Promise.allSettled(
    ["1h", "24h"].map((d) => fetchJson(`${c.base}/onchain/networks/solana/trending_pools?include=base_token&duration=${d}`, c.headers))
  );
  const seen = new Set(); const coins = [];
  for (const p of pages) {
    if (p.status !== "fulfilled") continue;
    for (const pool of p.value.data || []) {
      const coin = toCoin(pool, p.value.included);
      if (!coin.address || seen.has(coin.address) || SKIP.has(String(coin.symbol).toUpperCase())) continue;
      seen.add(coin.address); coins.push(coin);
    }
  }
  if (!coins.length) throw new Error(pages.find((p) => p.status === "rejected")?.reason?.message || "no trending pools returned");
  const picked = coins.slice(0, limit);
  const auth = await authorities(picked.map((x) => x.address));
  const calls = picked.map((x) => scoreCoin(x, auth[x.address]));
  const order = { BUY: 0, WATCH: 1, AVOID: 2 };
  return calls.sort((a, b) => order[a.verdict] - order[b.verdict] || b.conviction - a.conviction);
}

export async function lookupCoin(query) {
  const c = cg();
  const q = String(query || "").trim();
  if (!q) throw new Error("Enter a ticker, name or token address.");
  const isAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
  const url = isAddress
    ? `${c.base}/onchain/networks/solana/tokens/${q}/pools?include=base_token`
    : `${c.base}/onchain/search/pools?query=${encodeURIComponent(q.replace(/^\$/, ""))}&network=solana&include=base_token`;
  const res = await fetchJson(url, c.headers);
  let pools = (res.data || []).map((p) => toCoin(p, res.included));
  if (isAddress) pools = pools.filter((p) => p.address === q);
  else pools = pools.filter((p) => !SKIP.has(String(p.symbol).toUpperCase()));
  if (!pools.length) throw new Error(isAddress ? "No trading pool found for that address yet." : `No Solana coin found for "${q}". Try the token address.`);
  // Prefer an exact ticker match, then an exact name match, then the deepest pool.
  const term = q.replace(/^\$/, "").toLowerCase();
  const rank = (p) => (String(p.symbol).toLowerCase() === term ? 2 : String(p.name || "").toLowerCase() === term ? 1 : 0);
  const best = pools.sort((a, b) => rank(b) - rank(a) || (b.liquidity || 0) - (a.liquidity || 0))[0];
  const auth = await authorities([best.address]);
  return scoreCoin(best, auth[best.address]);
}

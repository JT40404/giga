// Market data shared by the site (/api/market) and the bot.
import { fetchJson, PUMP_API, PUMP_HEADERS } from "./env.js";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function cgClient() {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return null;
  const pro = (process.env.COINGECKO_PLAN || "demo").toLowerCase() === "pro";
  return {
    base: pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3",
    headers: { Accept: "application/json", [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key },
  };
}

export async function getCoinGecko(mint, { withChart = false } = {}) {
  const cg = cgClient();
  if (!cg) throw new Error("COINGECKO_API_KEY is not set");

  const tok = await fetchJson(`${cg.base}/onchain/networks/solana/tokens/${mint}?include=top_pools`, cg.headers);
  const a = tok?.data?.attributes || {};
  const poolRef = tok?.data?.relationships?.top_pools?.data?.[0]?.id;
  const pool = (tok?.included || []).find((p) => p.id === poolRef)?.attributes || {};
  const poolAddress = pool.address || (poolRef ? poolRef.replace(/^solana_/, "") : null);

  let chart = [];
  if (withChart && poolAddress) {
    try {
      const o = await fetchJson(
        `${cg.base}/onchain/networks/solana/pools/${poolAddress}/ohlcv/minute?aggregate=15&limit=96&currency=usd`,
        cg.headers
      );
      chart = (o?.data?.attributes?.ohlcv_list || []).map((c) => [c[0] * 1000, Number(c[4])]).reverse();
    } catch {
      /* chart is optional */
    }
  }

  return {
    name: a.name || null,
    symbol: a.symbol || null,
    image: a.image_url && a.image_url !== "missing.png" ? a.image_url : null,
    price: num(a.price_usd),
    change1h: num(pool?.price_change_percentage?.h1),
    change24h: num(pool?.price_change_percentage?.h24),
    marketCap: num(a.market_cap_usd) ?? num(a.fdv_usd),
    fdv: num(a.fdv_usd),
    volume24h: num(a.volume_usd?.h24),
    liquidity: num(a.total_reserve_in_usd) ?? num(pool.reserve_in_usd),
    buys24h: pool?.transactions?.h24?.buys ?? null,
    sells24h: pool?.transactions?.h24?.sells ?? null,
    buyers24h: pool?.transactions?.h24?.buyers ?? null,
    pool: poolAddress,
    chart,
  };
}

export async function getPumpCoin(mint) {
  const c = await fetchJson(`${PUMP_API}/coins/${mint}`, PUMP_HEADERS);
  let created = Number(c.created_timestamp) || null;
  if (created && created < 1e12) created *= 1000;
  return {
    name: c.name || null,
    symbol: c.symbol || null,
    description: c.description ? String(c.description).slice(0, 400) : null,
    image: c.image_uri || null,
    marketCap: num(c.usd_market_cap),
    replyCount: c.reply_count ?? null,
    graduated: Boolean(c.complete),
    createdAt: created,
    creator: c.creator || null,
    twitter: c.twitter || null,
    telegram: c.telegram || null,
    website: c.website || null,
  };
}

export async function getSolPriceUsd() {
  const cg = cgClient();
  if (cg) {
    try {
      const r = await fetchJson(`${cg.base}/simple/price?ids=solana&vs_currencies=usd`, cg.headers);
      if (r?.solana?.usd) return Number(r.solana.usd);
    } catch { /* fall through */ }
  }
  const key = process.env.JUPITER_API_KEY;
  const SOL = "So11111111111111111111111111111111111111112";
  const r = await fetchJson(`https://api.jup.ag/price/v3?ids=${SOL}`, key ? { "x-api-key": key } : {});
  const p = Number(r?.[SOL]?.usdPrice);
  if (!p) throw new Error("Couldn't get the SOL price");
  return p;
}

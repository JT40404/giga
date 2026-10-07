import { getMint, send, fetchJson, PUMP_API, PUMP_HEADERS } from "./_lib/env.js";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function cgClient() {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return null;
  const pro = (process.env.COINGECKO_PLAN || "demo").toLowerCase() === "pro";
  return {
    base: pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3",
    headers: { Accept: "application/json", [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key },
  };
}

async function fromCoinGecko(mint) {
  const cg = cgClient();
  if (!cg) throw new Error("COINGECKO_API_KEY is not set");

  const tok = await fetchJson(
    `${cg.base}/onchain/networks/solana/tokens/${mint}?include=top_pools`,
    cg.headers
  );
  const a = tok?.data?.attributes || {};
  const poolRef = tok?.data?.relationships?.top_pools?.data?.[0]?.id; // e.g. "solana_<address>"
  const pool = (tok?.included || []).find((p) => p.id === poolRef)?.attributes || {};
  const poolAddress = pool.address || (poolRef ? poolRef.replace(/^solana_/, "") : null);

  let chart = [];
  if (poolAddress) {
    try {
      const o = await fetchJson(
        `${cg.base}/onchain/networks/solana/pools/${poolAddress}/ohlcv/minute?aggregate=15&limit=96&currency=usd`,
        cg.headers
      );
      // [timestamp, open, high, low, close, volume], newest first
      chart = (o?.data?.attributes?.ohlcv_list || [])
        .map((c) => [c[0] * 1000, Number(c[4])])
        .reverse();
    } catch {
      /* chart is optional */
    }
  }

  return {
    name: a.name || null,
    symbol: a.symbol || null,
    image: a.image_url && a.image_url !== "missing.png" ? a.image_url : null,
    price: num(a.price_usd),
    change24h: num(pool?.price_change_percentage?.h24),
    marketCap: num(a.market_cap_usd) ?? num(a.fdv_usd),
    fdv: num(a.fdv_usd),
    volume24h: num(a.volume_usd?.h24),
    liquidity: num(a.total_reserve_in_usd) ?? num(pool.reserve_in_usd),
    buys24h: pool?.transactions?.h24?.buys ?? null,
    sells24h: pool?.transactions?.h24?.sells ?? null,
    pool: poolAddress,
    chart,
  };
}

async function fromPump(mint) {
  const c = await fetchJson(`${PUMP_API}/coins/${mint}`, PUMP_HEADERS);
  return {
    name: c.name || null,
    symbol: c.symbol || null,
    image: c.image_uri || null,
    marketCap: num(c.usd_market_cap),
    replyCount: c.reply_count ?? null,
    graduated: Boolean(c.complete),
    twitter: c.twitter || null,
    telegram: c.telegram || null,
    website: c.website || null,
  };
}

export default async function handler(req, res) {
  const mint = getMint();
  if (!mint) return send(res, 200, { configured: false });

  const [cg, pump] = await Promise.allSettled([fromCoinGecko(mint), fromPump(mint)]);
  const g = cg.status === "fulfilled" ? cg.value : {};
  const p = pump.status === "fulfilled" ? pump.value : {};

  send(res, 200, {
    configured: true,
    mint,
    name: g.name || p.name,
    symbol: g.symbol || p.symbol,
    image: g.image || p.image,
    price: g.price ?? null,
    change24h: g.change24h ?? null,
    marketCap: g.marketCap ?? p.marketCap ?? null,
    fdv: g.fdv ?? null,
    volume24h: g.volume24h ?? null,
    liquidity: g.liquidity ?? null,
    buys24h: g.buys24h ?? null,
    sells24h: g.sells24h ?? null,
    pool: g.pool ?? null,
    chart: g.chart || [],
    replyCount: p.replyCount ?? null,
    graduated: p.graduated ?? null,
    links: { twitter: p.twitter, telegram: p.telegram, website: p.website },
    errors: {
      coingecko: cg.status === "rejected" ? cg.reason.message : null,
      pump: pump.status === "rejected" ? pump.reason.message : null,
    },
    updatedAt: Date.now(),
  }, 20); // cache 20s at the edge to protect your CoinGecko quota
}

import { getMint, send } from "../lib/env.js";
import { getCoinGecko, getPumpCoin } from "../lib/data.js";

export default async function handler(req, res) {
  const mint = getMint();
  if (!mint) return send(res, 200, { configured: false });

  const [cg, pump] = await Promise.allSettled([getCoinGecko(mint, { withChart: true }), getPumpCoin(mint)]);
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
  }, 20);
}

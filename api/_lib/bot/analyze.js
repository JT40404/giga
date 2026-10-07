// Gathers stats on the coin someone pitched and applies hard safety rules.
// The AI never overrides these rules; it only judges coins that pass them.
import { getCoinGecko, getPumpCoin } from "../data.js";

const n = (v, d = 0) => Number(process.env[v] ?? d);

async function rpc(method, params) {
  const url = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

async function onChain(mint) {
  const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const parsed = info?.value?.data?.parsed?.info;
  if (!parsed) return { exists: false };
  let top10Share = null;
  let topHolderShare = null;
  try {
    const largest = await rpc("getTokenLargestAccounts", [mint]);
    const supply = Number(parsed.supply) / 10 ** parsed.decimals;
    const amounts = (largest?.value || []).map((a) => Number(a.uiAmount || 0));
    top10Share = supply ? amounts.slice(0, 10).reduce((s, x) => s + x, 0) / supply : null;
    topHolderShare = supply && amounts.length ? amounts[0] / supply : null;
  } catch { /* optional */ }
  return {
    exists: true,
    decimals: parsed.decimals,
    mintAuthority: parsed.mintAuthority || null,
    freezeAuthority: parsed.freezeAuthority || null,
    top10Share,
    topHolderShare,
  };
}

export async function analyzeCoin(mint) {
  const [chain, pump, cg] = await Promise.allSettled([onChain(mint), getPumpCoin(mint), getCoinGecko(mint)]);
  const c = chain.status === "fulfilled" ? chain.value : null;
  const p = pump.status === "fulfilled" ? pump.value : {};
  const g = cg.status === "fulfilled" ? cg.value : {};

  const ageMin = p.createdAt ? Math.round((Date.now() - p.createdAt) / 60000) : null;
  const stats = {
    name: g.name || p.name || null,
    symbol: g.symbol || p.symbol || null,
    description: p.description || null,
    ageMinutes: ageMin,
    graduated: p.graduated ?? null,
    marketCapUsd: g.marketCap ?? p.marketCap ?? null,
    liquidityUsd: g.liquidity ?? null,
    volume24hUsd: g.volume24h ?? null,
    change1hPct: g.change1h ?? null,
    change24hPct: g.change24h ?? null,
    buys24h: g.buys24h ?? null,
    sells24h: g.sells24h ?? null,
    uniqueBuyers24h: g.buyers24h ?? null,
    replyCount: p.replyCount ?? null,
    hasSocials: Boolean(p.twitter || p.telegram || p.website),
    mintAuthorityRevoked: c ? !c.mintAuthority : null,
    freezeAuthorityRevoked: c ? !c.freezeAuthority : null,
    top10HolderShare: c?.top10Share ?? null,
    topHolderShare: c?.topHolderShare ?? null,
  };

  // Hard rules. Any failure forces a PASS.
  const fails = [];
  if (!c?.exists) fails.push("not a real token mint");
  if (c?.exists && c.mintAuthority) fails.push("mint authority not revoked (dev can print more)");
  if (c?.exists && c.freezeAuthority) fails.push("freeze authority not revoked (dev can freeze wallets)");
  if (ageMin !== null && ageMin < n("BOT_MIN_AGE_MINUTES", 15)) fails.push(`only ${ageMin} minutes old`);
  const mc = stats.marketCapUsd;
  if (mc !== null && mc < n("BOT_MIN_MCAP_USD", 8000)) fails.push(`market cap under $${n("BOT_MIN_MCAP_USD", 8000)}`);
  if (mc !== null && mc > n("BOT_MAX_MCAP_USD", 50_000_000)) fails.push("market cap too large for a $2 degen bet");
  if (stats.graduated && stats.topHolderShare !== null && stats.topHolderShare > 0.2)
    fails.push(`one wallet holds ${(stats.topHolderShare * 100).toFixed(0)}% of supply`);
  if (mc === null && stats.liquidityUsd === null) fails.push("no market data found anywhere");

  return { stats, fails };
}

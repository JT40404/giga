// Reads a wallet's recent swaps straight from the chain (any Solana RPC) and
// turns them into trading stats, a trader type and GIGAFUNBOT's verdict.
import { getSolPriceUsd, cgClient } from "./data.js";
import { fetchJson, getMint } from "./env.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USD_MINTS = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const MAX_TX = 60;
const DUST = 0.0005; // SOL

async function rpc(method, params) {
  const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
    }
  }));
  return out;
}

// Classify one transaction as a buy, a sell, or neither, from the wallet's balance changes.
function readSwap(tx, wallet, solUsd) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction?.message?.accountKeys || [];
  const idx = keys.findIndex((k) => (k.pubkey || k) === wallet);
  if (idx < 0) return null;
  const m = tx.meta;
  let sol = (m.postBalances[idx] - m.preBalances[idx]) / 1e9;
  if (idx === 0) sol += (m.fee || 0) / 1e9; // ignore the network fee

  const deltas = {};
  const add = (list, sign) => {
    for (const b of list || []) {
      if (b.owner !== wallet) continue;
      const amt = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
      deltas[b.mint] = (deltas[b.mint] || 0) + sign * amt;
    }
  };
  add(m.preTokenBalances, -1);
  add(m.postTokenBalances, +1);

  // Fold wrapped SOL and stablecoins into the SOL side of the trade.
  for (const [mint, d] of Object.entries(deltas)) {
    if (mint === WSOL) { sol += d; delete deltas[mint]; }
    else if (USD_MINTS.has(mint)) { sol += d / solUsd; delete deltas[mint]; }
  }
  const moves = Object.entries(deltas).filter(([, d]) => Math.abs(d) > 0);
  const gained = moves.filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1])[0];
  const lost = moves.filter(([, d]) => d < 0).sort((a, b) => a[1] - b[1])[0];
  const time = (tx.blockTime || 0) * 1000;
  if (gained && sol < -DUST) return { side: "buy", mint: gained[0], sol: -sol, time };
  if (lost && sol > DUST) return { side: "sell", mint: lost[0], sol, time };
  return null;
}

async function symbols(mints) {
  const out = {};
  const c = cgClient();
  if (!c || !mints.length) return out;
  try {
    const r = await fetchJson(`${c.base}/onchain/networks/solana/tokens/multi/${mints.slice(0, 30).join(",")}`, c.headers);
    for (const t of r.data || []) if (t.attributes?.address) out[t.attributes.address] = t.attributes.symbol;
  } catch { /* symbols are cosmetic */ }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtHold = (min) => (min == null ? "n/a" : min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} hours` : `${(min / 1440).toFixed(1)} days`);
const sol2 = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} SOL`;

export async function judgeWallet(wallet) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error("That doesn't look like a Solana wallet address.");

  const sigs = (await rpc("getSignaturesForAddress", [wallet, { limit: 100 }])) || [];
  const ok = sigs.filter((s) => !s.err).slice(0, MAX_TX).map((s) => s.signature);
  const [txs, solUsd] = await Promise.all([
    mapLimit(ok, 8, (sig) => rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])),
    getSolPriceUsd().catch(() => 150),
  ]);
  const swaps = txs.map((t) => readSwap(t, wallet, solUsd)).filter(Boolean).sort((a, b) => a.time - b.time);

  // Does this wallet hold the bot's own token?
  let holdsBotToken = null;
  const botMint = getMint();
  if (botMint) {
    try {
      const r = await rpc("getTokenAccountsByOwner", [wallet, { mint: botMint }, { encoding: "jsonParsed" }]);
      holdsBotToken = (r?.value || []).some((a) => Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0) > 0);
    } catch { /* optional */ }
  }

  // Per-token ledger
  const tokens = {};
  for (const s of swaps) {
    const t = (tokens[s.mint] ||= { mint: s.mint, spent: 0, got: 0, buys: 0, sells: 0, firstBuy: null, firstSell: null });
    if (s.side === "buy") { t.spent += s.sol; t.buys++; t.firstBuy ??= s.time; }
    else { t.got += s.sol; t.sells++; if (t.firstBuy && !t.firstSell) t.firstSell = s.time; }
  }
  const list = Object.values(tokens);
  const closed = list.filter((t) => t.buys && t.sells);
  const wins = closed.filter((t) => t.got > t.spent);
  const holds = closed.filter((t) => t.firstSell).map((t) => (t.firstSell - t.firstBuy) / 60000);
  const bags = list.filter((t) => t.buys && !t.sells);
  const buys = swaps.filter((s) => s.side === "buy");
  const spentTotal = buys.reduce((a, s) => a + s.sol, 0);
  const gotTotal = swaps.filter((s) => s.side === "sell").reduce((a, s) => a + s.sol, 0);
  const spanDays = swaps.length > 1 ? Math.max((swaps.at(-1).time - swaps[0].time) / 864e5, 1) : 1;
  const realized = closed.reduce((a, t) => a + (t.got - t.spent), 0);

  const stats = {
    txScanned: ok.length,
    trades: swaps.length,
    buys: buys.length,
    sells: swaps.length - buys.length,
    tokensTraded: list.length,
    closedPositions: closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    realizedSol: realized, // profit or loss on coins actually sold
    netFlowSol: gotTotal - spentTotal, // includes coins still held
    avgBuySol: buys.length ? spentTotal / buys.length : null,
    medianHoldMin: median(holds),
    tradesPerDay: swaps.length / spanDays,
    openBags: bags.length,
    solUsd,
  };

  const sorted = [...closed].sort((a, b) => (b.got - b.spent) - (a.got - a.spent));
  const best = sorted[0] && sorted[0].got > sorted[0].spent ? sorted[0] : null;
  const worst = sorted.at(-1) && sorted.at(-1).got < sorted.at(-1).spent ? sorted.at(-1) : null;
  const names = await symbols([best?.mint, worst?.mint].filter(Boolean));
  const label = (t) => (names[t.mint] ? `$${names[t.mint]}` : `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`);

  return { wallet, stats, holdsBotToken, ...verdict(stats, best && { name: label(best), pnl: best.got - best.spent }, worst && { name: label(worst), pnl: worst.got - worst.spent }) };
}

function verdict(s, best, worst) {
  const T = process.env.TOKEN_TICKER || "GIGAFUNBOT";
  if (!s.trades) {
    return {
      type: "The Spectator",
      rating: 0,
      roast: `No swaps in your last ${s.txScanned} transactions. You're not a trader, you're a tourist. Come sit in the boiler room and watch.`,
      notes: [],
    };
  }

  let rating = 50;
  if (s.winRate != null) rating += (s.winRate - 0.4) * 60;
  rating += Math.max(-15, Math.min(15, s.realizedSol * 3));
  if (s.medianHoldMin != null && s.medianHoldMin < 5) rating -= 10;
  if (s.tradesPerDay > 40 && s.trades >= 20) rating -= 8;
  if (s.openBags > 8 && s.closedPositions < 3) rating -= 8;
  rating = Math.max(1, Math.min(99, Math.round(rating)));

  const wr = s.winRate != null ? `${Math.round(s.winRate * 100)}%` : "unknown";
  let type, roast;
  if (s.tradesPerDay > 40 && s.trades >= 20) {
    type = "The Machine Gunner";
    roast = `${Math.round(s.tradesPerDay)} trades a day? That's not trading, that's a nervous twitch. Your fees are paying someone's rent.`;
  } else if (s.medianHoldMin != null && s.medianHoldMin < 5 && s.closedPositions >= 3) {
    type = "Paper Hands";
    roast = `Median hold of ${fmtHold(s.medianHoldMin)}. You don't hold coins, you high-five them on the way past.`;
  } else if (s.openBags >= 8 && s.closedPositions <= 2) {
    type = "The Bag Collector";
    roast = `${s.openBags} coins bought and never sold. That's not a portfolio, it's a museum.`;
  } else if (s.winRate >= 0.6 && s.closedPositions >= 4 && s.realizedSol > 0) {
    type = "The Sniper";
    roast = `${wr} win rate and ${sol2(s.realizedSol)} realized. Fine. You're actually good. I hate it. Respect.`;
  } else if (s.medianHoldMin != null && s.medianHoldMin > 1440) {
    type = "Diamond Hands";
    roast = `Median hold of ${fmtHold(s.medianHoldMin)}. Patience of a monk, nerves of a boiler. I see you.`;
  } else if (s.realizedSol < 0 && s.winRate != null && s.winRate < 0.3 && s.closedPositions >= 4) {
    type = "Exit Liquidity";
    roast = `${wr} win rate and ${sol2(s.realizedSol)} realized. Somebody had to buy the top. Thank you for your service.`;
  } else {
    type = "Degen in Training";
    roast = `${s.trades} trades, ${wr} win rate, ${sol2(s.realizedSol)} realized. Not a disaster, not a legend. Keep stoking.`;
  }

  const notes = [];
  if (best) notes.push(`Best trade: ${best.name}, ${sol2(best.pnl)}.`);
  if (worst) notes.push(`Worst trade: ${worst.name}, ${sol2(worst.pnl)}. We don't talk about it.`);
  return { type, rating, roast, notes, ticker: T };
}

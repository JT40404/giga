// Diamond-hands leaderboard: current holders of the token, ranked by how long
// their token account has existed (first time they received the token).
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getPumpCoin } from "./data.js";

const SCAN = Number(process.env.LEADERBOARD_SCAN || 150); // biggest holders to check
const SHOW = 50;

async function rpc(method, params) {
  const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
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

// Oldest transaction time on a token account = when this wallet first got the token.
async function firstSeen(tokenAccount) {
  let before, oldest = null;
  for (let page = 0; page < 5; page++) {
    const sigs = await rpc("getSignaturesForAddress", [tokenAccount, before ? { limit: 1000, before } : { limit: 1000 }]);
    if (!sigs?.length) break;
    const last = sigs[sigs.length - 1];
    oldest = last.blockTime ? last.blockTime * 1000 : oldest;
    if (sigs.length < 1000) break;
    before = last.signature;
  }
  return oldest;
}

export async function holderLeaderboard(mint) {
  const mintInfo = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const parsed = mintInfo?.value?.data?.parsed?.info;
  if (!parsed) throw new Error("Token mint not found on-chain.");
  const programId = mintInfo.value.owner; // classic SPL or Token-2022
  const decimals = parsed.decimals;
  const supply = Number(parsed.supply) / 10 ** decimals;

  // Every token account for this mint; we only need owner (32 bytes) + amount (8 bytes).
  const accounts = await rpc("getProgramAccounts", [
    programId,
    { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] },
  ]);

  const byOwner = new Map();
  for (const a of accounts || []) {
    const raw = Buffer.from(a.account.data[0], "base64");
    if (raw.length < 40) continue;
    const owner = bs58.encode(raw.subarray(0, 32));
    const amount = Number(raw.readBigUInt64LE(32)) / 10 ** decimals;
    if (amount <= 0) continue;
    // Skip pools, bonding curves and other program-owned accounts: real wallets are on the curve.
    try { if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes())) continue; } catch { continue; }
    const prev = byOwner.get(owner);
    if (!prev || amount > prev.amount) byOwner.set(owner, { owner, tokenAccount: a.pubkey, amount: (prev?.amount || 0) + amount });
    else prev.amount += amount;
  }

  const holders = [...byOwner.values()].sort((a, b) => b.amount - a.amount);
  const scan = holders.slice(0, SCAN);
  const since = await mapLimit(scan, 10, (h) => firstSeen(h.tokenAccount));

  let launch = null, dev = null;
  try {
    const p = await getPumpCoin(mint);
    launch = p.createdAt || null;
    dev = p.creator || null;
  } catch { /* optional */ }
  const known = since.filter(Boolean);
  if (!launch && known.length) launch = Math.min(...known);

  const now = Date.now();
  const board = scan
    .map((h, i) => ({ ...h, since: since[i] }))
    .filter((h) => h.since)
    .sort((a, b) => a.since - b.since || b.amount - a.amount)
    .slice(0, SHOW)
    .map((h, i) => ({
      rank: i + 1,
      wallet: h.owner,
      since: h.since,
      heldMs: now - h.since,
      amount: h.amount,
      pctSupply: supply ? (h.amount / supply) * 100 : null,
      og: launch ? h.since - launch <= 60 * 60 * 1000 : false, // bought in the first hour
      dev: dev ? h.owner === dev : false,
    }));

  return { mint, launch, holders: holders.length, scanned: scan.length, board, updatedAt: now };
}

import { send } from "../_lib/env.js";
import { listVerdicts, storeConfigured } from "../_lib/bot/store.js";
import { botKeypair } from "../_lib/bot/trade.js";

// Public feed of GIGA's calls for the website.
export default async function handler(req, res) {
  let wallet = null;
  try { wallet = botKeypair()?.publicKey.toBase58() || null; } catch { /* bad key format */ }
  const base = {
    enabled: process.env.BOT_ENABLED === "true",
    dryRun: process.env.BOT_DRY_RUN !== "false",
    handle: (process.env.BOT_HANDLE || process.env.BOT_NAME || "GIGA").replace(/^@/, ""),
    buyUsd: Number(process.env.BOT_BUY_USD || 2),
    botWallet: wallet,
  };
  if (!storeConfigured()) return send(res, 200, { ...base, verdicts: [] }, 15);
  try {
    const verdicts = (await listVerdicts(30)).map(({ authorWallet, ...v }) => v);
    send(res, 200, { ...base, verdicts }, 15);
  } catch (e) {
    send(res, 200, { ...base, verdicts: [], error: e.message }, 5);
  }
}

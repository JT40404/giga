import { send } from "./_lib/env.js";
import { judgeWallet } from "./_lib/wallet.js";

// Judges a wallet's recent trading. Cached 10 minutes per wallet so repeat
// lookups don't burn RPC credits.
export default async function handler(req, res) {
  const address = String(req.query.address || "").trim();
  try {
    send(res, 200, await judgeWallet(address), 600);
  } catch (e) {
    send(res, 400, { error: e.message || "Couldn't read that wallet." }, 0);
  }
}

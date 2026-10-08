import { getMint, send } from "../lib/env.js";
import { holderLeaderboard } from "../lib/holders.js";

// Holder leaderboard. Rebuilt at most every 30 minutes (edge cache) because
// each rebuild makes a few hundred RPC calls.
export default async function handler(req, res) {
  const mint = getMint();
  if (!mint) return send(res, 200, { configured: false, board: [] }, 60);
  try {
    send(res, 200, { configured: true, ...(await holderLeaderboard(mint)) }, 1800);
  } catch (e) {
    send(res, 502, { configured: true, board: [], error: e.message }, 60);
  }
}

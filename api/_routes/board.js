import { send } from "../_lib/env.js";
import { trendingBoard } from "../_lib/scan.js";

// Trending Solana coins, scored. Cached 2 minutes at the edge so the
// whole site uses about one CoinGecko call pair per refresh.
export default async function handler(req, res) {
  try {
    const calls = await trendingBoard(12);
    send(res, 200, { calls, updatedAt: Date.now() }, 120);
  } catch (e) {
    send(res, 502, { calls: [], error: `The board couldn't load: ${e.message}` }, 15);
  }
}

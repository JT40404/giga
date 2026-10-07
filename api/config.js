import { getMint, send } from "./_lib/env.js";

// Public, non-secret site settings. Set TOKEN_MINT in Vercel at launch.
export default function handler(req, res) {
  send(res, 200, {
    name: process.env.BOT_NAME || "GIGA",
    ticker: process.env.TOKEN_TICKER || "GIGA",
    mint: getMint(),
  }, 60);
}

// One function serves every /api/* address (Vercel's Hobby plan caps the number
// of functions). vercel.json rewrites /api/<path> to /api/router?path=<path>.
// Each route is loaded only when it's requested, so one route's problem can't
// break the others.
const ROUTES = {
  config: () => import("./_routes/config.js"),
  market: () => import("./_routes/market.js"),
  board: () => import("./_routes/board.js"),
  ask: () => import("./_routes/ask.js"),
  wallet: () => import("./_routes/wallet.js"),
  holders: () => import("./_routes/holders.js"),
  "bot/tick": () => import("./_routes/bot-tick.js"),
  "bot/verdicts": () => import("./_routes/bot-verdicts.js"),
  "launch/create": () => import("./_routes/launch-create.js"),
  "launch/metadata": () => import("./_routes/launch-metadata.js"),
  "launch/rpc": () => import("./_routes/launch-rpc.js"),
};

export default async function handler(req, res) {
  const path = String(req.query.path || "").replace(/^\/+|\/+$/g, "");
  const load = ROUTES[path];
  if (!load) return res.status(404).json({ error: "Not found" });
  delete req.query.path;
  try {
    const { default: route } = await load();
    return await route(req, res);
  } catch (e) {
    console.error(`/api/${path} failed:`, e);
    if (!res.headersSent) res.status(500).json({ error: `Server error in /api/${path}: ${e.message}` });
  }
}

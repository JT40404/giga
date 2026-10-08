// One function serves every /api/* address (Vercel's Hobby plan caps the number
// of functions). All the real code lives in /server, outside /api, so Vercel
// only ever sees this single file as a function. vercel.json rewrites /api/<path> to /api/router?path=<path>.
// Each route is loaded only when it's requested, so one route's problem can't
// break the others.
const ROUTES = {
  config: () => import("../server/routes/config.js"),
  market: () => import("../server/routes/market.js"),
  board: () => import("../server/routes/board.js"),
  ask: () => import("../server/routes/ask.js"),
  wallet: () => import("../server/routes/wallet.js"),
  holders: () => import("../server/routes/holders.js"),
  "bot/tick": () => import("../server/routes/bot-tick.js"),
  "bot/verdicts": () => import("../server/routes/bot-verdicts.js"),
  "launch/create": () => import("../server/routes/launch-create.js"),
  "launch/metadata": () => import("../server/routes/launch-metadata.js"),
  "launch/rpc": () => import("../server/routes/launch-rpc.js"),
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

// Asks PumpPortal for an UNSIGNED pump.fun create transaction (with optional
// dev buy). The visitor's wallet and the new mint key sign it in the browser.
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_DEV_BUY = Number(process.env.LAUNCH_MAX_DEV_BUY_SOL || 20);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body || {};

  const name = String(b.name || "").trim().slice(0, 32);
  const symbol = String(b.symbol || "").trim().toUpperCase().slice(0, 10);
  const uri = String(b.uri || "").trim();
  const devBuy = Number(b.devBuy || 0);
  if (!B58.test(b.publicKey || "") || !B58.test(b.mint || "")) return res.status(400).json({ error: "Invalid wallet or mint address." });
  if (!name || !symbol) return res.status(400).json({ error: "Name and ticker are required." });
  if (!/^https:\/\/\S+$/.test(uri)) return res.status(400).json({ error: "Missing metadata URI." });
  if (!(devBuy >= 0 && devBuy <= MAX_DEV_BUY)) return res.status(400).json({ error: `Dev buy must be between 0 and ${MAX_DEV_BUY} SOL.` });

  const key = process.env.PUMPPORTAL_API_KEY ? `?api-key=${encodeURIComponent(process.env.PUMPPORTAL_API_KEY)}` : "";
  try {
    const r = await fetch(`https://pumpportal.fun/api/trade-local${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: b.publicKey,
        action: "create",
        tokenMetadata: { name, symbol, uri },
        mint: b.mint,
        denominatedInSol: "true",
        amount: devBuy,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      }),
    });
    if (r.status !== 200) {
      const why = (r.statusText || (await r.text()) || "").slice(0, 200);
      throw new Error(`PumpPortal ${r.status}${why ? `: ${why}` : ""}`);
    }
    const tx = Buffer.from(await r.arrayBuffer()).toString("base64");
    res.status(200).json({ tx });
  } catch (e) {
    res.status(502).json({ error: `Couldn't build the launch transaction (${e.message}).` });
  }
}

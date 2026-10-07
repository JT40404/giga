// Proxies the few Solana RPC calls the tip flow needs, so your RPC key
// (Helius, QuickNode, etc.) never reaches the browser.
const ALLOWED = new Set([
  "getLatestBlockhash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountBalance",
  "getSignatureStatuses",
  "getBalance",
  "getMinimumBalanceForRentExemption",
  "sendTransaction",
]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = req.body;
  if (!body || Array.isArray(body) || !ALLOWED.has(body.method)) {
    return res.status(400).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "Method not allowed" } });
  }

  const url = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json").send(text);
  } catch (e) {
    res.status(502).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32000, message: "RPC unreachable" } });
  }
}

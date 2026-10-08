// Minimal Solana RPC proxy for the launcher: balance, send, and status only.
const ALLOWED = new Set(["getBalance", "sendTransaction", "getSignatureStatuses"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body;
  if (!body || Array.isArray(body) || !ALLOWED.has(body.method))
    return res.status(400).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "Method not allowed" } });
  try {
    const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    res.status(r.status).setHeader("Content-Type", "application/json").send(await r.text());
  } catch {
    res.status(502).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32000, message: "RPC unreachable" } });
  }
}

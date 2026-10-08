// Uploads the token image + details to pump.fun's IPFS endpoint and returns the
// metadata URI the create transaction needs. Runs server-side to avoid CORS.
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const clean = (v, n) => String(v ?? "").trim().slice(0, n);
const url = (v) => {
  const s = clean(v, 200);
  return !s || /^https:\/\/[^\s]+$/i.test(s) ? s : null;
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body || {};

  const name = clean(b.name, 32), symbol = clean(b.symbol, 10).toUpperCase();
  if (!name || !symbol) return res.status(400).json({ error: "Name and ticker are required." });
  const links = { twitter: url(b.twitter), telegram: url(b.telegram), website: url(b.website) };
  if (Object.values(links).includes(null)) return res.status(400).json({ error: "Links must start with https://" });

  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(String(b.image || ""));
  if (!m || !TYPES.has(m[1].toLowerCase())) return res.status(400).json({ error: "Add a PNG, JPG, GIF or WEBP image." });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: "Image must be under 2.5 MB." });

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: m[1] }), `image.${m[1].split("/")[1]}`);
  form.append("name", name);
  form.append("symbol", symbol);
  form.append("description", clean(b.description, 500));
  form.append("twitter", links.twitter);
  form.append("telegram", links.telegram);
  form.append("website", links.website);
  form.append("showName", "true");

  try {
    const r = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      body: form,
      headers: { Origin: "https://pump.fun", Referer: "https://pump.fun/create", Accept: "application/json" },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`pump.fun returned ${r.status}`);
    const data = JSON.parse(text);
    if (!data.metadataUri) throw new Error("pump.fun didn't return a metadata URI");
    res.status(200).json({ uri: data.metadataUri, image: data.metadata?.image || null });
  } catch (e) {
    res.status(502).json({ error: `Image upload failed: ${e.message}. You can paste your own metadata URI under Advanced instead.` });
  }
}

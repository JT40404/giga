import { send } from "../_lib/env.js";
import { lookupCoin } from "../_lib/scan.js";

export default async function handler(req, res) {
  const q = String(req.query.q || "").slice(0, 80);
  try {
    const call = await lookupCoin(q);
    send(res, 200, { call }, 60);
  } catch (e) {
    send(res, 404, { error: e.message }, 0);
  }
}

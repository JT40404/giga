// Buys a fixed USD amount of a token with SOL through Jupiter Swap API V2.
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getSolPriceUsd } from "../data.js";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "https://api.jup.ag/swap/v2";

export function botKeypair() {
  const k = process.env.BOT_PRIVATE_KEY;
  if (!k) return null;
  return Keypair.fromSecretKey(k.trim().startsWith("[") ? Uint8Array.from(JSON.parse(k)) : bs58.decode(k.trim()));
}

async function solBalance(pubkey) {
  const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pubkey] }),
  });
  return (await r.json())?.result?.value ?? 0;
}

export async function buyUsd(mint, usd) {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("JUPITER_API_KEY is not set");
  const kp = botKeypair();
  if (!kp) throw new Error("BOT_PRIVATE_KEY is not set");

  const solUsd = await getSolPriceUsd();
  const lamports = Math.floor((usd / solUsd) * 1e9);
  // Keep a reserve for network fees and token-account rent.
  const reserve = 0.01 * 1e9;
  const bal = await solBalance(kp.publicKey.toBase58());
  if (bal < lamports + reserve) throw new Error("Bot wallet is low on SOL. Top it up.");

  const qs = new URLSearchParams({ inputMint: SOL, outputMint: mint, amount: String(lamports), taker: kp.publicKey.toBase58() });
  const or = await fetch(`${JUP}/order?${qs}`, { headers: { "x-api-key": key } });
  if (!or.ok) throw new Error(`Jupiter order ${or.status}: ${(await or.text()).slice(0, 160)}`);
  const order = await or.json();
  if (!order.transaction) throw new Error(`No route to buy this token (${order.errorMessage || "no transaction"})`);

  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([kp]);

  const er = await fetch(`${JUP}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ signedTransaction: Buffer.from(tx.serialize()).toString("base64"), requestId: order.requestId }),
  });
  if (!er.ok) throw new Error(`Jupiter execute ${er.status}: ${(await er.text()).slice(0, 160)}`);
  const result = await er.json();
  if (result.status !== "Success") throw new Error(`Swap failed (code ${result.code}${result.error ? `: ${result.error}` : ""})`);
  return { signature: result.signature, solSpent: lamports / 1e9, tokensOut: result.totalOutputAmount };
}

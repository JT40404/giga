// Token launcher. Everything is signed in the visitor's own wallet.
const WEB3_URL = "https://esm.sh/@solana/web3.js@1.98.0";
const MAX_IMAGE = 2.5 * 1024 * 1024;
const CREATE_COST_SOL = 0.02; // approximate pump.fun creation + network cost

const $ = (s) => document.querySelector(s);
const state = { provider: null, wallet: null, balance: null, image: null, busy: false };

/* ---------- small helpers ---------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}
async function rpc(method, params) {
  const r = await fetch("/api/launch/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}
let web3Promise;
const web3 = () => (web3Promise ??= import(WEB3_URL));

/* ---------- wallet ---------- */

function getProvider() {
  return window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;
}

async function connect() {
  const p = getProvider();
  if (!p) {
    toast("No Solana wallet found. Install Phantom, then reload.");
    window.open("https://phantom.app/download", "_blank", "noopener");
    return false;
  }
  try {
    const res = await p.connect();
    state.provider = p;
    state.wallet = (res?.publicKey || p.publicKey).toString();
    p.on?.("accountChanged", (pk) => {
      state.wallet = pk ? pk.toString() : null;
      refreshBalance();
    });
    await refreshBalance();
    return true;
  } catch {
    toast("Wallet connection cancelled.");
    return false;
  }
}

async function refreshBalance() {
  if (state.wallet) {
    try {
      state.balance = (await rpc("getBalance", [state.wallet, { commitment: "confirmed" }])).value / 1e9;
    } catch {
      state.balance = null;
    }
  }
  renderWallet();
}

function renderWallet() {
  $("#walletBtn").textContent = state.wallet
    ? `${short(state.wallet)}${state.balance != null ? ` · ${state.balance.toFixed(3)} SOL` : ""}`
    : "Connect wallet";
  if (!state.busy) $("#launchBtn").textContent = state.wallet ? "Launch coin" : "Connect wallet to launch";
  updateCost();
}

/* ---------- form + preview ---------- */

function devBuy() {
  const v = Number(String($("#devBuy").value).replace(",", "."));
  return isFinite(v) && v >= 0 ? v : NaN;
}

function updateCost() {
  const buy = devBuy();
  const total = (isNaN(buy) ? 0 : buy) + CREATE_COST_SOL;
  const bal = state.balance != null ? ` You have <strong>${state.balance.toFixed(3)} SOL</strong>.` : "";
  $("#cost").innerHTML = `Total about <strong>${total.toFixed(3)} SOL</strong>: roughly ${CREATE_COST_SOL} SOL to create${buy > 0 ? ` plus your ${buy} SOL dev buy (PumpPortal adds a 0.5% fee on it)` : ""}.${bal}`;
  document.querySelectorAll("[data-buy]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.buy) === buy)));
}

function updatePreview() {
  const sym = $("#symbol").value.trim().toUpperCase();
  $("#pvSymbol").textContent = sym ? `$${sym}` : "$TICKER";
  $("#pvName").textContent = $("#name").value.trim() || "Coin name";
  $("#pvDesc").textContent = $("#description").value.trim() || "Your description shows here.";
}

function readImage(file) {
  const ok = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!file) return;
  if (!ok.includes(file.type)) return showError("Use a PNG, JPG, GIF or WEBP image.");
  if (file.size > MAX_IMAGE) return showError("Image must be under 2.5 MB.");
  const reader = new FileReader();
  reader.onload = () => {
    state.image = reader.result;
    $("#pvImg").innerHTML = `<img src="${state.image}" alt="Token image preview" />`;
    $("#dropText").innerHTML = `${esc(file.name)}<br><small>Click to change</small>`;
    showError("");
  };
  reader.readAsDataURL(file);
}

function showError(msg) {
  $("#formError").textContent = msg;
}

/* ---------- progress ---------- */

function step(name, status) {
  const li = document.querySelector(`[data-step="${name}"]`);
  li.classList.remove("active", "done", "fail");
  if (status) li.classList.add(status);
}

function resetSteps() {
  document.querySelectorAll("[data-step]").forEach((li) => li.classList.remove("active", "done", "fail"));
  $("#result").innerHTML = "";
  $("#progress").hidden = false;
}

/* ---------- launch ---------- */

async function launch(e) {
  e.preventDefault();
  if (state.busy) return;
  showError("");

  const name = $("#name").value.trim();
  const symbol = $("#symbol").value.trim().toUpperCase();
  const customUri = $("#customUri").value.trim();
  const buy = devBuy();
  if (!state.image && !customUri) return showError("Add an image for your coin.");
  if (!name) return showError("Give your coin a name.");
  if (!symbol) return showError("Give your coin a ticker.");
  if (isNaN(buy)) return showError("Dev buy must be a number, like 0.1.");
  for (const id of ["twitter", "telegram", "website"]) {
    const v = $("#" + id).value.trim();
    if (v && !/^https:\/\/\S+$/i.test(v)) return showError("Links need to start with https://");
  }
  if (customUri && !/^https:\/\/\S+$/i.test(customUri)) return showError("The metadata URI needs to start with https://");

  if (!state.wallet && !(await connect())) return;
  if (state.balance != null && state.balance < buy + CREATE_COST_SOL) {
    return showError(`Not enough SOL. You need about ${(buy + CREATE_COST_SOL).toFixed(3)} SOL.`);
  }

  state.busy = true;
  const btn = $("#launchBtn");
  btn.disabled = true;
  btn.textContent = "Launching…";
  resetSteps();
  let current = "upload";

  try {
    // 1. Metadata
    step("upload", "active");
    let uri = customUri;
    if (!uri) {
      const r = await fetch("/api/launch/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: state.image,
          name,
          symbol,
          description: $("#description").value.trim(),
          twitter: $("#twitter").value.trim(),
          telegram: $("#telegram").value.trim(),
          website: $("#website").value.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Image upload failed.");
      uri = d.uri;
    }
    step("upload", "done");

    // 2. Build the transaction with a brand-new mint address
    current = "build";
    step("build", "active");
    const { Keypair, VersionedTransaction } = await web3();
    const mint = Keypair.generate();
    const r = await fetch("/api/launch/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: state.wallet, mint: mint.publicKey.toBase58(), name, symbol, uri, devBuy: buy }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Couldn't build the transaction.");
    const tx = VersionedTransaction.deserialize(b64ToBytes(d.tx));
    step("build", "done");

    // 3. Wallet signs first, then the new mint key adds its signature
    current = "sign";
    step("sign", "active");
    const signed = await state.provider.signTransaction(tx);
    const finalTx = VersionedTransaction.deserialize(signed.serialize());
    finalTx.sign([mint]);
    step("sign", "done");

    // 4. Send
    current = "send";
    step("send", "active");
    const sig = await rpc("sendTransaction", [bytesToB64(finalTx.serialize()), { encoding: "base64", skipPreflight: false, maxRetries: 3 }]);
    step("send", "done");

    // 5. Confirm
    current = "confirm";
    step("confirm", "active");
    const start = Date.now();
    let confirmed = false;
    while (Date.now() - start < 60000) {
      const st = (await rpc("getSignatureStatuses", [[sig]]))?.value?.[0];
      if (st?.err) throw new Error("The launch transaction failed on-chain.");
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) { confirmed = true; break; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    step("confirm", confirmed ? "done" : "active");
    showSuccess(mint.publicKey.toBase58(), sig, symbol, confirmed);
    refreshBalance();
  } catch (err) {
    step(current, "fail");
    const msg = err?.message || String(err);
    showError(/reject|cancel|denied/i.test(msg) ? "Launch cancelled in your wallet." : msg);
  } finally {
    state.busy = false;
    btn.disabled = false;
    renderWallet();
  }
}

function showSuccess(mint, sig, symbol, confirmed) {
  $("#result").innerHTML = `<div class="success">
    <h2>${confirmed ? "Launched!" : "Sent!"}</h2>
    <p>${confirmed ? `$${esc(symbol)} is live on pump.fun.` : "Still confirming. It should show up on pump.fun in a minute."}</p>
    <p>Contract address:<br><code>${esc(mint)}</code></p>
    <div class="links">
      <a href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">Open on pump.fun</a>
      <a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">Transaction</a>
      <a href="#" id="copyMint">Copy CA</a>
    </div>
  </div>`;
  $("#copyMint").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(mint);
      toast("Contract address copied");
    } catch {
      toast("Copy failed. Select the address and copy it manually.");
    }
  });
}

/* ---------- wiring ---------- */

$("#walletBtn").addEventListener("click", () => (state.wallet ? null : connect()));
$("#launchForm").addEventListener("submit", launch);
["name", "symbol", "description"].forEach((id) => $("#" + id).addEventListener("input", updatePreview));
$("#symbol").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/\s/g, "")));
$("#devBuy").addEventListener("input", updateCost);
document.querySelectorAll("[data-buy]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#devBuy").value = b.dataset.buy;
    updateCost();
  })
);
$("#image").addEventListener("change", (e) => readImage(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => readImage(e.dataTransfer.files[0]));

renderWallet();
updatePreview();
getProvider()?.connect?.({ onlyIfTrusted: true })
  .then((res) => {
    const p = getProvider();
    if (!(res?.publicKey || p.publicKey)) return;
    state.provider = p;
    state.wallet = (res?.publicKey || p.publicKey).toString();
    refreshBalance();
  })
  .catch(() => {});

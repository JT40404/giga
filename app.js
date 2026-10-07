import { SITE } from "./config.js";

// Solana libraries load only when someone connects a wallet or tips,
// so the page itself stays light.
const WEB3_URL = "https://esm.sh/@solana/web3.js@1.98.0";
const SPL_URL = "https://esm.sh/@solana/spl-token@0.4.9?deps=@solana/web3.js@1.98.0";
const BUFFER_URL = "https://esm.sh/buffer@6.0.3";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const $ = (s, r = document) => r.querySelector(s);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  name: SITE.name,
  ticker: SITE.ticker,
  mint: SITE.mint || null,
  wallet: null,
  provider: null,
  balance: null,
  mintInfo: null,
  callouts: [],
  offset: 0,
  newestId: null,
  tipTarget: null,
};

/* ---------- formatting ---------- */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const usdCompact = (n) => (n == null || !isFinite(n) ? "—" : "$" + compact.format(n));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Tiny memecoin prices read better as $0.0₅4123 (pump.fun style).
function priceHtml(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.0001) return "$" + n.toPrecision(4).replace(/0+$/, "");
  const [, exp] = n.toExponential(3).split("e-");
  const zeros = Number(exp) - 1;
  const digits = n.toExponential(3).split("e")[0].replace(".", "").replace(/0+$/, "");
  return `$0.0<sub>${zeros}</sub>${digits}`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

// Deterministic pixel avatar for callers without a profile image.
const identicons = new Map();
function identicon(seed) {
  if (identicons.has(seed)) return identicons.get(seed);
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const c = document.createElement("canvas");
  c.width = c.height = 5;
  const g = c.getContext("2d");
  const palette = ["#5fd36e", "#ff6d8f", "#ebe4cf", "#7fb0ff", "#f5c542"];
  g.fillStyle = "#1b2533";
  g.fillRect(0, 0, 5, 5);
  g.fillStyle = palette[Math.abs(h) % palette.length];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if ((h >>> (y * 3 + x)) & 1) {
        g.fillRect(x, y, 1, 1);
        g.fillRect(4 - x, y, 1, 1);
      }
    }
  const url = c.toDataURL();
  identicons.set(seed, url);
  return url;
}

/* ---------- config ---------- */

async function loadConfig() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) {
      const c = await r.json();
      state.name = c.name || state.name;
      state.ticker = c.ticker || state.ticker;
      state.mint = c.mint || state.mint;
    }
  } catch {
    /* running without serverless functions; use config.js */
  }
  document.querySelectorAll('[data-bind="name"]').forEach((el) => (el.textContent = state.name));
  document.querySelectorAll('[data-bind="ticker"]').forEach((el) => (el.textContent = state.ticker));
  document.title = `${state.name} — live callouts & tips`;

  if (state.mint) {
    $("#caText").textContent = state.mint;
    $("#copyCa").hidden = false;
    $("#postLink").href = `https://pump.fun/coin/${state.mint}`;
    renderLinks({});
  }
}

function renderLinks(extra) {
  if (!state.mint) return;
  const links = [
    ["pump.fun", `https://pump.fun/coin/${state.mint}`],
    ["Chart", `https://www.geckoterminal.com/solana/tokens/${state.mint}`],
    ["Solscan", `https://solscan.io/token/${state.mint}`],
  ];
  if (extra.twitter) links.push(["X", extra.twitter]);
  if (extra.telegram) links.push(["Telegram", extra.telegram]);
  if (extra.website) links.push(["Website", extra.website]);
  $("#tokenLinks").innerHTML = links
    .filter(([, u]) => /^https:\/\//.test(u))
    .map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`)
    .join("");
}

/* ---------- market ---------- */

async function loadMarket() {
  if (!state.mint) return;
  try {
    const r = await fetch("/api/market");
    const m = await r.json();
    if (!m.configured) return;

    $("#price").innerHTML = priceHtml(m.price);
    const ch = $("#change");
    if (m.change24h != null) {
      const up = m.change24h >= 0;
      ch.textContent = `${up ? "+" : ""}${m.change24h.toFixed(2)}% in 24h`;
      ch.className = `change ${up ? "up" : "down"}`;
    } else {
      ch.textContent = m.errors?.coingecko ? "CoinGecko hasn't indexed this token yet" : "24h change unavailable";
      ch.className = "change";
    }
    $("#mcap").textContent = usdCompact(m.marketCap);
    $("#vol").textContent = usdCompact(m.volume24h);
    $("#liq").textContent = usdCompact(m.liquidity);
    $("#txns").textContent =
      m.buys24h != null ? `${compact.format(m.buys24h)} / ${compact.format(m.sells24h ?? 0)}` : "—";
    $("#updated").textContent = `Updated ${new Date(m.updatedAt).toLocaleTimeString()}`;
    renderLinks(m.links || {});
    renderChart(m.chart || []);
  } catch {
    $("#updated").textContent = "Market data is unreachable. Retrying shortly.";
  }
}

// Stepped line chart: fits GIGA's pixel look and is honest about 15m candles.
function renderChart(points) {
  const el = $("#chart");
  if (points.length < 2) {
    el.innerHTML = `<p class="chart-empty">The price chart appears once CoinGecko has trading history for this token.</p>`;
    return;
  }
  const W = 800, H = 220, P = 8;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || max || 1;
  const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - min) / span) * (H - P * 2);
  let d = `M${x(0).toFixed(1)},${y(ys[0]).toFixed(1)}`;
  for (let i = 1; i < ys.length; i++) d += ` H${x(i).toFixed(1)} V${y(ys[i]).toFixed(1)}`;
  const up = ys[ys.length - 1] >= ys[0];
  const color = up ? "var(--signal)" : "var(--alarm)";
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">
      <path d="${d} V${H} H${x(0)} Z" fill="${color}" opacity="0.12"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

/* ---------- callouts ---------- */

async function loadCallouts({ older = false } = {}) {
  const thread = $("#thread");
  if (!state.mint) {
    thread.innerHTML = `<li class="thread-empty">Callouts from the pump.fun thread will appear here after launch.</li>`;
    return;
  }
  const offset = older ? state.offset : 0;
  try {
    const r = await fetch(`/api/callouts?offset=${offset}&limit=40`);
    const data = await r.json();
    if (data.error && !data.callouts.length) {
      if (!state.callouts.length)
        thread.innerHTML = `<li class="thread-empty">${esc(data.error)}. Retrying in a few seconds.</li>`;
      return;
    }
    if (older) {
      const seen = new Set(state.callouts.map((c) => c.id));
      state.callouts.push(...data.callouts.filter((c) => !seen.has(c.id)));
      state.offset += data.callouts.length;
    } else {
      const prevIds = new Set(state.callouts.map((c) => c.id));
      const freshIds = state.callouts.length ? data.callouts.filter((c) => !prevIds.has(c.id)).map((c) => c.id) : [];
      const olderKept = state.callouts.slice(40);
      state.callouts = [...data.callouts, ...olderKept.filter((c) => !data.callouts.some((d) => d.id === c.id))];
      state.offset = Math.max(state.offset, data.callouts.length);
      state.freshIds = new Set(freshIds);
    }
    $("#moreBtn").hidden = !data.hasMore;
    renderThread();
    updateBubble();
  } catch {
    if (!state.callouts.length)
      thread.innerHTML = `<li class="thread-empty">Couldn't reach the callout feed. Retrying shortly.</li>`;
  }
}

function renderThread() {
  const thread = $("#thread");
  if (!state.callouts.length) {
    thread.innerHTML = `<li class="thread-empty">No callouts yet. Be the first to post one on pump.fun.</li>`;
    return;
  }
  thread.innerHTML = state.callouts
    .map((c) => {
      const name = c.username || short(c.wallet) || "anon";
      const avatar = c.avatar || identicon(c.wallet || c.id);
      const profile = c.wallet ? `https://pump.fun/profile/${c.wallet}` : null;
      const badge =
        c.isBuy === true && c.sol
          ? `<span class="badge buy">bought ${c.sol.toFixed(2)} SOL</span>`
          : c.isBuy === false && c.sol
          ? `<span class="badge sell">sold ${c.sol.toFixed(2)} SOL</span>`
          : "";
      const self = c.wallet && c.wallet === state.wallet;
      const tipBtn = c.wallet
        ? `<button class="btn btn-tip" type="button" data-tip="${esc(c.id)}" ${self ? 'disabled title="This is your callout"' : ""}>Tip</button>`
        : "";
      return `
        <li class="callout${state.freshIds?.has(c.id) ? " fresh" : ""}">
          <img class="avatar" src="${esc(avatar)}" alt="" width="40" height="40" loading="lazy" />
          <div>
            <div class="meta">
              ${profile ? `<a class="who" href="${profile}" target="_blank" rel="noopener">${esc(name)}</a>` : `<span class="who">${esc(name)}</span>`}
              <span>${timeAgo(c.timestamp)}</span>
              ${badge}
            </div>
            ${c.text ? `<p class="callout-text">${esc(c.text)}</p>` : ""}
            ${c.image ? `<img class="callout-img" src="${esc(c.image)}" alt="Image attached to callout" loading="lazy" />` : ""}
          </div>
          ${tipBtn}
        </li>`;
    })
    .join("");
}

// GIGA reads out the newest callout in the hero speech bubble.
function updateBubble() {
  const top = state.callouts.find((c) => c.text);
  if (!top || top.id === state.newestId) return;
  state.newestId = top.id;
  const text = top.text.length > 160 ? top.text.slice(0, 157) + "…" : top.text;
  $("#bubbleWho").textContent = `${top.username || short(top.wallet) || "anon"}, ${timeAgo(top.timestamp)}`;
  const q = $("#bubbleText");
  if (reducedMotion) return void (q.textContent = text);
  clearInterval(updateBubble._t);
  let i = 0;
  q.textContent = "";
  updateBubble._t = setInterval(() => {
    q.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(updateBubble._t);
  }, 18);
}

/* ---------- wallet ---------- */

function getProvider() {
  return window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;
}

let solPromise;
function solana() {
  solPromise ??= Promise.all([import(WEB3_URL), import(SPL_URL), import(BUFFER_URL)]).then(([web3, spl, buf]) => ({
    web3,
    spl,
    Buffer: buf.Buffer,
    conn: new web3.Connection(`${location.origin}/api/rpc`, "confirmed"),
  }));
  return solPromise;
}

async function getMintInfo() {
  if (state.mintInfo) return state.mintInfo;
  const { web3, spl, conn } = await solana();
  const pk = new web3.PublicKey(state.mint);
  const acc = await conn.getAccountInfo(pk);
  if (!acc) throw new Error("The token mint wasn't found on-chain. Check TOKEN_MINT in Vercel.");
  // Works for both classic SPL and Token-2022 mints.
  const programId = acc.owner;
  const mint = await spl.getMint(conn, pk, "confirmed", programId);
  state.mintInfo = { pk, programId, decimals: mint.decimals };
  return state.mintInfo;
}

async function connectWallet() {
  const p = getProvider();
  if (!p) {
    toast("No Solana wallet found. Install Phantom, then reload this page.");
    window.open("https://phantom.app/download", "_blank", "noopener");
    return;
  }
  try {
    const res = await p.connect();
    state.provider = p;
    state.wallet = (res?.publicKey || p.publicKey).toString();
    p.on?.("accountChanged", (pk) => {
      state.wallet = pk ? pk.toString() : null;
      if (!state.wallet) disconnect();
      else refreshWallet();
    });
    refreshWallet();
  } catch (e) {
    toast(e?.message?.includes("User rejected") ? "Connection cancelled." : "Couldn't connect the wallet.");
  }
}

function disconnect() {
  state.provider?.disconnect?.();
  state.wallet = null;
  state.balance = null;
  renderWallet();
  renderThread();
}

async function refreshWallet() {
  renderWallet();
  renderThread();
  if (!state.mint || !state.wallet) return;
  try {
    const { web3, spl, conn } = await solana();
    const { pk, programId } = await getMintInfo();
    const ata = spl.getAssociatedTokenAddressSync(pk, new web3.PublicKey(state.wallet), false, programId);
    const b = await conn.getTokenAccountBalance(ata).catch(() => null);
    state.balance = b ? Number(b.value.uiAmountString) : 0;
  } catch {
    state.balance = null;
  }
  renderWallet();
}

function renderWallet() {
  const btn = $("#walletBtn");
  const body = $("#walletBody");
  if (!state.wallet) {
    btn.textContent = "Connect wallet";
    body.innerHTML = `<p class="muted">Connect Phantom, Solflare or Backpack to tip callers.</p>`;
    return;
  }
  btn.textContent = short(state.wallet);
  const bal =
    state.balance == null ? "—" : state.balance.toLocaleString("en-US", { maximumFractionDigits: 2 });
  body.innerHTML = `
    <p class="wallet-addr">${esc(state.wallet)}</p>
    <p class="wallet-bal">${bal} $${esc(state.ticker)}</p>
    ${state.mint ? `<a class="btn btn-wallet" href="https://pump.fun/coin/${state.mint}" target="_blank" rel="noopener">Buy $${esc(state.ticker)}</a>` : `<p class="muted">Tipping opens once the token launches.</p>`}`;
}

/* ---------- tipping ---------- */

function toRaw(str, decimals) {
  const s = String(str).trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error("Enter a number, like 5000.");
  const [i = "0", f = ""] = s.split(".");
  const raw = BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new Error("Tip amount must be more than zero.");
  return raw;
}

function openTip(id) {
  const c = state.callouts.find((x) => x.id === id);
  if (!c?.wallet) return;
  if (!state.mint) return toast("Tipping opens once the token launches.");
  if (!state.wallet) return connectWallet();
  state.tipTarget = c;
  $("#tipWho").textContent = c.username || short(c.wallet);
  $("#tipQuote").textContent = c.text ? `“${c.text.slice(0, 140)}${c.text.length > 140 ? "…" : ""}”` : "";
  $("#tipAmount").value = SITE.tipPresets[1];
  syncPresets();
  setStatus("");
  $("#tipSend").disabled = false;
  $("#tipDialog").showModal();
}

function syncPresets() {
  const v = $("#tipAmount").value.replace(/,/g, "");
  document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.amount === v)));
}

function setStatus(html, error = false) {
  const s = $("#tipStatus");
  s.innerHTML = html;
  s.classList.toggle("error", error);
}

async function waitForConfirmation(conn, sig, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value?.[0];
    if (st?.err) throw new Error("The transaction failed on-chain.");
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Still waiting on confirmation. Check Solscan in a minute.");
}

async function sendTip() {
  const c = state.tipTarget;
  const btn = $("#tipSend");
  btn.disabled = true;
  try {
    setStatus("Preparing the transaction…");
    const { web3, spl, conn, Buffer } = await solana();
    const { pk, programId, decimals } = await getMintInfo();
    const raw = toRaw($("#tipAmount").value, decimals);

    const from = new web3.PublicKey(state.wallet);
    const to = new web3.PublicKey(c.wallet);
    const fromAta = spl.getAssociatedTokenAddressSync(pk, from, false, programId);
    const toAta = spl.getAssociatedTokenAddressSync(pk, to, true, programId);

    const bal = await conn.getTokenAccountBalance(fromAta).catch(() => null);
    if (!bal || BigInt(bal.value.amount) < raw) throw new Error(`You don't have enough $${state.ticker} for this tip.`);

    const tx = new web3.Transaction();
    // Creates the caller's token account if they've never held the token (sender pays ~0.002 SOL rent).
    tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, pk, programId));
    tx.add(spl.createTransferCheckedInstruction(fromAta, pk, toAta, from, raw, decimals, [], programId));
    tx.add(
      new web3.TransactionInstruction({
        programId: new web3.PublicKey(MEMO_PROGRAM),
        keys: [],
        data: Buffer.from(`${state.name} tip for callout ${c.id}`.slice(0, 120), "utf8"),
      })
    );
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = from;

    setStatus("Approve the tip in your wallet…");
    let sig;
    if (state.provider.signAndSendTransaction) {
      const r = await state.provider.signAndSendTransaction(tx);
      sig = r?.signature || r;
    } else {
      const signed = await state.provider.signTransaction(tx);
      sig = await conn.sendRawTransaction(signed.serialize());
    }

    const link = `https://solscan.io/tx/${sig}`;
    setStatus(`Sent. Waiting for confirmation… <a href="${link}" target="_blank" rel="noopener">View on Solscan</a>`);
    await waitForConfirmation(conn, sig);
    setStatus(`Tip confirmed. <a href="${link}" target="_blank" rel="noopener">View on Solscan</a>`);
    toast(`Tipped ${c.username || short(c.wallet)}`);
    refreshWallet();
  } catch (e) {
    const msg = e?.message || String(e);
    setStatus(/reject|cancel/i.test(msg) ? "Tip cancelled in your wallet." : esc(msg), true);
    btn.disabled = false;
  }
}

/* ---------- wiring ---------- */

function bindUi() {
  $("#walletBtn").addEventListener("click", () => (state.wallet ? disconnect() : connectWallet()));
  $("#copyCa").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.mint);
      toast("Contract address copied");
    } catch {
      toast("Copy failed. Select the address and copy it manually.");
    }
  });
  $("#thread").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tip]");
    if (b) openTip(b.dataset.tip);
  });
  $("#moreBtn").addEventListener("click", () => loadCallouts({ older: true }));

  const presets = $("#presets");
  for (const amt of SITE.tipPresets) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "preset";
    b.dataset.amount = amt;
    b.textContent = compact.format(Number(amt));
    b.addEventListener("click", () => {
      $("#tipAmount").value = amt;
      syncPresets();
    });
    presets.appendChild(b);
  }
  $("#tipAmount").addEventListener("input", syncPresets);
  $("#tipSend").addEventListener("click", sendTip);
}

function poll(fn, ms) {
  setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
}

(async function init() {
  bindUi();
  await loadConfig();
  renderWallet();
  await Promise.all([loadMarket(), loadCallouts()]);
  if (state.mint) {
    poll(loadMarket, SITE.marketPollMs);
    poll(() => loadCallouts(), SITE.calloutPollMs);
  }
  // Reconnect silently if the wallet already trusts this site.
  const p = getProvider();
  p?.connect?.({ onlyIfTrusted: true })
    .then((res) => {
      if (!(res?.publicKey || p.publicKey)) return;
      state.provider = p;
      state.wallet = (res?.publicKey || p.publicKey).toString();
      refreshWallet();
    })
    .catch(() => {});
})();

import { SITE } from "./config.js";

const $ = (s, r = document) => r.querySelector(s);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  name: SITE.name,
  ticker: SITE.ticker,
  mint: SITE.mint || null,
  market: null,
  calls: [],
  filter: "ALL",
  open: new Set(),
};

/* ---------- formatting ---------- */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const usd = (n) => (n == null || !isFinite(n) ? "—" : "$" + compact.format(n));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pctHtml = (x) =>
  x == null || !isFinite(x) ? "—" : `<span class="${x >= 0 ? "up" : "down"}">${x >= 0 ? "+" : ""}${Math.abs(x) >= 100 ? Math.round(x) : x.toFixed(1)}%</span>`;

// Tiny memecoin prices read better as $0.0₅4123
function priceHtml(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.0001) return "$" + n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
  const [mant, exp] = n.toExponential(3).split("e-");
  return `$0.0<sub>${Number(exp) - 1}</sub>${mant.replace(".", "").replace(/0+$/, "")}`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  } catch {
    toast("Copy failed. Select the text and copy it manually.");
  }
}

/* ---------- GIGAFUNBOT: dancing and talking ---------- */

function gigaLines() {
  const T = `$${state.ticker}`;
  const m = state.market;
  if (!state.mint || !m?.configured) {
    return [
      `Boiler's warming up. ${T} lights the furnace soon.`,
      `Contract address drops at launch. I'm already dancing.`,
      `Stoking the fire for ${T}. Stay close to the pipes.`,
      `Poke me. I've got steam to spare.`,
    ];
  }
  const lines = [
    `Full steam ahead for ${T}!`,
    `Every pipe in this boiler room leads to ${T}.`,
    `I don't sleep. I watch gauges. My favorite one says ${T}.`,
    `Holders keep the furnace lit. Thank you, crew!`,
    `Pressure's building. Hear the pipes rattle? That's ${T}.`,
    `${T} runs on steam, grit and a very happy robot.`,
    `Poke me again. Plenty more bullish where that came from.`,
    `Tag @GIGAFUNBOT in your pump.fun callouts and I'll judge your thesis.`,
    `Paste your wallet below and I'll judge your trading. Gently. Mostly.`,
  ];
  if (m.change24h != null) {
    const x = Math.abs(m.change24h).toFixed(1);
    lines.push(m.change24h >= 0 ? `${T} is up ${x}% today. Needles in the green!` : `Down ${x}% today? That's a refuel stop. Furnace is still lit.`);
  }
  if (m.marketCap) lines.push(`${T} market cap is ${usd(m.marketCap)}. Plenty of room in this boiler.`);
  if (m.buys24h != null && m.sells24h != null && m.buys24h > m.sells24h)
    lines.push(`${compact.format(m.buys24h)} buys vs ${compact.format(m.sells24h)} sells today. The crew is stoking!`);
  if (m.volume24h) lines.push(`${usd(m.volume24h)} of volume through the pipes in 24 hours. Choo choo.`);
  return lines;
}

const gig = { queue: [], lastLine: "", typing: null };

function nextLine() {
  if (!gig.queue.length) gig.queue = gigaLines().sort(() => Math.random() - 0.5);
  let line = gig.queue.pop();
  if (line === gig.lastLine && gig.queue.length) line = gig.queue.pop();
  gig.lastLine = line;
  say(line);
}

function say(text) {
  const q = $("#bubbleText");
  clearInterval(gig.typing);
  if (reducedMotion) return void (q.textContent = text);
  let i = 0;
  q.textContent = "";
  gig.typing = setInterval(() => {
    q.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(gig.typing);
  }, 22);
}

const MOVES = ["move-bob", "move-sway", "move-shimmy", "move-flip"];
function dance(move) {
  const d = $("#dancer");
  d.classList.remove(...MOVES, "move-hop");
  void d.offsetWidth; // restart the animation
  d.classList.add(move || MOVES[Math.floor(Math.random() * MOVES.length)]);
}

function puff() {
  if (reducedMotion) return;
  const stage = $("#stage");
  for (let i = 0; i < 3; i++) {
    const p = document.createElement("span");
    p.className = "puff";
    p.style.right = `${18 + Math.random() * 40}%`;
    p.style.top = `${48 + Math.random() * 18}%`;
    p.style.animationDelay = `${i * 120}ms`;
    stage.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

function startGiga() {
  nextLine();
  if (!reducedMotion) dance("move-bob");
  setInterval(() => !document.hidden && nextLine(), 6500);
  if (!reducedMotion) setInterval(() => !document.hidden && dance(), 3400);
  $("#dancer").addEventListener("click", () => {
    if (!reducedMotion) {
      dance("move-hop");
      setTimeout(() => dance(), 1150);
    }
    puff();
    nextLine();
  });
}

/* ---------- config + $GIGAFUNBOT market ---------- */

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
    /* running without serverless functions; config.js values stay */
  }
  document.querySelectorAll('[data-bind="name"]').forEach((el) => (el.textContent = state.name));
  document.querySelectorAll('[data-bind="ticker"]').forEach((el) => (el.textContent = state.ticker));
  if (state.mint) {
    $("#caText").textContent = state.mint;
    $("#copyCa").hidden = false;
    renderLinks({});
  }
  renderChart([]);
}

function renderLinks(extra) {
  if (!state.mint) return;
  const links = [
    ["Buy on pump.fun", `https://pump.fun/coin/${state.mint}`],
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

async function loadMarket() {
  if (!state.mint) return;
  try {
    const m = await (await fetch("/api/market")).json();
    if (!m.configured) return;
    const first = !state.market;
    state.market = m;
    $("#price").innerHTML = priceHtml(m.price);
    const ch = $("#change");
    if (m.change24h != null) {
      ch.textContent = `${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(2)}% in 24h`;
      ch.className = `change ${m.change24h >= 0 ? "up" : "down"}`;
    } else {
      ch.textContent = m.errors?.coingecko ? "CoinGecko hasn't picked up $" + state.ticker + " yet" : "24h change unavailable";
      ch.className = "change";
    }
    $("#mcap").textContent = usd(m.marketCap);
    $("#vol").textContent = usd(m.volume24h);
    $("#liq").textContent = usd(m.liquidity);
    $("#txns").textContent = m.buys24h != null ? `${compact.format(m.buys24h)} / ${compact.format(m.sells24h ?? 0)}` : "—";
    renderLinks(m.links || {});
    renderChart(m.chart || []);
    if (first) {
      gig.queue = []; // fresh lines with real numbers
      nextLine();
    }
  } catch {
    /* keep the last good readout */
  }
}

function renderChart(points) {
  const el = $("#chart");
  if (points.length < 2) {
    el.innerHTML = `<p class="chart-empty">${state.mint ? "The chart fills in once CoinGecko has trading history." : "The chart lights up at launch."}</p>`;
    return;
  }
  const W = 600, H = 150, P = 6;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || max || 1;
  const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - min) / span) * (H - P * 2);
  let d = `M${x(0).toFixed(1)},${y(ys[0]).toFixed(1)}`;
  for (let i = 1; i < ys.length; i++) d += ` H${x(i).toFixed(1)} V${y(ys[i]).toFixed(1)}`;
  const color = ys[ys.length - 1] >= ys[0] ? "var(--pipe-hi)" : "#ff8a7d";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">
    <path d="${d} V${H} H${x(0)} Z" fill="${color}" opacity="0.13"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------- gauges ---------- */

const GAUGES = {
  pressure: { label: "Pressure", blurb: "Is the price building steam? Rising price, volume picking up speed and buyers in control this hour." },
  flow: { label: "Flow", blurb: "Who's really trading. More unique buyers than sellers, believable turnover and no bot churn." },
  safety: { label: "Safety valve", blurb: "Can the dev still print or freeze? Is the pool deep and old enough? A red valve vetoes the coin." },
  heat: { label: "Heat", blurb: "Is it overheated? Fades coins the crowd already piled into and likes quiet accumulation." },
};

function dial(score, label) {
  const cx = 60, cy = 62, r = 48;
  const pt = (s, rad) => {
    const a = Math.PI * (1 - s / 100);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const arc = (a, b, color) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="9" fill="none"/>`;
  };
  const [nx, ny] = pt(score, r - 10);
  return `<svg class="dial" viewBox="0 0 120 80" role="img" aria-label="${esc(label)} ${score} out of 100">
    <path d="M8 62 A52 52 0 0 1 112 62 Z" fill="var(--cream)" stroke="var(--ink)" stroke-width="3"/>
    ${arc(0, 40, "var(--red)")}${arc(40, 65, "var(--caution)")}${arc(65, 100, "var(--pipe)")}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--ink)" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="var(--rust)" stroke="var(--ink)" stroke-width="2"/>
    <text x="${cx}" y="78" text-anchor="middle" font-family="Pixelify Sans, monospace" font-size="14" font-weight="700" fill="var(--text)">${score}</text>
  </svg>`;
}

function coinImg(c, size = 30) {
  return c.image
    ? `<img src="${esc(c.image)}" alt="" width="${size}" height="${size}" loading="lazy" />`
    : `<span class="coin-ph" aria-hidden="true"></span>`;
}

function dialsHtml(call) {
  return `<div class="dials">${call.gauges
    .map(
      (g) => `<div class="dial-box">
        ${dial(g.score, GAUGES[g.gauge].label)}
        <h4>${GAUGES[g.gauge].label} <span class="chip ${g.signal}">${g.signal}</span></h4>
        <ul>${g.why.map((w) => `<li>${esc(w)}</li>`).join("") || "<li>No strong reading either way.</li>"}</ul>
      </div>`
    )
    .join("")}</div>`;
}

function coinLinks(c) {
  const a = esc(c.address);
  return `<div class="detail-links">
    ${/pump$/.test(c.address) ? `<a href="https://pump.fun/coin/${a}" target="_blank" rel="noopener">pump.fun</a>` : ""}
    <a href="https://www.geckoterminal.com/solana/tokens/${a}" target="_blank" rel="noopener">Chart</a>
    <a href="https://solscan.io/token/${a}" target="_blank" rel="noopener">Solscan</a>
    <button class="btn btn-small" type="button" data-copy="${a}">Copy CA</button>
  </div>`;
}

/* ---------- the board ---------- */

async function loadBoard() {
  try {
    const r = await fetch("/api/board");
    const d = await r.json();
    if (!r.ok || !d.calls?.length) throw new Error(d.error || "empty");
    state.calls = d.calls;
    const counts = { BUY: 0, WATCH: 0, AVOID: 0 };
    d.calls.forEach((c) => counts[c.verdict]++);
    $("#boardSub").textContent = `${d.calls.length} trending Solana coins, read on four gauges. Updated ${new Date(d.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    document.querySelectorAll(".filter").forEach((b) => {
      const f = b.dataset.f;
      b.textContent = f === "ALL" ? "All" : `${f[0] + f.slice(1).toLowerCase()} (${counts[f]})`;
    });
    renderBoard();
    renderGaugeCards();
  } catch (e) {
    if (!state.calls.length)
      $("#boardBody").innerHTML = `<tr><td colspan="10" class="empty">The board couldn't load. Check that COINGECKO_API_KEY is set in Vercel. Retrying in a minute.</td></tr>`;
  }
}

function renderBoard() {
  const rows = state.calls.filter((c) => state.filter === "ALL" || c.verdict === state.filter);
  if (!rows.length) {
    $("#boardBody").innerHTML = `<tr><td colspan="10" class="empty">No ${state.filter.toLowerCase()} calls right now.</td></tr>`;
    return;
  }
  $("#boardBody").innerHTML = rows
    .map((call) => {
      const c = call.coin;
      const open = state.open.has(c.address);
      const gauge = (g) => `<td><span class="chip ${g.signal}">${g.signal} <small>${g.score}</small></span></td>`;
      const note = call.vetoed ? "valve shut" : `${call.buyCount}/4 green`;
      return `<tr class="row">
          <td><button class="coin-btn" type="button" data-open="${esc(c.address)}" aria-expanded="${open}">
            ${coinImg(c)}<span><span class="coin-sym">$${esc(c.symbol)}</span><br><span class="coin-more">${open ? "Hide reasoning" : "See reasoning"}</span></span>
          </button></td>
          <td class="num">${priceHtml(c.price)}</td>
          <td class="num">${pctHtml(c.change.h1)}</td>
          <td class="num">${pctHtml(c.change.h24)}</td>
          <td class="num">${usd(c.liquidity)}</td>
          ${call.gauges.map(gauge).join("")}
          <td><div class="call-cell"><span class="chip big ${call.verdict}">${call.verdict}</span><span class="muted">${note}</span></div></td>
        </tr>
        ${open ? `<tr class="detail"><td colspan="10"><p class="detail-summary">${esc(call.summary)}</p>${dialsHtml(call)}${coinLinks(c)}</td></tr>` : ""}`;
    })
    .join("");
}

function renderGaugeCards() {
  $("#gaugeCards").innerHTML = Object.entries(GAUGES)
    .map(([key, g]) => {
      const best = state.calls
        .map((call) => ({ call, gauge: call.gauges.find((x) => x.gauge === key) }))
        .sort((a, b) => b.gauge.score - a.gauge.score)[0];
      return `<article class="gauge-card plate">
        ${dial(best ? best.gauge.score : 50, g.label)}
        <h3>${g.label}</h3>
        <p>${g.blurb}</p>
        <div class="best">${best ? `<span>Highest reading today<br><strong>$${esc(best.call.coin.symbol)}</strong></span><span class="chip ${best.gauge.signal}">${best.gauge.signal}</span>` : "<span>Waiting for today's board</span>"}</div>
      </article>`;
    })
    .join("");
}

/* ---------- Ask the bot ---------- */

function quip(call) {
  if (state.mint && call.coin.address === state.mint)
    return `That's me! Obviously I'm bullish: full steam on $${state.ticker}. Here are the honest gauges anyway.`;
  if (call.vetoed) return "Safety valve's shut on this one. I'm not touching it.";
  if (call.verdict === "BUY") return `${call.buyCount} of 4 gauges in the green. This one's worth a close look.`;
  if (call.verdict === "AVOID") return "Too many red needles. Hard pass from the boiler room.";
  return "Mixed readings. I'd watch this one from the catwalk.";
}

async function ask(e) {
  e.preventDefault();
  const q = $("#askQ").value.trim();
  const out = $("#askResult");
  if (!q) {
    out.innerHTML = `<p class="ask-error">Enter a ticker, name or token address.</p>`;
    return;
  }
  const btn = $("#askBtn");
  btn.disabled = true;
  btn.textContent = "Reading…";
  try {
    const r = await fetch(`/api/ask?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `${state.name} couldn't read that coin.`);
    const call = d.call, c = call.coin;
    out.innerHTML = `<div class="ask-card">
      <div class="ask-head">${coinImg(c, 40)}
        <div><h3>$${esc(c.symbol)}</h3><div class="meta">${c.name ? `<span>${esc(c.name)}</span>` : ""}<span>${priceHtml(c.price)}</span><span>${usd(c.liquidity)} liquidity</span><span>${usd(c.marketCap)} market cap</span></div></div>
        <span class="chip big ${call.verdict}">${call.verdict}</span>
      </div>
      <div class="giga-says"><img src="/assets/favicon.png" alt="" width="40" height="40" /><p>${esc(quip(call))}</p></div>
      ${dialsHtml(call)}
      ${coinLinks(c)}
    </div>`;
  } catch (err) {
    out.innerHTML = `<p class="ask-error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Read the gauges";
  }
}

/* ---------- Judge my wallet ---------- */

function fmtHold(min) {
  if (min == null) return "—";
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 1440) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} days`;
}

async function judge(e) {
  e.preventDefault();
  const q = $("#judgeQ").value.trim();
  const out = $("#judgeResult");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
    out.innerHTML = `<p class="ask-error">Paste a full Solana wallet address (32 to 44 characters).</p>`;
    return;
  }
  const btn = $("#judgeBtn");
  btn.disabled = true;
  btn.textContent = "Reading the chain…";
  try {
    const r = await fetch(`/api/wallet?address=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Couldn't read that wallet.");
    const s = d.stats;
    const T = `$${state.ticker}`;
    const pnl = s.realizedSol;
    const pnlText = pnl == null || !s.closedPositions ? "—" : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)} SOL`;
    const pnlUsd = pnl != null && s.closedPositions && s.solUsd ? ` (${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl * s.solUsd))})` : "";
    const holder =
      d.holdsBotToken === true ? `${T} holder spotted. Instant respect. The furnace salutes you.`
      : d.holdsBotToken === false ? `Zero ${T} in this wallet. Honestly? That's the real red flag.`
      : "";
    out.innerHTML = `<div class="verdict-card">
      <div>${dial(d.rating, "Trader rating")}<p class="rating-label">Trader rating</p></div>
      <div>
        <p class="verdict-type">${esc(d.type)}</p>
        <div class="giga-says"><img src="/assets/favicon.png" alt="" width="40" height="40" /><p>${esc(d.roast)}</p></div>
      </div>
      ${s.trades ? `<dl class="wallet-stats">
        <div><dt>Trades</dt><dd>${s.trades} <small>(${s.buys} buys / ${s.sells} sells)</small></dd></div>
        <div><dt>Win rate</dt><dd>${s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%"}</dd></div>
        <div><dt>Realized P&amp;L</dt><dd class="${pnl >= 0 ? "up" : "down"}">${pnlText}<small>${esc(pnlUsd)}</small></dd></div>
        <div><dt>Median hold</dt><dd>${fmtHold(s.medianHoldMin)}</dd></div>
        <div><dt>Coins traded</dt><dd>${s.tokensTraded}</dd></div>
        <div><dt>Still holding</dt><dd>${s.openBags}</dd></div>
        <div><dt>Trades per day</dt><dd>${s.tradesPerDay.toFixed(1)}</dd></div>
        <div><dt>Average buy</dt><dd>${s.avgBuySol == null ? "—" : s.avgBuySol.toFixed(2) + " SOL"}</dd></div>
      </dl>` : ""}
      ${d.notes?.length ? `<ul class="wallet-notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${holder ? `<p class="holder-line">${esc(holder)}</p>` : ""}
      <p class="fine">Based on this wallet's last ${s.txScanned} transactions, read from on-chain balance changes. Realized P&amp;L only counts coins that were sold. For fun, not financial advice.</p>
    </div>`;
  } catch (err) {
    out.innerHTML = `<p class="ask-error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Judge it";
  }
}

/* ---------- wiring ---------- */

function bindUi() {
  $("#copyCa").addEventListener("click", () => copy(state.mint, "Contract address"));
  $("#askForm").addEventListener("submit", ask);
  $("#judgeForm").addEventListener("submit", judge);
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest(".filter");
    if (!b) return;
    state.filter = b.dataset.f;
    document.querySelectorAll(".filter").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderBoard();
  });
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o) {
      const a = o.dataset.open;
      state.open.has(a) ? state.open.delete(a) : state.open.add(a);
      renderBoard();
      return;
    }
    const c = e.target.closest("[data-copy]");
    if (c) copy(c.dataset.copy, "Contract address");
  });
}

function poll(fn, ms) {
  setInterval(() => !document.hidden && fn(), ms);
}

(async function init() {
  bindUi();
  await loadConfig();
  startGiga();
  await Promise.all([loadMarket(), loadBoard()]);
  poll(loadMarket, SITE.marketPollMs);
  poll(loadBoard, SITE.boardPollMs);
})();

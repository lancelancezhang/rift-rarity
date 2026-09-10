/**
 * Rift Rarity - Krillion-style League dive MVP
 * Shared settings: config.json
 * Daily prompts: packs/YYYY-MM-DD.json (falls back to packs/default.json)
 */

const CONFIG_URL = "config.json";
const PACKS_DIR = "packs";

/** @type {Record<string, {label: string, points: number, note: string}>} */
let TIERS = {};
/** @type {Array<{id: string, text: string, answers: Record<string, string>}>} */
let PROMPTS = [];
let ROUND_SECONDS = 25;
let PREVIEW_SECONDS = 3;
let METERS_PER_POINT = 10;
let SHARE_URL = "https://rift-rarity.vercel.app";
let PROMPT_COUNT = 0;
let MAX_METERS = 5000;
let ACTIVE_PACK = "";


const state = {
  index: 0,
  score: 0,
  meters: 0,
  results: [],
  timerId: null,
  previewId: null,
  endsAt: 0,
  accepting: false,
  ready: false,
};

const $ = (id) => document.getElementById(id);

const panels = {
  start: $("screen-start"),
  preview: $("screen-preview"),
  play: $("screen-play"),
  reveal: $("screen-reveal"),
  results: $("screen-results"),
};

function show(name) {
  Object.entries(panels).forEach(([key, el]) => {
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("active", on);
    if (on) {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
  });
  document.body.classList.toggle(
    "is-playing",
    name === "play" || name === "preview" || name === "reveal"
  );
  if (name === "results") window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearTimers() {
  if (state.timerId) {
    cancelAnimationFrame(state.timerId);
    state.timerId = null;
  }
  if (state.previewId) {
    clearInterval(state.previewId);
    state.previewId = null;
  }
}

function normalize(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\s-]/g, "")
    .replace(/\s+/g, " ");
}

function displayName(canonical) {
  const specials = {
    faker: "Faker",
    zeus: "Zeus",
    oner: "Oner",
    gumayusi: "Gumayusi",
    guma: "Guma",
    keria: "Keria",
    doran: "Doran",
    kkoma: "kkOma",
    "kko ma": "kkOma",
    bengi: "Bengi",
    bang: "Bang",
    wolf: "Wolf",
    peanut: "Peanut",
    blank: "Blank",
    duke: "Duke",
    easyhoon: "Easyhoon",
    teddy: "Teddy",
    clid: "Clid",
    cuzz: "Cuzz",
    khan: "Khan",
    effort: "Effort",
    impact: "Impact",
    piglet: "Piglet",
    untara: "Untara",
    thal: "Thal",
    lustboy: "Lustboy",
    marin: "Marin",
    sky: "Sky",
    tom: "Tom",
    huni: "Huni",
    tf: "TF",
    gp: "GP",
    mf: "MF",
  };
  if (specials[canonical]) return specials[canonical];
  return canonical
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Deduped catalog entries, rarest first. */
function uniqueAnswers(prompt) {
  const seen = new Map();
  for (const [alias, tierId] of Object.entries(prompt.answers)) {
    const stem = alias.replace(/['\s-]/g, "");
    const key = `${tierId}::${stem}`;
    const prev = seen.get(key);
    if (!prev || alias.length < prev.alias.length) {
      seen.set(key, { alias, tierId, points: TIERS[tierId].points });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias))
    .map((row) => ({
      name: displayName(row.alias),
      tierId: row.tierId,
      tierLabel: TIERS[row.tierId].label,
      points: row.points,
      key: normalize(row.alias),
    }));
}

function scoreAnswer(prompt, raw) {
  const key = normalize(raw);
  if (!key) return null;

  const tierId = prompt.answers[key];
  if (!tierId) {
    return { valid: false, key, display: raw.trim() };
  }

  const tier = TIERS[tierId];
  return {
    valid: true,
    timedOut: false,
    key,
    display: displayName(key),
    points: tier.points,
    meters: tier.points * METERS_PER_POINT,
    tierLabel: tier.label,
    note: tier.note,
  };
}

function timeoutResult() {
  return {
    valid: false,
    timedOut: true,
    key: "",
    display: "-",
    points: 0,
    meters: 0,
    tierLabel: "Timed out",
    note: "The 25-second window closed. No depth this round.",
  };
}

function zoneForMeters(m) {
  if (m >= 4000) return "trench";
  if (m >= 3000) return "abyss";
  if (m >= 1600) return "midnight";
  if (m >= 600) return "twilight";
  return "surface";
}

function zoneLabel(zone) {
  return (
    {
      surface: "Sunlight zone",
      twilight: "Twilight zone",
      midnight: "Midnight zone",
      abyss: "Abyssal zone",
      trench: "Trench floor",
    }[zone] || zone
  );
}

function setDepth(meters, { animate = true } = {}) {
  const pct = Math.min(100, (meters / MAX_METERS) * 100);
  const root = document.documentElement;

  if (!animate) {
    const prev = getComputedStyle(root).getPropertyValue("--sink-duration");
    root.style.setProperty("--sink-duration", "0ms");
    root.style.setProperty("--depth-pct", `${pct}%`);
    root.style.setProperty("--depth-progress", String(pct / 100));
    void root.offsetWidth;
    root.style.setProperty("--sink-duration", prev.trim() || "1.4s");
  } else {
    root.style.setProperty("--depth-pct", `${pct}%`);
    root.style.setProperty("--depth-progress", String(pct / 100));
  }

  $("hud-meters").textContent = `${Math.round(meters)} m`;
  document.body.dataset.zone = zoneForMeters(meters);
}

function spawnBubbles() {
  const host = $("bubbles");
  host.innerHTML = "";
  for (let i = 0; i < 14; i++) {
    const b = document.createElement("span");
    b.className = "bubble";
    const size = 4 + Math.random() * 10;
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left = `${Math.random() * 100}%`;
    b.style.animationDuration = `${6 + Math.random() * 10}s`;
    b.style.animationDelay = `${Math.random() * 8}s`;
    host.appendChild(b);
  }
}

function flashSink() {
  const diver = $("diver");
  diver.classList.remove("sinking");
  void diver.offsetWidth;
  diver.classList.add("sinking");
  setTimeout(() => diver.classList.remove("sinking"), 950);
}

function hideMiss() {
  $("miss-feedback").hidden = true;
  $("answer-input").classList.remove("shake");
}

function showMiss() {
  const input = $("answer-input");
  $("miss-feedback").hidden = false;
  input.classList.remove("shake");
  void input.offsetWidth;
  input.classList.add("shake");
  input.select();
}

function resetGame() {
  clearTimers();
  state.index = 0;
  state.score = 0;
  state.meters = 0;
  state.results = [];
  state.accepting = false;
  setDepth(0, { animate: false });
  $("hud-round").textContent = `- / ${PROMPT_COUNT}`;
  hideMiss();
}

function startPreview() {
  clearTimers();
  state.accepting = false;
  hideMiss();
  const prompt = PROMPTS[state.index];
  $("preview-round").textContent = `Prompt ${state.index + 1} / ${PROMPT_COUNT}`;
  $("preview-text").textContent = prompt.text;
  $("hud-round").textContent = `${state.index + 1} / ${PROMPT_COUNT}`;

  let left = PREVIEW_SECONDS;
  $("preview-count").textContent = String(left);
  show("preview");

  state.previewId = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(state.previewId);
      state.previewId = null;
      startRound();
      return;
    }
    $("preview-count").textContent = String(left);
  }, 1000);
}

function startRound() {
  clearTimers();
  hideMiss();
  $("prompt-text").textContent = PROMPTS[state.index].text;
  $("answer-input").value = "";
  $("timer-num").textContent = String(ROUND_SECONDS);
  document.documentElement.style.setProperty("--timer-progress", "1");
  $("timer-wrap").classList.remove("urgent");

  state.accepting = true;
  state.endsAt = performance.now() + ROUND_SECONDS * 1000;
  show("play");
  requestAnimationFrame(() => $("answer-input").focus());

  const tick = (now) => {
    const remaining = Math.max(0, state.endsAt - now);
    const secs = Math.ceil(remaining / 1000);
    const progress = remaining / (ROUND_SECONDS * 1000);

    $("timer-num").textContent = String(secs);
    document.documentElement.style.setProperty("--timer-progress", String(progress));
    $("timer-wrap").classList.toggle("urgent", secs <= 5);

    if (remaining <= 0) {
      state.timerId = null;
      if (state.accepting) lockIn(timeoutResult());
      return;
    }
    state.timerId = requestAnimationFrame(tick);
  };
  state.timerId = requestAnimationFrame(tick);
}

function lockIn(result) {
  if (!state.accepting) return;
  state.accepting = false;
  clearTimers();
  hideMiss();

  state.score += result.points;
  state.meters += result.meters;
  state.results.push(result);

  const kicker = $("reveal-kicker");
  if (result.timedOut) {
    kicker.textContent = "Time’s up";
    kicker.className = "reveal-kicker miss";
  } else {
    kicker.textContent = "Accepted";
    kicker.className = "reveal-kicker ok";
  }

  $("reveal-answer").textContent = result.display;
  $("reveal-tier").textContent = result.tierLabel;
  $("reveal-depth").textContent = result.meters ? `↓ ${result.meters} m` : "↓ 0 m";
  $("reveal-note").textContent = result.note;
  $("btn-next").textContent =
    state.index >= PROMPT_COUNT - 1 ? "See final depth" : "Keep diving";

  show("reveal");

  if (result.meters > 0) {
    flashSink();
    setDepth(state.meters);
  } else {
    $("hud-meters").textContent = `${Math.round(state.meters)} m`;
  }
}

function isHit(yours, ans, prompt) {
  if (!yours?.valid) return false;
  const yourStem = normalize(yours.display).replace(/['\s-]/g, "");
  const ansStem = normalize(ans.name).replace(/['\s-]/g, "");
  return (
    yours.key === ans.key ||
    yourStem === ansStem ||
    (prompt.answers[yours.key] &&
      normalize(yours.key).replace(/['\s-]/g, "") === ansStem)
  );
}

function renderCatalog() {
  const host = $("answer-catalog");
  host.innerHTML = "";

  PROMPTS.forEach((prompt, i) => {
    const yours = state.results[i];
    const answers = uniqueAnswers(prompt);

    const details = document.createElement("details");
    details.className = "catalog-details";

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="cat-title">${i + 1}. Name ${prompt.text}</span>
      <span class="cat-meta">${answers.length} answers</span>
    `;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "catalog-list";

    answers.forEach((ans) => {
      const hit = isHit(yours, ans, prompt);
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="ans${hit ? " you-hit" : ""}">${ans.name}</span>
        <span class="lvl">${ans.tierLabel}</span>
      `;
      ul.appendChild(li);
    });

    details.appendChild(ul);
    host.appendChild(details);
  });
}

function buildShareText() {
  const lines = [`Rift Rarity - ${Math.round(state.meters)} m`, ""];

  state.results.forEach((r, i) => {
    const depth = r.meters ? `${r.meters} m` : "0 m";
    const tier = r.timedOut ? "Timed out" : r.tierLabel;
    lines.push(`${i + 1}. ${tier} · ${depth}`);
  });

  lines.push("", `See if you can beat me: ${SHARE_URL}`);
  return lines.join("\n");
}

function setShareStatus(msg) {
  const el = $("share-status");
  el.hidden = !msg;
  el.textContent = msg || "";
}

async function copyShareText() {
  const text = $("share-text").textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setShareStatus("Copied. Answers hidden.");
      return;
    }
  } catch {
    /* fall through */
  }

  // Fallback select
  const range = document.createRange();
  range.selectNodeContents($("share-text"));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  setShareStatus("Selected. Copy with ⌘C / Ctrl+C.");
}

function renderResults() {
  $("total-meters").textContent = `${Math.round(state.meters)} m`;
  $("total-points").textContent = zoneLabel(zoneForMeters(state.meters));
  $("results-zone").textContent = "Dive complete";

  const list = $("breakdown");
  list.innerHTML = "";
  state.results.forEach((r, i) => {
    const li = document.createElement("li");
    const tier = r.timedOut ? "Timed out" : r.tierLabel;
    li.innerHTML = `
      <span class="bd-prompt">${i + 1}. ${PROMPTS[i].text}</span>
      <span class="bd-pts">${r.meters ? r.meters + " m" : "0 m"}</span>
      <span class="bd-answer">${r.display} · ${tier}</span>
    `;
    list.appendChild(li);
  });

  $("share-text").textContent = buildShareText();
  renderCatalog();
  setShareStatus("");
  show("results");
}

$("btn-start").addEventListener("click", () => {
  if (!state.ready) return;
  resetGame();
  startPreview();
});

$("btn-replay").addEventListener("click", () => {
  resetGame();
  startPreview();
});

$("answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.accepting) return;

  const result = scoreAnswer(PROMPTS[state.index], $("answer-input").value);
  if (!result) return;

  if (!result.valid) {
    showMiss();
    return;
  }

  lockIn(result);
});

$("answer-input").addEventListener("input", () => {
  if (!$("miss-feedback").hidden) hideMiss();
});

$("btn-next").addEventListener("click", () => {
  if (state.index >= PROMPT_COUNT - 1) {
    renderResults();
    return;
  }
  state.index += 1;
  startPreview();
});

$("btn-share").addEventListener("click", () => {
  copyShareText();
});

function maxTierPoints() {
  return Math.max(0, ...Object.values(TIERS).map((t) => t.points));
}

function applyPackMeta() {
  PROMPT_COUNT = PROMPTS.length;
  MAX_METERS = maxTierPoints() * PROMPT_COUNT * METERS_PER_POINT;

  const eyebrow = document.querySelector("#screen-start .eyebrow");
  if (eyebrow) eyebrow.remove();
  $("hud-round").textContent = `- / ${PROMPT_COUNT}`;
  $("btn-start").disabled = false;
  $("btn-start").textContent = "Begin dive";
  state.ready = true;
}

function showLoadError(err) {
  const lede = document.querySelector("#screen-start .lede");
  $("btn-start").disabled = true;
  if (lede) {
    lede.innerHTML = `
      Couldn’t load today’s pack.
      Serve the folder over HTTP (not a raw file open), e.g.
      <code>python3 -m http.server 8080</code>
      then open <code>http://localhost:8080</code>.
      <br /><br /><span style="opacity:.7">${String(err?.message || err)}</span>
    `;
  }
  console.error(err);
}

/** Local calendar date as YYYY-MM-DD */
function todayKey(timezone = "local") {
  if (timezone && timezone !== "local") {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      /* fall through */
    }
  }
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return res.json();
}

/**
 * Accepts either:
 *   { "jinx": "bronze", "ashe": "bronze" }           // flat (old)
 *   { "bronze": ["jinx", "ashe"], "silver": [...] } // grouped (preferred)
 * Order never matters for scoring.
 */
function normalizeAnswers(raw, tiers) {
  if (!raw || typeof raw !== "object") return {};
  const flat = {};
  const tierIds = new Set(Object.keys(tiers || {}));

  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      // grouped by tier: "bronze": ["jinx", "ashe"]
      if (!tierIds.has(key)) {
        console.warn(`Unknown tier "${key}" in answers; skipping`);
        continue;
      }
      value.forEach((name) => {
        const n = normalize(String(name));
        if (n) flat[n] = key;
      });
    } else if (typeof value === "string") {
      // flat: "jinx": "bronze"
      const n = normalize(key);
      if (n) flat[n] = value;
    }
  }
  return flat;
}

function normalizePrompts(prompts, tiers) {
  return prompts.map((p) => ({
    ...p,
    answers: normalizeAnswers(p.answers, tiers),
  }));
}

async function loadData() {
  $("btn-start").disabled = true;

  const config = await fetchJson(CONFIG_URL);
  if (!config.tiers) throw new Error("config.json needs a tiers object");

  const date = todayKey(config.timezone || "local");
  let pack;
  let packLabel = date;

  try {
    pack = await fetchJson(`${PACKS_DIR}/${date}.json`);
  } catch {
    pack = await fetchJson(`${PACKS_DIR}/default.json`);
    packLabel = "default";
  }

  if (!Array.isArray(pack.prompts) || pack.prompts.length === 0) {
    throw new Error(`Pack ${packLabel} needs a non-empty prompts array`);
  }

  TIERS = config.tiers;
  PROMPTS = normalizePrompts(pack.prompts, TIERS);
  ROUND_SECONDS = config.roundSeconds ?? 25;
  PREVIEW_SECONDS = config.previewSeconds ?? 3;
  METERS_PER_POINT = config.metersPerPoint ?? 10;
  SHARE_URL = config.shareUrl ?? SHARE_URL;
  ACTIVE_PACK = pack.date || packLabel;
  applyPackMeta();
}

spawnBubbles();
setDepth(0, { animate: false });

loadData().catch(showLoadError);

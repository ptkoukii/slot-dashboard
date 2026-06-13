"use strict";

const RANK_ORDER = { S: 0, A: 1, B: 2, C: 3, "・": 9 };
const WD = ["日", "月", "火", "水", "木", "金", "土"];

let SCHEDULES = [];
let BIRTHDAYS = [];
let state = { view: "schedule", date: "", search: "", area: "", rank: "", event: "", sort: "date" };

// ---------- ユーティリティ ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
function wdClass(wd) {
  if (wd === "土") return "wd-sat";
  if (wd === "日") return "wd-sun";
  return "";
}
function wardOf(address) {
  if (!address) return null;
  const m = address.match(/(?:東京都)?(.+?[区市町村])/);
  return m ? m[1] : null;
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function bestRank(events) {
  let best = 99;
  for (const e of events) best = Math.min(best, RANK_ORDER[e.rank] ?? 99);
  return best;
}

// ---------- データ読み込み ----------
async function load() {
  try {
    const [sRes, bRes] = await Promise.all([
      fetch("data/schedule_1.json", { cache: "no-store" }),
      fetch("data/character_birthdays.json", { cache: "no-store" }).catch(() => null),
    ]);
    const sData = await sRes.json();
    SCHEDULES = sData.schedules || [];
    if (bRes && bRes.ok) {
      const bData = await bRes.json();
      BIRTHDAYS = bData.birthdays || [];
    }
    const dt = sData.fetched_at ? new Date(sData.fetched_at) : null;
    $("#updated").textContent = dt
      ? `最終更新 ${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}　公開 ${SCHEDULES.length} 件`
      : `公開 ${SCHEDULES.length} 件`;
  } catch (e) {
    $("#updated").textContent = "データの読み込みに失敗しました";
    console.error(e);
  }
  buildDateChips();
  buildAreaOptions();
  render();
}

// ---------- フィルタ UI 構築 ----------
function buildDateChips() {
  const today = new Date();
  const chips = [`<button class="chip is-active" data-date="">すべて</button>`];
  for (let i = 0; i < 8; i++) {
    const d = addDays(today, i);
    const key = ymd(d);
    const wd = WD[d.getDay()];
    const label = i === 0 ? "今日" : i === 1 ? "明日" : `${d.getMonth() + 1}/${d.getDate()}`;
    chips.push(
      `<button class="chip" data-date="${key}">${label}<span class="${wdClass(wd)}">(${wd})</span></button>`
    );
  }
  $("#date-chips").innerHTML = chips.join("");
  $$("#date-chips .chip").forEach((c) =>
    c.addEventListener("click", () => {
      state.date = c.dataset.date;
      $$("#date-chips .chip").forEach((x) => x.classList.remove("is-active"));
      c.classList.add("is-active");
      render();
    })
  );
}

function buildAreaOptions() {
  const wards = new Set();
  for (const s of SCHEDULES) {
    const w = wardOf(s.address);
    if (w) wards.add(w);
  }
  const sel = $("#filter-area");
  Array.from(wards).sort((a, b) => a.localeCompare(b, "ja")).forEach((w) => {
    const o = document.createElement("option");
    o.value = w;
    o.textContent = w;
    sel.appendChild(o);
  });
}

// ---------- 描画 ----------
function filteredSchedules() {
  const today = ymd(new Date());
  const weekAhead = ymd(addDays(new Date(), 7));
  return SCHEDULES.filter((s) => {
    // 既定では今日〜1週間のみ
    if (s.date) {
      if (s.date < today || s.date > weekAhead) return false;
    }
    if (state.date && s.date !== state.date) return false;
    if (state.search && !s.hall.includes(state.search)) return false;
    if (state.area && wardOf(s.address) !== state.area) return false;
    if (state.rank && !s.events.some((e) => e.rank === state.rank)) return false;
    if (state.event && !s.events.some((e) => (e.name || "").includes(state.event))) return false;
    return true;
  }).sort((a, b) => {
    if (state.sort === "score") return (b.score || 0) - (a.score || 0);
    if ((a.date || "") !== (b.date || "")) return (a.date || "").localeCompare(b.date || "");
    if (bestRank(a.events) !== bestRank(b.events)) return bestRank(a.events) - bestRank(b.events);
    return (b.score || 0) - (a.score || 0);
  });
}

function eventHtml(events, hitKeywords) {
  return events
    .map((e) => {
      const rk = e.rank && RANK_ORDER[e.rank] !== undefined && e.rank !== "・"
        ? `rank-${e.rank}` : "rank-dot";
      const label = e.rank === "・" || !e.rank ? "–" : e.rank;
      const hit = hitKeywords && hitKeywords.some((k) => k && (e.name || "").includes(k));
      return `<div class="event ${hit ? "is-hit" : ""}">
        <span class="rank ${rk}">${escapeHtml(label)}</span>
        <span class="event-name">${escapeHtml(e.name)}</span></div>`;
    })
    .join("");
}

function cardHtml(s, hitKeywords) {
  const wd = s.weekday || "";
  const dateStr = s.date
    ? `${s.date.slice(5).replace("-", "/")} <span class="${wdClass(wd)}">(${wd})</span>`
    : "";
  const meta = [s.station ? `${s.station}` : null, wardOf(s.address)].filter(Boolean).join(" ／ ");
  const open = s.hall_url ? ` href="${s.hall_url}" target="_blank" rel="noopener"` : "";
  return `<a class="card"${open}>
    <div class="card-top">
      <span class="card-hall">${escapeHtml(s.hall)}</span>
      ${s.score != null ? `<span class="card-score">${s.score}点</span>` : ""}
    </div>
    <div class="card-date">${dateStr}</div>
    ${meta ? `<div class="card-meta">${escapeHtml(meta)}</div>` : ""}
    <div class="events">${eventHtml(s.events, hitKeywords)}</div>
  </a>`;
}

function renderSchedule() {
  const list = filteredSchedules();
  $("#result-count").textContent = `${list.length} 件`;
  $("#schedule-list").innerHTML = list.length
    ? list.map((s) => cardHtml(s)).join("")
    : `<p class="empty">該当するスケジュールがありません</p>`;
}

function renderBirthday() {
  const today = new Date();
  const blocks = [];
  for (let i = 0; i < 8; i++) {
    const d = addDays(today, i);
    const key = ymd(d);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const wd = WD[d.getDay()];
    const todays = BIRTHDAYS.filter((b) => b.month === m && b.day === day);
    if (!todays.length) continue;

    const dateLabel = i === 0 ? "今日" : i === 1 ? "明日" : `${m}/${day}`;
    let html = `<div class="bday-day">🎂 ${dateLabel} <span class="${wdClass(wd)}">(${wd})</span></div>`;

    for (const b of todays) {
      const kws = (b.machine_keywords || []).concat(b.machine ? [b.machine] : []);
      // その日の狙い目ホール（取材名にキーワード一致を優先、無ければ高ランク上位）
      const sameDay = SCHEDULES.filter((s) => s.date === key);
      const hits = sameDay.filter((s) => s.events.some((e) => kws.some((k) => k && (e.name || "").includes(k))));
      const ranked = (hits.length ? hits : sameDay)
        .slice()
        .sort((a, b2) => {
          if (bestRank(a.events) !== bestRank(b2.events)) return bestRank(a.events) - bestRank(b2.events);
          return (b2.score || 0) - (a.score || 0);
        })
        .slice(0, 5);

      html += `<div class="bday-char">
        <div class="name">${escapeHtml(b.name)}</div>
        ${b.machine ? `<div class="machine">${escapeHtml(b.machine)}</div>` : ""}
      </div>`;
      html += `<p class="result-count">${hits.length ? "機種関連の取材あり" : "この日の高ランク取材ホール"}</p>`;
      html += ranked.length
        ? ranked.map((s) => cardHtml(s, kws)).join("")
        : `<p class="empty">この日の公開取材データがありません</p>`;
    }
    blocks.push(html);
  }
  $("#birthday-list").innerHTML = blocks.length
    ? blocks.join("")
    : `<p class="empty">今日〜1週間に登録されたキャラ誕生日はありません。<br>data/character_birthdays.json を編集して追加できます。</p>`;
}

function render() {
  if (state.view === "schedule") renderSchedule();
  else renderBirthday();
}

// ---------- イベント ----------
function bindEvents() {
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      state.view = t.dataset.view;
      $$(".tab").forEach((x) => x.classList.toggle("is-active", x === t));
      $("#view-schedule").classList.toggle("is-active", state.view === "schedule");
      $("#view-birthday").classList.toggle("is-active", state.view === "birthday");
      render();
    })
  );
  $("#search").addEventListener("input", (e) => { state.search = e.target.value.trim(); render(); });
  $("#filter-event").addEventListener("input", (e) => { state.event = e.target.value.trim(); render(); });
  $("#filter-area").addEventListener("change", (e) => { state.area = e.target.value; render(); });
  $("#filter-rank").addEventListener("change", (e) => { state.rank = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
}

bindEvents();
load();

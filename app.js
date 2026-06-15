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
  for (let i = 0; i < 365; i++) {
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
  for (let i = 0; i < 365; i++) {
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
      $("#view-analyze").classList.toggle("is-active", state.view === "analyze");
      if (state.view === "analyze") renderAnalyze();
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

// ---------- 台判別AI ----------
function renderAnalyze() {
  const root = $("#analyze-root");
  if (root.innerHTML) return;
  root.innerHTML = `
    <div style="padding:1rem;max-width:480px;margin:0 auto">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:1rem;margin-bottom:1rem">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px">Anthropic APIキー</div>
        <input type="password" id="ai-api-key" placeholder="sk-ant-..." style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;color:#f1f5f9;font-size:13px">
        <span style="font-size:11px;color:#f59e0b;cursor:pointer;margin-top:6px;display:inline-block" onclick="var i=document.getElementById('ai-api-key');i.type=i.type==='password'?'text':'password'">表示/非表示</span>
      </div>
      <div style="background:#1e2d1a;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:10px 12px;font-size:12px;color:#94a3b8;margin-bottom:1rem">💡 筐体・データ画面・グラフなど複数枚送ると精度UP！</div>
      <div id="ai-upload" style="background:#1e293b;border:2px dashed #334155;border-radius:16px;padding:2rem 1rem;text-align:center;cursor:pointer;position:relative;margin-bottom:1rem">
        <input type="file" accept="image/*" multiple onchange="aiHandleFiles(this.files)" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">
        <div style="font-size:40px;margin-bottom:12px">📷</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">写真を選択 / 撮影</div>
        <div style="font-size:12px;color:#94a3b8">筐体・データ画面・グラフ画面など</div>
      </div>
      <div id="ai-preview"></div>
      <button id="ai-btn" onclick="aiAnalyze()" disabled style="width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#c45c2a,#f59e0b);color:#000;margin-bottom:8px;opacity:0.4">AI判別スタート 🔍</button>
      <div id="ai-result"></div>
    </div>`;
}

let aiImages = [];

addClaudeButton();

function aiHandleFiles(files) {
  Array.from(files).forEach(file => {
    const r = new FileReader();
    r.onload = e => { aiImages.push({data: e.target.result, type: file.type}); aiRenderPreview(); };
    r.readAsDataURL(file);
  });
}

function aiRenderPreview() {
  const c = $("#ai-preview");
  const btn = $("#ai-btn");
  if (!aiImages.length) { c.innerHTML = ''; btn.disabled = true; btn.style.opacity = '0.4'; return; }
  c.innerHTML = '<div style="display:grid;grid-template-columns:'+(aiImages.length===1?'1fr':'1fr 1fr')+';gap:8px;margin-bottom:1rem">' +
    aiImages.map((img,i) => '<div style="position:relative"><img src="'+img.data+'" style="width:100%;height:120px;object-fit:cover;border-radius:8px;border:1px solid #334155"><button onclick="aiRemove('+i+')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);border:none;color:white;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:12px">×</button></div>').join('') +
    '</div><div style="background:#1e293b;border:1px dashed #334155;border-radius:8px;padding:8px;font-size:12px;color:#94a3b8;cursor:pointer;text-align:center;margin-bottom:1rem;position:relative"><input type="file" accept="image/*" multiple onchange="aiHandleFiles(this.files)" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">＋ 追加で写真を選ぶ</div>';
  btn.disabled = false; btn.style.opacity = '1';
}

function aiRemove(i) { aiImages.splice(i,1); aiRenderPreview(); }

async function aiAnalyze() {
  const key = $("#ai-api-key").value.trim();
  if (!key) { alert('APIキーを入力してください'); return; }
  if (!aiImages.length) { alert('写真を選択してください'); return; }
  const btn = $("#ai-btn");
  btn.disabled = true; btn.textContent = '解析中...';
  $("#ai-result").innerHTML = '<div style="text-align:center;padding:2rem"><div style="width:40px;height:40px;border:3px solid #334155;border-top-color:#f59e0b;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div><p style="font-size:13px;color:#94a3b8">AIが画像を解析中です...</p></div>';
  const content = [{type:'text',text:`あなたはパチスロの設定判別と立ち回りのエキスパートです。送られた画像を分析して以下をJSONのみで返してください。{"machine":"機種名","maker":"メーカー","type":"AT/ART/ノーマル等","data":{"games":"ゲーム数","bonus_count":"ボーナス回数","at_count":"AT回数","bonus_rate":"ボーナス確率","max_medals":"最高出玉"},"setting_analysis":{"eliminated":["否定設定"],"possible":["可能性ある設定"],"most_likely":"最有力設定","confidence":"high/medium/low","reason":"判別根拠"},"strategy":{"verdict":"GO/WAIT/STOP","approach":"朝一/ゾーン/天井/設定狙い/ヤメ推奨","target_games":"狙いG数","stop_games":"ヤメG数","advice":"立ち回りアドバイス3〜5行"},"notable":"特筆事項"}`},
    ...aiImages.map(img => ({type:'image',source:{type:'base64',media_type:img.type,data:img.data.split(',')[1]}}))];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1500,messages:[{role:'user',content}]})});
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const json = JSON.parse(data.content.map(i=>i.text||'').join('').replace(/```json|```/g,'').trim());
    aiRenderResult(json);
  } catch(e) {
    $("#ai-result").innerHTML = '<div style="background:rgba(224,85,85,0.1);border:1px solid #e05555;border-radius:12px;padding:1rem;font-size:13px;color:#e05555">エラー: '+e.message+'</div>';
  }
  btn.disabled = false; btn.textContent = 'AI判別スタート 🔍';
}

function aiRenderResult(d) {
  const s = d.setting_analysis||{}; const st = d.strategy||{};
  const vc = {GO:'#4caf7d',WAIT:'#f59e0b',STOP:'#e05555'}[st.verdict]||'#f59e0b';
  const vl = {GO:'✅ 今すぐ打て！',WAIT:'⏳ 様子見',STOP:'🚫 ヤメ推奨'}[st.verdict]||'判定中';
  const chips = [1,2,3,4,5,6].map(n => {
    const e=(s.eliminated||[]).map(String).includes(String(n));
    const l=String(s.most_likely)===String(n);
    const p=(s.possible||[]).map(String).includes(String(n));
    return '<div style="flex:1;text-align:center;padding:6px 2px;border-radius:6px;font-size:11px;font-weight:600;background:'+(l?'#f59e0b':p?'rgba(245,158,11,0.15)':'#1e293b')+';color:'+(l?'#000':p?'#f59e0b':'#64748b')+';opacity:'+(e?'0.2':'1')+'">設'+n+'</div>';
  }).join('');
  const dd = d.data||{};
  $("#ai-result").innerHTML = '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:1.25rem;margin-top:1rem">'+
    '<div style="font-size:18px;font-weight:700;color:#f59e0b">'+(d.machine||'機種不明')+'</div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">'+(d.maker||'')+' '+(d.type||'')+'</div>'+
    '<div style="display:inline-block;font-size:13px;font-weight:600;padding:4px 12px;border-radius:20px;background:'+vc+'22;color:'+vc+';border:1px solid '+vc+';margin-bottom:1rem">'+vl+'</div>'+
    (dd.games||dd.bonus_count?'<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">読み取りデータ</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem">'+
    (dd.games?'<div style="background:#0f172a;border-radius:8px;padding:10px"><div style="font-size:10px;color:#94a3b8">ゲーム数</div><div style="font-size:16px;font-weight:600">'+dd.games+'G</div></div>':'')+
    (dd.bonus_count?'<div style="background:#0f172a;border-radius:8px;padding:10px"><div style="font-size:10px;color:#94a3b8">ボーナス回数</div><div style="font-size:16px;font-weight:600">'+dd.bonus_count+'回</div></div>':'')+
    (dd.at_count?'<div style="background:#0f172a;border-radius:8px;padding:10px"><div style="font-size:10px;color:#94a3b8">AT/ART回数</div><div style="font-size:16px;font-weight:600">'+dd.at_count+'回</div></div>':'')+
    (dd.bonus_rate?'<div style="background:#0f172a;border-radius:8px;padding:10px"><div style="font-size:10px;color:#94a3b8">ボーナス確率</div><div style="font-size:16px;font-weight:600">'+dd.bonus_rate+'</div></div>':'')+
    '</div>':'')+'<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">設定判別</div>'+
    '<div style="display:flex;gap:4px;margin-bottom:6px">'+chips+'</div>'+
    '<div style="font-size:12px;color:#94a3b8;line-height:1.7;margin-bottom:1rem">'+(s.reason||'')+'</div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">立ち回り判定</div>'+
    '<div style="margin-bottom:8px">'+(st.approach?'<span style="display:inline-block;font-size:11px;padding:3px 10px;border-radius:20px;margin:2px;background:rgba(74,158,255,0.15);color:#4a9eff;border:1px solid rgba(74,158,255,0.3)">'+st.approach+'</span>':'')+
    (st.target_games?'<span style="display:inline-block;font-size:11px;padding:3px 10px;border-radius:20px;margin:2px;background:rgba(74,158,255,0.15);color:#4a9eff;border:1px solid rgba(74,158,255,0.3)">狙い目 '+st.target_games+'G〜</span>':'')+
    (st.stop_games?'<span style="display:inline-block;font-size:11px;padding:3px 10px;border-radius:20px;margin:2px;background:rgba(74,158,255,0.15);color:#4a9eff;border:1px solid rgba(74,158,255,0.3)">ヤメ '+st.stop_games+'G</span>':'')+'</div>'+
    '<div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+(st.advice||'')+'</div>'+
    (d.notable?'<div style="font-size:11px;color:#94a3b8;margin-top:1rem;margin-bottom:6px">注目ポイント</div><div style="font-size:12px;color:#f59e0b;line-height:1.7">'+d.notable+'</div>':'')+'</div>';
}

// ---------- Claudeチャットボタン ----------
function addClaudeButton() {
  const root = $("#analyze-root");
  if (!root) return;
  const template = `以下の情報をもとに、この台を今打つべきか総合判別してください。

【送る情報】
・筐体の写真（機種名確認用）
・データ画面の写真（ゲーム数・ボーナス回数・AT回数・確率など）
・グラフ画面の写真（出玉の波・当たりのタイミングなど）
※写真は複数枚送るほど精度が上がります！

【判別してほしいこと】
1. 機種名と基本スペックを教えてください
2. データから読み取れる設定推測（設定1〜6のどれが濃厚か）
3. 以下のどの狙い方が有効か判断してください
   - 朝一リセット狙い（天井短縮・モード優遇はあるか）
   - ゾーン狙い（有効なゾーンはどこか）
   - 天井狙い（現在のゲーム数から天井まで何G必要か）
   - 設定狙い（高設定の可能性はあるか）
4. 今すぐ打つべきか・様子見か・ヤメ推奨かを教えてください
5. 打つ場合の具体的な狙いゲーム数とヤメ時を教えてください`;

  const btn = document.createElement('div');
  btn.style.cssText = 'padding:0 1rem 1rem;max-width:480px;margin:0 auto';
  btn.innerHTML = \`
    <div style="border-top:1px solid #334155;margin-bottom:1rem"></div>
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:1rem">
      <div style="font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:8px">💬 APIキーなしで使う</div>
      <div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;color:#94a3b8;line-height:1.7">
        <div style="color:#f59e0b;font-weight:600;margin-bottom:6px">📸 送ると精度UP！</div>
        ① 筐体の写真（機種名確認）<br>
        ② データ画面（ゲーム数・回数・確率）<br>
        ③ グラフ画面（出玉の波・当たりタイミング）<br>
        <span style="color:#64748b">※複数枚送るほど判別精度が上がります</span>
      </div>
      <button onclick="navigator.clipboard.writeText(document.getElementById('claude-template').value).then(()=>alert('コピーしました！claude.aiに貼り付けてください'))" style="width:100%;padding:8px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer;margin-bottom:8px">
        📋 質問テンプレートをコピー
      </button>
      <textarea id="claude-template" readonly style="position:absolute;left:-9999px">\${template}</textarea>
      <a href="https://claude.ai" target="_blank" style="display:block;width:100%;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white;text-decoration:none;box-sizing:border-box;text-align:center">
        💬 Claudeを開く →
      </a>
      <div style="font-size:11px;color:#64748b;margin-top:8px;text-align:center">テンプレをコピー → Claudeを開く → 写真と一緒に送信！</div>
    </div>\`;
  root.appendChild(btn);
}

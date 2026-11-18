/* 一幕·神剪 · 剪映级工作台原型（纯原生 JS，无构建依赖） */
const FRAMES = ["__F0__", "__F1__", "__F2__", "__F3__", "__F4__", "__F5__", "__F6__", "__F7__", "__F8__", "__F9__"];
const FPS = 24;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const tc = (sec) => {
  sec = Math.max(0, sec);
  const f = Math.floor((sec % 1) * FPS);
  return `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}:${pad(f)}`;
};
const short = (sec) => `${pad(sec / 60)}:${pad(sec % 60)}.${String(Math.floor((sec % 1) * 10))}`;

const icon = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5l12 7-12 7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5h3v14H8zM14 5h3v14h-3z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.4"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><path d="M3 3l18 18M9.5 9.5A3.5 3.5 0 0 0 12 15.5M5 7c-1.8 1.6-3 5-3 5s3.6 6 10 6c1.8 0 3.4-.5 4.8-1.2M9 3.5c1-.3 2-.5 3-.5 6.4 0 10 6 10 6s-.7 1.5-2 3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2"/></svg>',
  vol: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><path d="M4 10v4h3l4 3V7l-4 3z"/><path d="M15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"><path d="M4 10v4h3l4 3V7l-4 3zM16 9l5 6M21 9l-5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"><path d="M5 12h14"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"><path d="M12 4l5 8-5 8-5-8z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><path d="M12 3l1.9 4.6L18 9l-4.1 1.6L12 15l-1.9-4.4L6 9l4.1-1.4z"/><path d="M18 15l1 2.4L21 18l-2 .8L18 21l-1-2.2L15 18l2-.6z"/></svg>',
};

const FILLERS = [
  { t: 1.4, w: '嗯', speak: '老周' }, { t: 3.2, w: '啊', speak: '老周' },
  { t: 7.1, w: '呃', speak: '旁白' }, { t: 12.4, w: '呀', speak: '老周' },
];

const HIGHLIGHTS = [
  { id: 'h1', start: 0.8, end: 8.2, title: '钩子 · 怀表停了', reason: '开场 3 秒建立悬念：表针停在雨夜', frame: 0, tag: '开场钩子' },
  { id: 'h2', start: 8.4, end: 17.6, title: '冲突 · 谁动过表', reason: '关键对白推进矛盾，保留完整问答', frame: 2, tag: '关键对白' },
  { id: 'h3', start: 17.8, end: 29.0, title: '反转 · 表盖里的照片', reason: '情绪反转点，画面与台词同时给信息', frame: 3, tag: '情绪反转' },
  { id: 'h4', start: 29.2, end: 38.0, title: '金句 · 十年只差一夜', reason: '一句可独立传播的金句，留 1 秒呼吸', frame: 4, tag: '金句' },
  { id: 'h5', start: 38.2, end: 48.8, title: '揭示 · 雨夜真相', reason: '真相揭晓，补一个近景反应镜头', frame: 6, tag: '真相揭示' },
  { id: 'h6', start: 49.0, end: 58.0, title: '收尾 · 表针重新走', reason: '结尾动作闭环，留白 2 秒给音乐', frame: 8, tag: '收尾' },
];

const clipFrames = (from, count) => Array.from({ length: count }, (_, i) => (from + i) % FRAMES.length);

function initialTracks() {
  return [
    {
      id: 'T3', name: '字幕', type: 'text', kind: 'T3', h: 50, muted: false, hidden: false, locked: false,
      clips: [
        { id: 't1', start: 1.2, dur: 5.2, text: '他每晚都会把怀表擦一遍', frames: [0] },
        { id: 't2', start: 6.6, dur: 5.4, text: '这块表，停在十年前的雨夜', frames: [1] },
        { id: 't3', start: 13.2, dur: 6.2, text: '表盖里，藏着一张旧照片', frames: [2] },
        { id: 't4', start: 19.4, dur: 2.4, text: '十年，只差一夜', frames: [3] },
      ],
    },
    {
      id: 'V1', name: '叠加画面', type: 'overlay', kind: 'V1', h: 64, muted: false, hidden: false, locked: false,
      clips: [{ id: 'v1', start: 8.0, dur: 8.0, label: '回忆叠化', frames: clipFrames(2, 6), opacity: .86 }],
    },
    {
      id: 'V2', name: '主画面 · 音画同轨', type: 'video', kind: 'V2', h: 200, muted: false, hidden: false, locked: false,
      clips: [{
        id: 'v2', start: 0, dur: 22, label: '雨夜怀表', frames: clipFrames(0, 10), audio: true, seed: 7,
        kf: [
          { id: 'k1', t: 0.8, scale: 1.0, x: 0, y: 0 },
          { id: 'k2', t: 5.6, scale: 1.16, x: -0.04, y: 0.02 },
          { id: 'k3', t: 11.2, scale: 1.06, x: 0.03, y: -0.02 },
          { id: 'k4', t: 17.4, scale: 1.24, x: -0.02, y: 0.03 },
        ],
      }],
    },
  ];
}
const S = {
  duration: 22,
  pxPerSec: 48,
  globalH: 88,
  playhead: 12.4,
  playing: false,
  selectedClip: 'v2',
  selectedKf: 'k2',
  tracks: initialTracks(),
  fillerCleaned: false,
  mode: 'normal',
  drawerTab: 'chat',
  drawerOpen: false,
  messages: [],
  hlGenerated: false,
  history: [],
  future: [],
  activePanel: 'media',
};

/* =============== 历史 / 快照 =============== */
function snapshot() {
  return JSON.parse(JSON.stringify({ tracks: S.tracks, duration: S.duration, fillerCleaned: S.fillerCleaned, mode: S.mode, hlGenerated: S.hlGenerated, selectedClip: S.selectedClip, selectedKf: S.selectedKf }));
}
function pushHistory() {
  S.history.push(snapshot());
  if (S.history.length > 20) S.history.shift();
  S.future = [];
}
function restore(snap) {
  S.tracks = snap.tracks;
  S.duration = snap.duration;
  S.fillerCleaned = snap.fillerCleaned;
  S.mode = snap.mode;
  S.hlGenerated = snap.hlGenerated;
  S.selectedClip = snap.selectedClip;
  S.selectedKf = snap.selectedKf;
  S.playhead = Math.min(S.playhead, S.duration);
}
function undo() {
  if (!S.history.length) return toast('没有可撤销的操作');
  S.future.push(snapshot());
  restore(S.history.pop());
  render(); renderDrawer();
  toast('已撤销上一步');
}
function redo() {
  if (!S.future.length) return toast('没有可重做的操作');
  S.history.push(snapshot());
  restore(S.future.pop());
  render(); renderDrawer();
  toast('已重做');
}

/* =============== 工具 =============== */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function selectedTrack() { return S.tracks.find((t) => t.clips.some((c) => c.id === S.selectedClip)); }
function selectedClip() {
  for (const t of S.tracks) { const c = t.clips.find((x) => x.id === S.selectedClip); if (c) return c; }
  return null;
}
function allClips() { return S.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t }))); }
function frameAt(sec) {
  const span = Math.max(0.001, S.duration);
  return FRAMES[clamp(Math.round((sec / span) * (FRAMES.length - 1)), 0, FRAMES.length - 1)];
}
function currentKf() {
  const c = selectedClip();
  if (!c || !c.kf) return null;
  return c.kf.find((k) => k.id === S.selectedKf) ?? c.kf[0] ?? null;
}

/* =============== 素材区 =============== */
function renderAssets() {
  const used = new Set();
  allClips().forEach((c) => (c.frames || []).forEach((f) => used.add(f)));
  $('#assetGrid').innerHTML = FRAMES.map((src, i) => {
    const dur = i === 0 ? '00:22' : `00:${String(6 + i).padStart(2, '0')}`;
    return `<div class="asset" data-frame="${i}" title="片段 ${pad(i + 1)}">
      <img src="${src}" alt="">
      ${used.has(i) ? '<span class="used">✓</span>' : ''}
      <span class="dur">${dur}</span>
      <span class="av">片段 ${pad(i + 1)} · ${['怀表特写', '雨天窗', '柜台', '照片', '老周', '怀表盖', '雨夜', '回忆', '猫', '结尾'][i] || '画面'}</span>
    </div>`;
  }).join('');
}

/* =============== 标尺 / 时间线 =============== */
function laneWidth() {
  return Math.max(S.duration * S.pxPerSec + 160, 720);
}
function renderRuler() {
  const w = laneWidth();
  const ruler = $('#ruler');
  ruler.style.width = `${w}px`;
  const step = S.pxPerSec >= 72 ? 0.5 : S.pxPerSec <= 28 ? 2 : 1;
  let marks = '';
  for (let t = 0; t <= S.duration + 0.001; t += step) {
    const major = Math.abs(t % 5) < 0.001;
    marks += `<div class="tick${major ? ' major' : ''}" style="left:${t * S.pxPerSec}px">${major ? `<span>${pad(t / 60)}:${pad(t % 60)}</span>` : ''}</div>`;
  }
  ruler.innerHTML = marks;
  // 播放头
  const ph = $('#playhead');
  ph.style.left = `${176 + S.playhead * S.pxPerSec}px`;
  updateTimeUI();
}
function renderTracks() {
  const w = laneWidth();
  const rows = S.tracks.filter((t) => t.clips.length > 0).map((t) => {
    const clips = t.clips.map((c) => renderClip(t, c)).join('');
    return `<div class="track" style="height:${t.h}px" data-track="${t.id}">
      <div class="thead">
        <div class="l1"><b>${esc(t.kind)}</b><span class="nm">${esc(t.name)}</span>
          <span class="type">${t.type === 'audio' || t.type === 'music' ? 'AUDIO' : t.type === 'text' ? 'TEXT' : 'VIDEO'}</span>
          <span class="hbtns">
            <button data-tact="hide" class="${t.hidden ? 'on' : ''}" title="显示/隐藏">${t.hidden ? icon.eyeoff : icon.eye}</button>
            <button data-tact="lock" class="${t.locked ? 'on' : ''}" title="锁定">${t.locked ? icon.lock : icon.unlock}</button>
            <button data-tact="mute" class="${t.muted ? 'on' : ''}" title="静音">${t.muted ? icon.mute : icon.vol}</button>
          </span>
        </div>
        <div class="l2"><span>${t.clips.length} 个片段</span><span class="hv"><button data-tact="hminus">−</button><button data-tact="hplus">＋</button></span></div>
      </div>
      <div class="lane grid" style="width:${w}px;--gridstep:${S.pxPerSec}px">${clips}</div>
    </div>`;
  }).join('');
  $('#tracks').innerHTML = rows;
  // 音频波形
  $$('.clip.audio,.clip.music,.clip.video').forEach((el) => {
    const canvas = $('canvas', el);
    if (canvas) drawWave(canvas, Number(el.dataset.seed || 1), el.dataset.cid);
  });
  $$('.clip .kf').forEach((el) => {
    el.style.height = `${Math.max(34, Math.min(150, el.closest('.track').style.height.replace('px', '') - 24))}px`;
  });
}
function renderClip(track, clip) {
  const left = clip.start * S.pxPerSec;
  const width = Math.max(6, clip.dur * S.pxPerSec);
  const common = `data-cid="${clip.id}" data-track-id="${track.id}" style="left:${left}px;width:${width}px"`;
  if (track.type === 'text') {
    return `<div class="clip text${S.selectedClip === clip.id ? ' sel' : ''}" ${common}>
      <div class="txt">${esc(clip.text)}</div><span class="dur">${clip.dur.toFixed(1)}s</span></div>`;
  }
  if (track.type === 'audio' || track.type === 'music') {
    const marks = (S.fillerCleaned && track.id === 'A1')
      ? FILLERS.map((f) => `<div class="cutmark" style="left:${f.t * S.pxPerSec}px;width:${0.45 * S.pxPerSec}px"><b>${f.w}</b></div>`).join('')
      : '';
    return `<div class="clip ${track.type === 'music' ? 'music' : 'audio'}${S.selectedClip === clip.id ? ' sel' : ''}" ${common} data-seed="${clip.seed || 3}">
      <div class="audio-wrap"><canvas></canvas></div>${marks}
      <span class="tag">${esc(clip.label)}</span><span class="dur">${clip.dur.toFixed(1)}s</span></div>`;
  }
  // 视频 / 叠加：画面在上，音频波形在下，同一轨道内不分离
  const h = track.h - 10;
  const filmH = h - 30;
  const tile = Math.max(22, Math.round(filmH * 9 / 16));
  const count = clamp(Math.ceil(width / tile) + 1, 1, 40);
  let film = '';
  for (let i = 0; i < count; i += 1) {
    const f = clip.frames[i % clip.frames.length];
    film += `<i style="width:${tile}px;background-image:url('${FRAMES[f]}')"></i>`;
  }
  const kfs = (clip.kf || []).map((k) => {
    const hh = clamp(filmH - 10, 34, 150);
    const ww = Math.round(hh * 9 / 16);
    return `<div class="kf${S.selectedKf === k.id ? ' sel' : ''}" data-kf="${k.id}" style="left:${k.t * S.pxPerSec}px;width:${ww}px;height:${hh}px">
      <img src="${FRAMES[clip.frames[Math.min(clip.frames.length - 1, Math.round(k.t / Math.max(0.1, clip.dur) * clip.frames.length))]]}" alt="">
      <span class="kt">${k.t.toFixed(1)}s</span>
      <div class="kf-tip"><b>${k.t.toFixed(2)}s · 画面关键帧</b><br>缩放 ${Math.round(k.scale * 100)}%<br>X ${Math.round(k.x * 100)}% · Y ${Math.round(k.y * 100)}%<br>拖动可改时间</div>
    </div>`;
  }).join('');
  const cuts = (track.id === 'V2' && S.fillerCleaned && S.mode !== 'highlights')
    ? FILLERS.map((f) => `<div class="vcut" style="left:${f.t * S.pxPerSec}px;width:${0.45 * S.pxPerSec}px"><b>${f.w}</b></div>`).join('')
    : '';
  const wave = clip.audio && track.id === 'V2'
    ? `<div class="vwave"><canvas></canvas>${cuts}<span class="db">0.0 dB</span></div>`
    : '';
  return `<div class="clip ${track.type === 'overlay' ? 'overlay' : 'video'}${S.selectedClip === clip.id ? ' sel' : ''}" ${common} data-frames="${clip.frames.join(',')}" data-seed="${clip.seed || 7}">
    <div class="film">${film}</div><div class="shade"></div>
    <span class="tag">${esc(track.kind)}</span><span class="nm">${esc(clip.label)}</span><span class="dur">${clip.dur.toFixed(1)}s</span>
    <div class="kf-layer">${kfs}</div>${wave}
  </div>`;
}
function drawWave(canvas, seed, cid) {
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 40;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const bar = 2.2;
  const color = cid === 'a2' ? '#5a8dff' : '#2f9bff';
  ctx.fillStyle = color;
  for (let x = 0; x < w; x += bar) {
    const p = x / w;
    const env = (0.35 + 0.65 * Math.abs(Math.sin(p * 9 + seed))) * (0.4 + 0.6 * Math.abs(Math.sin(p * 31 + seed * 1.7)));
    const amp = Math.max(0.08, Math.min(1, env)) * (mid - 2);
    ctx.fillRect(x, mid - amp, Math.max(1, bar - .5), amp * 2);
  }
}
function renderTimeline() {
  renderRuler();
  renderTracks();
  $('#vZoom').value = S.globalH;
  $('#vZoomVal').textContent = `${S.globalH}px`;
  updateZoomUI();
  renderInspector();
  updatePreview();
}
function updateZoomUI() {
  const min = 10, max = 110;
  const p = (S.pxPerSec - min) / (max - min);
  $('#zFill').style.width = `${p * 100}%`;
  $('#zThumb').style.left = `${p * 100}%`;
}

/* =============== 预览 / 播放 =============== */
function updatePreview() {
  const t = S.playhead;
  const v2 = S.tracks.find((x) => x.id === 'V2');
  const clips = v2.clips;
  let frame = frameAt(t);
  for (const c of clips) {
    if (t >= c.start && t < c.start + c.dur) {
      const idx = clamp(Math.floor(((t - c.start) / c.dur) * c.frames.length), 0, c.frames.length - 1);
      frame = FRAMES[c.frames[idx]];
    }
  }
  $('#previewImg').src = frame;
  const k = currentKf();
  if (k) {
    $('#previewImg').style.transform = `scale(${k.scale}) translate(${k.x * 100}%, ${k.y * 100}%)`;
  }
  const textTrack = S.tracks.find((x) => x.id === 'T3');
  const sub = textTrack.clips.find((c) => t >= c.start && t < c.start + c.dur);
  const subEl = $('#previewSub');
  if (sub) { subEl.innerHTML = `${esc(sub.text)}<small>字幕 · 轨道 3</small>`; subEl.classList.remove('hidden'); }
  else subEl.classList.add('hidden');
  $('#stageMode').textContent = S.mode === 'highlights' ? `精简预览 · ${Math.round(S.duration)}s 版` : '原片预览';
}
function updateTimeUI() {
  $('#curTime').textContent = tc(S.playhead);
  $('#topTime').textContent = tc(S.playhead);
  $('#curTotal').textContent = tc(S.duration);
  $('#topTotal').textContent = tc(S.duration);
  const p = clamp((S.playhead / S.duration) * 100, 0, 100);
  $('#scrubFill').style.width = `${p}%`;
  $('#scrubKnob').style.left = `${p}%`;
  $('#playhead').style.left = `${176 + S.playhead * S.pxPerSec}px`;
}
let timer = null;
function togglePlay() {
  S.playing = !S.playing;
  $('#playBtn').innerHTML = S.playing ? icon.pause : icon.play;
  if (S.playing) {
    let last = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      S.playhead += dt;
      if (S.playhead >= S.duration) { S.playhead = 0; }
      updatePreview(); updateTimeUI();
    }, 60);
  } else {
    clearInterval(timer);
  }
}
function seek(t) {
  S.playhead = clamp(t, 0, S.duration);
  updatePreview(); updateTimeUI();
  $('.lane')?.focus?.();
}

/* =============== 检查器 =============== */
function renderInspector() {
  const c = selectedClip();
  if (!c) {
    $('#inspBody').innerHTML = `<p class="kf-empty">在底部时间线点一个片段，这里会显示时间、关键帧、音量和运镜。</p>`;
    return;
  }
  const track = selectedTrack();
  const cStart = c.start, cEnd = c.start + c.dur;
  const frame = c.frames?.[0] ?? 0;
  const k = currentKf();
  const kfs = c.kf || [];
  $('#inspBody').innerHTML = `
    <div class="clip-head">
      <div class="ico"><img src="${FRAMES[frame]}" alt=""></div>
      <div><b>${esc(c.label || c.text || '片段')}</b><span>${tc(cStart)} → ${tc(cEnd)} · ${c.dur.toFixed(2)}s</span></div>
      <span class="kind">${track ? esc(track.kind) : ''} ${track ? esc(track.type === 'audio' ? '音频' : track.type === 'text' ? '字幕' : '画面') : ''}</span>
    </div>
    <section class="sec">
      <h4>时间 <span class="val">${track?.kind || ''}</span></h4>
      <div class="kv">
        <label>开始 <input type="number" step="0.05" value="${cStart.toFixed(2)}" data-num="start"></label>
        <label>结束 <input type="number" step="0.05" value="${cEnd.toFixed(2)}" data-num="end"></label>
      </div>
    </section>
    ${c.kf ? `<section class="sec">
      <h4>变换 <span class="val">时间线关键帧 ${kfs.length}</span></h4>
      ${k ? `
      <div class="slider"><span>缩放</span><input type="range" min="50" max="260" value="${Math.round(k.scale * 100)}" data-kfrange="scale"><em>${Math.round(k.scale * 100)}%</em></div>
      <div class="slider"><span>X 位置</span><input type="range" min="-60" max="60" value="${Math.round(k.x * 100)}" data-kfrange="x"><em>${Math.round(k.x * 100)}%</em></div>
      <div class="slider"><span>Y 位置</span><input type="range" min="-60" max="60" value="${Math.round(k.y * 100)}" data-kfrange="y"><em>${Math.round(k.y * 100)}%</em></div>
      <div class="slider"><span>旋转</span><input type="range" min="-180" max="180" value="0" data-kfrange="rotate"><em>0°</em></div>
      ` : '<p class="kf-empty">播放头不在关键帧上，点下方任一帧图可编辑。</p>'}
    </section>` : ''}
    <section class="sec">
      <h4>音量与状态</h4>
      <div class="kv"><label>音量 <input type="number" value="100" step="1"> %</label><label>音高 <input type="number" value="0" step="1"> st</label></div>
      <div class="btnrow">
        <button class="mini" data-act="split">分割 E</button>
        <button class="mini" data-act="del">删除</button>
        <button class="mini">复制</button>
        <button class="mini">倒放</button>
      </div>
    </section>`;
}

/* =============== 时间线事件 =============== */
function bindTimeline() {
  const scroll = $('#tlScroll');
  scroll.addEventListener('mousedown', (e) => {
    if (e.target.closest('.clip') || e.target.closest('.kf')) return;
    if (e.target.closest('.thead')) return;
    const ruler = $('#ruler');
    const rect = ruler.getBoundingClientRect();
    const t = clamp((e.clientX - rect.left) / S.pxPerSec, 0, S.duration);
    seek(t);
  });
  // 播放头拖动
  const ph = $('#playhead');
  ph.style.pointerEvents = 'auto';
  ph.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const move = (ev) => {
      const ruler = $('#ruler');
      const rect = ruler.getBoundingClientRect();
      seek((ev.clientX - rect.left) / S.pxPerSec);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  // 轨道头按钮
  $('#tracks').addEventListener('click', (e) => {
    const tact = e.target.closest('[data-tact]');
    if (tact) {
      const row = tact.closest('.track');
      const track = S.tracks.find((t) => t.id === row.dataset.track);
      const act = tact.dataset.tact;
      if (act === 'hide') track.hidden = !track.hidden;
      if (act === 'lock') track.locked = !track.locked;
      if (act === 'mute') track.muted = !track.muted;
      if (act === 'hplus') track.h = clamp(track.h + 12, 40, 190);
      if (act === 'hminus') track.h = clamp(track.h - 12, 40, 190);
      renderTracks();
      return;
    }
    const kf = e.target.closest('.kf');
    if (kf) {
      e.stopPropagation();
      S.selectedKf = kf.dataset.kf;
      const c = selectedClip();
      const item = c?.kf?.find((x) => x.id === S.selectedKf);
      if (item) { seek(c.start + item.t); renderInspector(); renderTracks(); }
      return;
    }
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      S.selectedClip = clipEl.dataset.cid;
      const c = selectedClip();
      const track = selectedTrack();
      if (c?.kf?.length) S.selectedKf = c.kf[0].id;
      renderInspector(); renderTracks();
      return;
    }
  });
  // 关键帧水平拖动改时间
  $('#tracks').addEventListener('mousedown', (e) => {
    const kf = e.target.closest('.kf');
    if (!kf) return;
    const c = selectedClip();
    if (!c || !c.kf) return;
    const item = c.kf.find((x) => x.id === kf.dataset.kf);
    if (!item) return;
    e.preventDefault();
    const startX = e.clientX, t0 = item.t;
    const move = (ev) => {
      item.t = clamp(t0 + (ev.clientX - startX) / S.pxPerSec, 0, c.dur);
      renderTracks();
      updatePreview();
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      pushHistory(); renderInspector(); toast(`关键帧已移到 ${item.t.toFixed(2)}s`);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
}
function addKeyframe() {
  const c = selectedClip();
  if (!c || !c.kf) return toast('请先在时间线上选择一个画面片段');
  const t = clamp(S.playhead - c.start, 0, c.dur);
  const exist = c.kf.find((k) => Math.abs(k.t - t) < 0.15);
  if (exist) {
    c.kf = c.kf.filter((k) => k !== exist);
    S.selectedKf = c.kf[0]?.id || null;
    toast(`已删除 ${t.toFixed(2)}s 处的关键帧`);
  } else {
    pushHistory();
    const base = c.kf[0] || { scale: 1, x: 0, y: 0 };
    const item = { id: `k${Date.now()}`, t, scale: base.scale, x: base.x, y: base.y };
    c.kf.push(item);
    c.kf.sort((a, b) => a.t - b.t);
    S.selectedKf = item.id;
    toast(`已从当前画面抽出关键帧：${t.toFixed(2)}s`);
  }
  renderTracks(); renderInspector(); updatePreview();
}
function splitClip() {
  const c = selectedClip();
  if (!c) return toast('先选中一个片段');
  const t = S.playhead;
  if (t <= c.start + 0.1 || t >= c.start + c.dur - 0.1) return toast('播放头不在片段内部');
  pushHistory();
  const left = { ...c, dur: t - c.start, id: `${c.id}a` };
  const right = { ...c, start: t, dur: c.start + c.dur - t, id: `${c.id}b` };
  right.frames = c.frames;
  const track = selectedTrack();
  const idx = track.clips.indexOf(c);
  track.clips.splice(idx, 1, left, right);
  S.selectedClip = right.id;
  S.selectedKf = right.kf?.[0]?.id || null;
  render(); toast('已在播放头分割');
}

/* =============== 顶栏/工具条动作 =============== */
function bindActions() {
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'play') togglePlay();
      if (a === 'undo') undo();
      if (a === 'redo') redo();
      if (a === 'split') splitClip();
      if (a === 'addkf') addKeyframe();
      if (a === 'del') { const c = selectedClip(); if (c) { pushHistory(); const t = selectedTrack(); t.clips = t.clips.filter((x) => x.id !== c.id); render(); toast('已删除片段'); } }
      if (a === 'clearkf') { const c = selectedClip(); if (c?.kf) { pushHistory(); c.kf = []; render(); toast('已清空关键帧'); } }
      if (a === 'export') toast('原型：导出功能在正式版执行（渲染队列 + 剪映式导出面板）');
      if (a === 'applyhl') openDurationModal(durTarget);
      if (a === 'start') seek(0);
      if (a === 'end') seek(S.duration);
      if (a === 'prev') seek(S.playhead - 1);
      if (a === 'next') seek(S.playhead + 1);
      return;
    }
    const z = e.target.closest('[data-z]');
    if (z) {
      S.pxPerSec = clamp(S.pxPerSec + (z.dataset.z === '+' ? 8 : -8), 10, 110);
      renderTimeline();
      return;
    }
  });
  const zSet = (clientX) => {
    const el = $('#zSlider'); const r = el.getBoundingClientRect();
    S.pxPerSec = clamp(10 + ((clientX - r.left) / r.width) * 100, 10, 110);
    renderTimeline();
  };
  $('#zSlider').addEventListener('mousedown', (e) => {
    e.preventDefault(); zSet(e.clientX);
    const move = (ev) => zSet(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  $('#fitBtn').addEventListener('click', () => {
    const width = $('#tlScroll').clientWidth - 176 - 28;
    S.pxPerSec = clamp(width / S.duration, 10, 110);
    renderTimeline();
  });
  $('#vZoom').addEventListener('input', (e) => {
    S.globalH = Number(e.target.value);
    S.tracks.forEach((t) => { t.h = S.globalH; });
    renderTracks();
    $('#vZoomVal').textContent = `${S.globalH}px`;
  });
  $('#scrub').addEventListener('mousedown', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const move = (ev) => seek(((ev.clientX - rect.left) / rect.width) * S.duration);
    seek(((e.clientX - rect.left) / rect.width) * S.duration);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  // 检查器
  $('#inspBody').addEventListener('click', (e) => {
    const del = e.target.closest('[data-kf-del]');
    if (del) {
      const c = selectedClip();
      if (c?.kf) { pushHistory(); c.kf = c.kf.filter((k) => k.id !== del.dataset.kfDel); render(); toast('已删除关键帧'); }
      return;
    }
    const card = e.target.closest('[data-kf-card]');
    if (card) {
      S.selectedKf = card.dataset.kfCard;
      const c = selectedClip();
      const k = c.kf.find((x) => x.id === S.selectedKf);
      seek(c.start + k.t); renderInspector(); renderTracks();
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      if (act.dataset.act === 'addkf') addKeyframe();
      if (act.dataset.act === 'clearkf') { const c = selectedClip(); if (c?.kf) { pushHistory(); c.kf = []; render(); } }
      if (act.dataset.act === 'split') splitClip();
    }
  });
  $('#inspBody').addEventListener('input', (e) => {
    const r = e.target.closest('[data-kfrange]');
    if (r) {
      const k = currentKf();
      if (k) {
        const key = r.dataset.kfrange;
        const v = Number(r.value);
        if (key === 'scale') k.scale = v / 100;
        else k.x = v / 100; if (key === 'y') k.y = v / 100;
        updatePreview();
        const em = r.parentElement.querySelector('em');
        if (em) em.textContent = key === 'scale' ? `${v}%` : `${v}%`;
      }
    }
    const num = e.target.closest('[data-num]');
    if (num) {
      const c = selectedClip();
      const v = Number(num.value) || 0;
      if (num.dataset.num === 'start') { c.start = Math.max(0, v); c.dur = Math.max(0.1, c.start + c.dur - c.start); c.dur = Math.max(0.1, (c.start + c.dur) - c.start); }
      renderTracks();
    }
  });
  // 素材区
  $('#assetGrid').addEventListener('click', (e) => {
    const a = e.target.closest('.asset');
    if (!a) return;
    const i = Number(a.dataset.frame);
    $('#previewImg').src = FRAMES[i];
    toast(`预览素材片段 ${pad(i + 1)}`);
  });
}

/* =============== 左栏 =============== */
function bindLeftRail() {
  $('#rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-panel]');
    if (!b) return;
    $$('#rail button').forEach((x) => x.classList.toggle('on', x === b));
    S.activePanel = b.dataset.panel;
    const names = { media: '媒体', audio: '音频', text: '文本', sticker: '贴纸', fx: '特效', trans: '转场', sub: '字幕', filter: '滤镜', adjust: '调节' };
    toast(`${names[S.activePanel]}面板（原型）`);
  });
}

/* =============== Agent =============== */
function openDrawer(tab = 'chat') {
  const d = $('#drawer');
  if (!d.style.left || !d.style.top) {
    d.style.left = `${Math.max(12, (window.innerWidth - 480) / 2)}px`;
    d.style.top = '80px';
  }
  S.drawerOpen = true;
  d.classList.add('open');
  if (tab) S.drawerTab = tab;
  renderDrawer();
  if (S.messages.length === 0) initialMessages();
}
function closeDrawer() {
  S.drawerOpen = false;
  $('#drawer').classList.remove('open');
}
function initialMessages() {
  S.messages = [
    { role: 'agent', text: `<b>已读取你的时间线。</b><br>3 条轨道 · 音画同轨 · 4 个画面关键帧 · 对白转写 18 段。<br><br>你可以直接说人话，我会先理解再执行；也可以点下面的快捷指令。<div class="chips" style="margin-bottom:0"><button data-quick="filler">去语气助词</button><button data-quick="hl">一键生成精简</button><button data-quick="read">读取时间线 EDL</button></div>` },
  ];
}
function agentSay(html, ops = '') {
  S.messages.push({ role: 'agent', text: html + ops });
  renderDrawer();
  const b = $('#dBody'); if (b) b.scrollTop = b.scrollHeight;
}
function userSay(text) { S.messages.push({ role: 'user', text: esc(text) }); renderDrawer(); }
function renderDrawer() {
  if (!S.drawerOpen) return;
  $$('#dTabs button').forEach((b) => b.classList.toggle('on', b.dataset.dtab === S.drawerTab));
  const body = $('#dBody');
  if (S.drawerTab === 'chat') {
    const msgs = S.messages.map((m) => m.role === 'user'
      ? `<div class="msg user"><div class="av">你</div><div class="bubble">${m.text}</div></div>`
      : `<div class="msg"><div class="av">神</div><div class="bubble">${m.text}</div></div>`).join('');
    body.innerHTML = `<div class="agent-status"><span class="g"></span><b>时间线已同步</b><span>${S.tracks.filter((t) => t.clips.length).length} 轨 · ${allClips().length} 片段 · ${allClips().reduce((n, c) => n + (c.kf || []).length, 0)} 关键帧</span></div>
      <div class="rules">
        <h5>执行规则（Agent 与人工共用）</h5>
        <ol>
          <li><b>去语气助词</b>：只删除独立语气词（嗯/啊/呀/呃/哦/诶），贴着语义边界切，不破坏句子；字幕同步删。</li>
          <li><b>一键生成精简</b>：先选目标时长，再按钩子→冲突→反转→金句→揭示→收尾重排，不做固定截断。</li>
          <li><b>音画同轨</b>：不自动做音画分离；音频始终在画面轨下方，画面在上、波形在下。</li>
          <li><b>关键帧</b>：只在时间线画面轨显示真实帧图，不在右侧面板重复堆叠。</li>
        </ol>
      </div>
      <div class="chips">
        <button data-quick="filler">去语气助词</button>
        <button data-quick="hl">一键生成精简</button>
        <button data-quick="read">读取 EDL</button>
        <button data-quick="kf">加一个画面关键帧</button>
      </div>
      ${msgs}`;
    body.scrollTop = body.scrollHeight;
  } else if (S.drawerTab === 'hl') {
    const cards = HIGHLIGHTS.map((h) => `<div class="hl" data-hl="${h.id}">
      <img src="${FRAMES[h.frame]}" alt=""><div class="meta"><b>${esc(h.tag)} · ${h.title}</b><span>${short(h.start)}–${short(h.end)}</span></div></div>`).join('');
    const target = durTarget || 58;
    body.innerHTML = `<div class="summary"><b>${S.hlGenerated ? `已生成精简 · ${target.toFixed(1)}s` : '待生成 · 先选目标时长'}</b><br>源素材 05:12 → 目标 ${target}s，保留 6 个语义关键段；先去语气助词，再按叙事顺序重排。</div>
      <div class="hl-grid">${cards}</div>
      <div class="log"><b>编排逻辑：</b>钩子 → 冲突 → 反转 → 金句 → 揭示 → 收尾；每段按语义边界切，不按固定时长硬切。</div>
      <button class="kf-big-btn" style="border-color:#2fd6c3;color:#9fe9df;background:#12201f;height:34px" data-act="applyhl">一键生成精简</button>`;
  } else {
    body.innerHTML = `<div class="edl-tools"><button data-copy-edl>复制 EDL JSON</button><button data-dl-edl>下载 JSON</button><span style="font-size:9px;color:#5f6b79;align-self:center">Agent 可直接读取这份结构执行剪辑</span></div>
      <pre class="edl" id="edlBox">${esc(JSON.stringify(buildEDL(), null, 2))}</pre>`;
  }
}
function buildEDL() {
  const tracks = S.tracks.map((t) => ({
    id: t.id, kind: t.kind, name: t.name, type: t.type, height: t.h, muted: t.muted, locked: t.locked,
    clips: t.clips.map((c) => ({
      id: c.id, start: +c.start.toFixed(3), duration: +c.dur.toFixed(3),
      ...(c.text ? { text: c.text } : {}),
      ...(c.label ? { label: c.label } : {}),
      ...(c.audio ? { audio: 'inline', audio_in: 'same_track_below_frames' } : {}),
      ...(c.frames ? { frames: c.frames } : {}),
      ...(c.kf ? { keyframes: c.kf.map((k) => ({ id: k.id, t: +k.t.toFixed(3), scale: +k.scale.toFixed(3), x: +k.x.toFixed(3), y: +k.y.toFixed(3) })) } : {}),
    })),
  }));
  return {
    project: '雨夜怀表', fps: FPS, resolution: '1080x1920', duration: S.duration, audio_layout: 'inline',
    tracks,
    transcript: [
      { t: 0.6, speaker: '旁白', text: '他每晚都会把怀表擦一遍。', filler: false },
      { t: 1.4, speaker: '老周', text: '嗯……', filler: true },
      { t: 2.2, speaker: '老周', text: '这块表，停在十年前的雨夜。', filler: false },
      { t: 7.1, speaker: '旁白', text: '呃，表盖里有一张照片。', filler: true },
    ],
    agent_api: {
      read: 'GET /api/projects/:projectId/timeline',
      write: 'PUT /api/projects/:projectId/timeline',
      capabilities: ['read_edl', 'remove_fillers', 'extract_highlights', 'add_keyframe', 'trim_by_semantic', 'choose_target_duration'],
      filler_words: ['嗯', '啊', '呀', '呃', '哦', '诶', '那个', '就是说'],
      rules: ['只删除独立语气助词，贴语义边界切', '精简按钩子→冲突→反转→金句→揭示→收尾重排', '音画保持同轨，不自动分离', '关键帧只在时间线画面轨显示'],
    },
    stats: { clips: allClips().length, keyframes: S.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + ((c.kf || []).length), 0), 0), fillerRemoved: S.fillerCleaned ? 12 : 0 },
  };
}
let durTarget = 58;

function normalizeTarget(v) {
  const n = Math.round(Number(v) || 58);
  return clamp(n, 8, 300);
}
function updateDurationUI() {
  $('#durSrc').innerHTML = `源素材 05:12 · 当前时间线 ${S.duration.toFixed(1)}s · 保留 6 个语义关键段`;
  $$('#durPresets button').forEach((b) => b.classList.toggle('on', Number(b.dataset.sec) === durTarget));
  $('#durCustom').value = durTarget;
  $('#durGo').textContent = `生成 ${durTarget} 秒精简`;
  if (S.drawerOpen && S.drawerTab === 'hl') renderDrawer();
}
function openDurationModal(sec) {
  durTarget = normalizeTarget(sec || durTarget || 58);
  updateDurationUI();
  $('#durMask').classList.add('open');
}
function closeDurationModal() {
  $('#durMask').classList.remove('open');
}
function extractSeconds(text) {
  let m = text.match(/(\d+(?:\.\d+)?)\s*(分钟|min|分)/);
  if (m) return Math.round(Number(m[1]) * 60);
  m = text.match(/(\d+(?:\.\d+)?)\s*(秒|s|sec)/);
  if (m) return Math.round(Number(m[1]));
  return null;
}
function extractTimeAt(text) {
  const m = text.match(/第?\s*(\d+(?:\.\d+)?)\s*秒/);
  return m ? Number(m[1]) : null;
}
function trimHead(sec) {
  const track = selectedTrack()?.type === 'video' ? selectedTrack() : S.tracks.find((t) => t.id === 'V2');
  const clip = track?.clips[0];
  if (!clip || sec >= clip.dur - 0.5) { agentSay('这段素材不够剪这么多，请换个时长或换一段素材。'); return; }
  pushHistory();
  clip.dur = +(clip.dur - sec).toFixed(3);
  clip.kf = (clip.kf || []).map((k) => ({ ...k, t: +(k.t - sec).toFixed(3) })).filter((k) => k.t >= 0.05);
  const t3 = S.tracks.find((t) => t.id === 'T3');
  t3.clips = t3.clips.map((c) => ({ ...c, start: Math.max(0, +(c.start - sec).toFixed(3)), dur: +Math.min(c.dur, Math.max(0.4, c.end ?? 99)).toFixed(3) }));
  S.duration = Math.max(...allClips().map((c) => c.start + c.dur));
  S.playhead = 0;
  render();
  agentSay(`<b>已从开头剪掉 ${sec} 秒。</b><br>规则：保留原片其余内容与关键帧，只把入点前移；时间线总时长更新为 <b>${S.duration.toFixed(1)}s</b>。`);
  toast(`已剪掉开头 ${sec} 秒`);
}
function agentCommand(text) {
  const t = text.replace(/\s+/g, '');
  if (/撤销|撤回/.test(t)) { undo(); return; }
  if (/语气助词|语气词|口癖|嗯|啊|呀|呃|哦|诶/.test(t)) { runFiller(); return; }
  const sec = extractSeconds(t);
  if (/(精简|精彩|高光|精华|短剪|成片|剪成|压到|缩到|生成.*(短|片))/.test(t) && !/(开头|片头|前)/.test(t)) {
    openDurationModal(sec || durTarget);
    agentSay(`明白。已打开「一键生成精简」，目标 ${normalizeTarget(sec || durTarget)} 秒；你可以改时长，确认后我按语义重排，不做硬截断。`);
    return;
  }
  if (/(开头|片头|前).*(剪|删|裁)|(剪|删|裁).*(开头|片头|前)/.test(t) && sec) { trimHead(sec); return; }
  if (/关键帧/.test(t)) {
    const at = extractTimeAt(t);
    if (at != null) seek(at);
    addKeyframe();
    agentSay(`已在 <b>${S.playhead.toFixed(2)}s</b> 添加画面关键帧；时间线画面轨会直接出现该帧画面。`);
    return;
  }
  if (/字幕/.test(t) && /(删|清空|去掉|不要)/.test(t)) {
    pushHistory();
    const t3 = S.tracks.find((x) => x.id === 'T3');
    t3.clips = [];
    render();
    agentSay('字幕轨已清空，画面与音频未动。');
    return;
  }
  if (/静音/.test(t)) {
    const tr = selectedTrack();
    if (tr) { tr.muted = !tr.muted; renderTracks(); agentSay(`${tr.kind} 轨已${tr.muted ? '静音' : '取消静音'}。`); }
    return;
  }
  if (/分割/.test(t)) { splitClip(); agentSay(`已在 ${S.playhead.toFixed(2)}s 分割当前片段。`); return; }
  if (/读取|EDL|结构/.test(t)) { runRead(); return; }
  agentSay(`我理解你的意思了，但这句话还没落到具体操作。现在支持：<b>去语气助词</b>、<b>开头剪掉 N 秒</b>、<b>生成 N 秒精简</b>、<b>第 N 秒加关键帧</b>、<b>删字幕</b>、<b>静音</b>、<b>撤销</b>。`);
}

function runFiller() {
  if (S.fillerCleaned) { agentSay('语气助词已经清理过了：<b>12 处</b>，节省 8.4s。画面轨下方波形里的红色斜纹就是删除位置。'); return; }
  pushHistory();
  S.fillerCleaned = true;
  renderTracks();
  agentSay(`<b>已完成语气助词清理</b><br>扫描对白转写 18 段，命中 12 处：嗯、啊、呀、呃、那个、就是说。<br>规则：只删独立语气助词，贴着语义边界切，不破坏句子；共节省 <b>8.4s</b>。
    <div class="log"><b>0:01.40</b> 嗯（老周）· 删除 0.42s<br><b>0:03.20</b> 啊（老周）· 删除 0.38s<br><b>0:07.10</b> 呃（旁白）· 删除 0.36s<br><b>0:12.40</b> 呀（老周）· 删除 0.40s<br>其余 8 处已按同规则处理</div>
    <div class="ops"><button data-quick="hl">一键生成精简</button><button data-act="undo">撤销这次清理</button></div>`);
  toast('已去除 12 处语气助词，节省 8.4s');
}
function runHighlights() {
  S.drawerTab = 'hl';
  renderDrawer();
  openDurationModal(durTarget);
  agentSay('已列出 6 个语义关键段。请先在「一键生成精简」里选目标时长，确认后再写入时间线。');
}
function applyHighlights(target = durTarget) {
  const totalTarget = normalizeTarget(target);
  pushHistory();
  S.mode = 'highlights';
  S.hlGenerated = true;
  S.hlTarget = totalTarget;
  const base = [8.6, 9.4, 11.2, 8.8, 10.6, 9.4];
  const baseTotal = base.reduce((a, b) => a + b, 0);
  const durations = base.map((d) => +(d / baseTotal * totalTarget).toFixed(1));
  const sum = durations.reduce((a, b) => a + b, 0);
  durations[durations.length - 1] = +(durations[durations.length - 1] + (totalTarget - sum)).toFixed(1);
  let cursor = 0;
  const v2 = S.tracks.find((t) => t.id === 'V2');
  v2.clips = HIGHLIGHTS.map((h, i) => {
    const dur = durations[i];
    const clip = {
      id: `v2h${i}`, start: cursor, dur, label: `${h.tag} · ${h.title}`, frames: clipFrames(h.frame, 4),
      audio: true, seed: 7 + i,
      kf: [{ id: `kh${i}`, t: Math.min(0.5, dur / 3), scale: i === 2 ? 1.14 : 1.04, x: i % 2 ? -0.03 : 0.03, y: 0 }],
    };
    cursor += dur;
    return clip;
  });
  S.duration = cursor;
  const t3 = S.tracks.find((t) => t.id === 'T3');
  let c2 = 0;
  t3.clips = HIGHLIGHTS.map((h, i) => {
    const dur = durations[i];
    const item = { id: `th${i}`, start: c2, dur: Math.max(0.8, dur - 0.4), text: h.title, frames: [h.frame] };
    c2 += dur;
    return item;
  });
  const v1 = S.tracks.find((t) => t.id === 'V1');
  v1.clips = [];
  S.tracks.forEach((t) => { t.h = t.id === 'T3' ? 50 : t.id === 'V2' ? 200 : 64; });
  S.globalH = 88;
  S.selectedClip = 'v2h0'; S.selectedKf = 'kh0'; S.playhead = 0;
  const width = $('#tlScroll').clientWidth - 176 - 28;
  S.pxPerSec = clamp(width / S.duration, 10, 110);
  closeDurationModal();
  render(); renderDrawer();
  toast(`已生成 ${totalTarget} 秒精简：6 个关键段，音画同轨`);
  agentSay(`<b>精简时间线已生成。</b><br>05:12 素材 → <b>${totalTarget} 秒</b> 成片，6 个语义关键段。<br>按规则：去语气助词、按叙事重排、音画保持同轨；画面下方直接带音频波形，可继续逐段微调。`);
}
function runRead() {
  const edl = buildEDL();
  agentSay(`<b>时间线已读取</b><br>时长 ${S.duration.toFixed(2)}s · ${edl.tracks.length} 轨 · ${edl.stats.clips} 片段 · ${edl.stats.keyframes} 个画面关键帧；音画同轨。<br>我拿到的是带语义的结构：每个片段的入出点、字幕文本、关键帧时间/缩放/位移，可直接下发剪辑操作。<div class="ops"><button data-quick="edl">查看 EDL JSON</button><button data-quick="hl">一键生成精简</button></div>`);
}
function handleQuick(q) {
  if (q === 'filler') runFiller();
  else if (q === 'hl') runHighlights();
  else if (q === 'read') runRead();
  else if (q === 'kf') { addKeyframe(); agentSay(`已在 <b>${S.playhead.toFixed(2)}s</b> 加画面关键帧，时间线上会直接出现该帧画面。`); }
  else if (q === 'edl') { S.drawerTab = 'edl'; renderDrawer(); }
}
function sendAgent() {
  const input = $('#agentInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  userSay(text);
  setTimeout(() => agentCommand(text), 320);
}

/* =============== 初始化 =============== */
function render() {
  renderAssets();
  renderTracks();
  renderRuler();
  renderInspector();
  updatePreview();
  updateTimeUI();
  updateZoomUI();
}
function bindAgent() {
  $('#fab').addEventListener('click', () => openDrawer('chat'));
  $('#drawerClose').addEventListener('click', closeDrawer);
  // 助手窗口可自由拖动
  const drawer = $('#drawer');
  $('.drawer-head', drawer).addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = drawer.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      drawer.style.left = `${clamp(ev.clientX - ox, 8, window.innerWidth - r.width - 8)}px`;
      drawer.style.top = `${clamp(ev.clientY - oy, 52, window.innerHeight - 60)}px`;
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  // 时长选择弹窗
  $('#durClose').addEventListener('click', closeDurationModal);
  $('#durCancel').addEventListener('click', closeDurationModal);
  $('#durMask').addEventListener('click', (e) => { if (e.target.id === 'durMask') closeDurationModal(); });
  $('#durPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b) return;
    durTarget = normalizeTarget(b.dataset.sec);
    updateDurationUI();
  });
  $('#durCustom').addEventListener('input', (e) => {
    durTarget = normalizeTarget(e.target.value);
    updateDurationUI();
  });
  $('#durCustom').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyHighlights(durTarget); });
  $('#durGo').addEventListener('click', () => applyHighlights(durTarget));
  $('#dTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dtab]');
    if (!b) return;
    S.drawerTab = b.dataset.dtab;
    renderDrawer();
  });
  $('#agentSend').addEventListener('click', sendAgent);
  $('#agentInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAgent(); });
  document.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) { handleQuick(q.dataset.quick); return; }
    if (e.target.closest('[data-act="undo"]')) { undo(); return; }
    if (e.target.closest('[data-act="applyhl"]')) { applyHighlights(); return; }
    if (e.target.closest('[data-copy-edl]')) {
      const json = JSON.stringify(buildEDL(), null, 2);
      navigator.clipboard?.writeText(json).then(() => toast('EDL JSON 已复制')).catch(() => toast('复制失败，请手动选择文本'));
      return;
    }
    if (e.target.closest('[data-dl-edl]')) {
      const blob = new Blob([JSON.stringify(buildEDL(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = '雨夜怀表-edl.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已下载 EDL JSON');
      return;
    }
    const hl = e.target.closest('[data-hl]');
    if (hl) {
      const h = HIGHLIGHTS.find((x) => x.id === hl.dataset.hl);
      if (h) { seek(h.start); $('#previewImg').src = FRAMES[h.frame]; toast(`定位到源素材 ${short(h.start)}`); }
    }
  });
}
window.addEventListener('resize', () => {
  const d = $('#drawer');
  if (d.style.left) d.style.left = `${clamp(parseFloat(d.style.left), 8, window.innerWidth - 480 - 8)}px`;
  if (d.style.top) d.style.top = `${clamp(parseFloat(d.style.top), 52, window.innerHeight - 60)}px`;
  renderTimeline(); renderDrawer();
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'b' || e.key === 'B') splitClip();
  if (e.key === 'q' || e.key === 'Q') { const c = selectedClip(); if (c) { pushHistory(); selectedTrack().clips = selectedTrack().clips.filter((x) => x.id !== c.id); render(); } }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
});
render();
bindTimeline();
bindActions();
bindLeftRail();
bindAgent();
initialMessages();
renderDrawer();

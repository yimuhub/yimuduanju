/**
 * HTML 动画工程模型（OpenMotion / HyperFrames 思路）
 * 一个场景 = 一段可独立预览、可寻址到任意时间点的 HTML。
 * 渲染时按 fps 逐帧 seek 并截图，再由 ffmpeg 编码成 MP4。
 */
export interface MotionScene {
  id: string;
  name: string;
  duration: number;
  /** 片段 HTML：可含 <style>、CSS 动画、WAAPI；也支持 window.__hfSeek(t) */
  html: string;
}

export interface MotionDocument {
  width: number;
  height: number;
  fps: number;
  background: string;
  scenes: MotionScene[];
}

export interface MotionProject {
  id: string;
  title: string;
  document: MotionDocument;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_MOTION_DOC: MotionDocument = {
  width: 1080,
  height: 1920,
  fps: 24,
  background: '#08090b',
  scenes: [
    {
      id: 'scene-title',
      name: '片头标题',
      duration: 3,
      html: `<div class="stage">
  <div class="glow"></div>
  <p class="eyebrow">YIMU · HTML MOTION</p>
  <h1>把网页<br><em>变成动画</em></h1>
  <p class="sub">CSS / HTML / JS · 可编辑 · 可渲染</p>
</div>
<style>
  html,body{margin:0;height:100%;background:#08090b;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
  .stage{position:relative;height:100%;display:grid;place-content:center;text-align:center;color:#f4f6f8}
  .glow{position:absolute;left:50%;top:42%;width:70%;aspect-ratio:1;translate:-50% -50%;border-radius:50%;
    background:radial-gradient(circle,#2ee6cf33,#ff403a14 45%,transparent 70%);filter:blur(18px);
    animation:breathe 3s ease-in-out infinite alternate}
  .eyebrow{font-size:16px;letter-spacing:.32em;color:#2ee6cf;margin:0 0 22px;animation:rise .8s .1s both}
  h1{font-size:92px;line-height:1.06;margin:0;font-weight:800;letter-spacing:-.04em;animation:rise .9s .2s both}
  h1 em{font-style:normal;color:#2ee6cf}
  .sub{font-size:18px;color:#8b929c;margin-top:26px;letter-spacing:.12em;animation:rise .9s .35s both}
  @keyframes rise{from{opacity:0;translate:0 34px;filter:blur(8px)}to{opacity:1;translate:0 0;filter:blur(0)}}
  @keyframes breathe{from{scale:.92;opacity:.6}to{scale:1.08;opacity:1}}
</style>`,
    },
    {
      id: 'scene-cards',
      name: '三张能力卡',
      duration: 4,
      html: `<div class="wrap">
  <h2>一套工程，三种编辑方式</h2>
  <div class="cards">
    <article><b>01</b><h3>场景卡片</h3><p>拖动排序，像剪映一样改时长。</p></article>
    <article><b>02</b><h3>代码即画面</h3><p>HTML/CSS 实时预览，所见即所得。</p></article>
    <article><b>03</b><h3>逐帧渲染</h3><p>Headless Chrome 截图，FFmpeg 编码。</p></article>
  </div>
</div>
<style>
  html,body{margin:0;height:100%;background:#0b0d10;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
  .wrap{height:100%;padding:12% 9%;display:flex;flex-direction:column;justify-content:center;gap:8%;color:#f4f6f8}
  h2{font-size:54px;line-height:1.12;margin:0;animation:in .7s both}
  .cards{display:grid;gap:18px}
  article{display:grid;grid-template-columns:52px 1fr;gap:2px 18px;padding:24px;border:1px solid #ffffff18;border-radius:18px;
    background:linear-gradient(120deg,#15191d,#0f1215);animation:in .8s both}
  article:nth-child(1){animation-delay:.1s}article:nth-child(2){animation-delay:.2s}article:nth-child(3){animation-delay:.3s}
  b{grid-row:span 2;font-size:30px;color:#2ee6cf;align-self:center}
  h3{margin:0;font-size:25px}p{margin:0;color:#8d949e;font-size:15px;line-height:1.6}
  @keyframes in{from{opacity:0;translate:0 30px}to{opacity:1;translate:0 0}}
</style>`,
    },
    {
      id: 'scene-outro',
      name: '片尾落版',
      duration: 3,
      html: `<div class="outro">
  <div class="ring"></div>
  <h2>一幕 · 神剪</h2>
  <p>HTML ANIMATION STUDIO</p>
  <span>现在，开始你的第一帧</span>
</div>
<style>
  html,body{margin:0;height:100%;background:#070809;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
  .outro{height:100%;display:grid;place-content:center;text-align:center;color:#fff;position:relative}
  .ring{position:absolute;left:50%;top:50%;width:52%;aspect-ratio:1;translate:-50% -50%;border-radius:50%;
    border:1px solid #2ee6cf55;box-shadow:0 0 60px #2ee6cf1f,inset 0 0 40px #2ee6cf12;animation:spin 6s linear infinite}
  h2{margin:0;font-size:74px;letter-spacing:-.03em;animation:in 1s .2s both}
  p{color:#2ee6cf;letter-spacing:.34em;font-size:14px;margin:18px 0 30px;animation:in 1s .4s both}
  span{color:#868d97;font-size:16px;animation:in 1s .6s both}
  @keyframes spin{to{rotate:360deg}}
  @keyframes in{from{opacity:0;translate:0 24px}to{opacity:1;translate:0 0}}
</style>`,
    },
  ],
};

/** 把场景包装成可预览 / 可逐帧 seek 的完整 HTML */
export function buildSceneDocument(scene: MotionScene, doc: MotionDocument): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${doc.background};}
*{box-sizing:border-box}</style></head><body>${scene.html}
<script>
(function(){
  function seek(t){
    var ms = Math.max(0, t) * 1000;
    if (typeof window.__hfSeek === 'function') { try { window.__hfSeek(t); } catch(e){} }
    document.getAnimations().forEach(function(a){ try { a.pause(); a.currentTime = ms; } catch(e){} });
  }
  window.__hfSeek = seek;
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'hf-seek') seek(Number(d.t) || 0);
    if (d.type === 'hf-play') {
      document.getAnimations().forEach(function(a){ try { a.play(); a.currentTime = (Number(d.t)||0)*1000; } catch(e){} });
    }
  });
  document.getAnimations().forEach(function(a){ try { a.pause(); a.currentTime = 0; } catch(e){} });
})();
</script></body></html>`;
}

/** 场景总时长 */
export function motionDuration(doc: MotionDocument): number {
  return doc.scenes.reduce((sum, s) => sum + Math.max(0.1, Number(s.duration) || 0), 0);
}

export function newScene(index: number): MotionScene {
  return {
    id: `scene-${Date.now()}-${index}`,
    name: `场景 ${index + 1}`,
    duration: 3,
    html: `<div class="scene"><h1>场景 ${index + 1}</h1><p>在这里写 HTML / CSS 动画</p></div>
<style>
html,body{margin:0;height:100%;background:#0b0d10;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
.scene{height:100%;display:grid;place-content:center;text-align:center;color:#fff}
h1{font-size:72px;margin:0;animation:in .8s both}
p{color:#8d949e;font-size:18px;margin-top:18px;animation:in .8s .2s both}
@keyframes in{from{opacity:0;translate:0 24px}to{opacity:1;translate:0 0}}
</style>`,
  };
}

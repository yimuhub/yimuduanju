#!/usr/bin/env node
/**
 * 演示数据填充脚本：为测试项目创建场景/镜头/角色/地点，
 * 让无限画布、导演台、时间线等专业功能有真实数据可看。
 * 用法：node scripts/seed-demo.js <projectId>
 */
'use strict';

const BASE = 'http://localhost:5173';

async function getCsrf() {
  const r = await fetch(`${BASE}/app/yimu/`, { redirect: 'manual' });
  const cookies = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  let token = null;
  for (const c of cookies) {
    const m = /suda-csrf-token=([^;]+)/.exec(c);
    if (m) token = decodeURIComponent(m[1]);
  }
  return token;
}

async function api(method, path, token, body) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Suda-Csrf-Token': token,
    Cookie: `suda-csrf-token=${encodeURIComponent(token)}`,
  };
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, json, text };
}

async function main() {
  const pid = process.argv[2];
  if (!pid) {
    console.error('用法: node scripts/seed-demo.js <projectId>');
    process.exit(1);
  }
  const token = await getCsrf();
  console.log('csrf token:', token ? 'ok' : 'MISSING');
  if (!token) process.exit(1);

  // ---- 地点 ----
  const locs = [];
  const locData = [
    { name: '雨夜旧书店', timeOfDay: '夜', description: '深夜小巷转角的老书店，暖黄灯光透过雨雾，木质书架散发着旧书气息。' },
    { name: '天台咖啡馆', timeOfDay: '黄昏', description: '城市高层的露天咖啡座，可以俯瞰整座城市的天际线。' },
  ];
  for (const l of locData) {
    const r = await api('POST', `/api/projects/${pid}/bible/locations`, token, l);
    console.log('location', l.name, r.status);
    if (r.json && r.json.id) locs.push(r.json);
  }

  // ---- 角色 ----
  const chars = [];
  const charData = [
    { name: '林晚', roleType: '主角', canonicalDescription: '28岁插画师，齐肩短发，气质清冷但眼底温柔。常穿米色风衣，随身带着速写本。' },
    { name: '江辰', roleType: '主角', canonicalDescription: '30岁旧书店老板，斯文儒雅，戴圆框眼镜，声音低沉，是雨夜故事的记忆承载者。' },
    { name: '苏晴', roleType: '配角', canonicalDescription: '26岁咖啡师，性格活泼开朗，是男女主重逢的见证者。' },
  ];
  for (const c of charData) {
    const r = await api('POST', `/api/projects/${pid}/bible/characters`, token, c);
    console.log('character', c.name, r.status);
    if (r.json && r.json.id) chars.push(r.json);
  }

  // ---- 场景 + 镜头 ----
  const scenes = [
    {
      title: '雨夜重逢', timeOfDay: '夜',
      summary: '大雨滂沱的深夜，插画师林晚为避雨走进旧书店，与十年未见的江辰四目相对。',
      shots: [
        { shotSize: 'long', cameraAngle: 'high', lens: '24mm', movement: 'static', action: '雨夜的街道全景，林晚撑伞匆匆跑过', dialogue: '（雨声）', emotion: '紧张' },
        { shotSize: 'medium', cameraAngle: 'eye_level', lens: '50mm', movement: 'slow_push_in', action: '旧书店暖黄灯光亮着，林晚推门而入', dialogue: '打扰了，雨太大...', emotion: '局促' },
        { shotSize: 'close_up', cameraAngle: 'eye_level', lens: '85mm', movement: 'static', action: '江辰抬头，两人对视的瞬间', dialogue: '（沉默）好久不见。', emotion: '复杂' },
      ],
    },
    {
      title: '书页间的信', timeOfDay: '夜',
      summary: '江辰从一本旧书里取出一张泛黄的信，那是林晚十年前写给他的。',
      shots: [
        { shotSize: 'medium_close_up', cameraAngle: 'over_shoulder', lens: '50mm', movement: 'static', action: '江辰的手从书架上取下一本《小王子》', dialogue: '这本书，你还记得吗？', emotion: '温柔' },
        { shotSize: 'close_up', cameraAngle: 'eye_level', lens: '100mm', movement: 'slow_push_in', action: '泛黄的信纸特写，字迹清秀', dialogue: '（无声）', emotion: '怀念' },
      ],
    },
    {
      title: '天台告别', timeOfDay: '黄昏',
      summary: '次日黄昏，两人在天台咖啡馆坦诉十年错过，约好重新开始。',
      shots: [
        { shotSize: 'wide', cameraAngle: 'high', lens: '35mm', movement: 'crane_up', action: '黄昏天台全景，两人隔桌而坐', dialogue: '这次，别再错过了。', emotion: '释然' },
        { shotSize: 'close_up', cameraAngle: 'eye_level', lens: '85mm', movement: 'static', action: '林晚含泪微笑的特写', dialogue: '嗯，重新开始。', emotion: '温暖' },
      ],
    },
  ];

  let sceneNo = 0, shotNo = 0;
  for (const s of scenes) {
    sceneNo++;
    const r = await api('POST', `/api/projects/${pid}/storyboard/scenes`, token, {
      title: s.title, timeOfDay: s.timeOfDay, summary: s.summary,
    });
    console.log('scene', s.title, r.status);
    if (!r.json || !r.json.id) continue;
    const scene = r.json;
    for (const sh of s.shots) {
      shotNo++;
      const rr = await api('POST', `/api/projects/${pid}/storyboard/shots`, token, {
        sceneId: scene.id, ...sh,
        duration: 4, characterIds: chars.length ? [chars[0].id, chars[1].id] : [],
      });
      console.log('  shot', shotNo, rr.status);
    }
  }

  console.log('--- 完成 ---');
  const chk = await api('GET', `/api/projects/${pid}/storyboard/shots`, token);
  console.log('总镜头数:', Array.isArray(chk.json) ? chk.json.length : '?');
}

main().catch((e) => { console.error(e); process.exit(1); });

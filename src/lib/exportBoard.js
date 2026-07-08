// 把整个图板（图片+方框+文字）合成一张 PNG 并保存
// 总览右键导出、画布内工具列导出共用

const DEFAULT_W = 280;
const GAP = 24;

const aspectOf = (it) => (it.width && it.height ? it.width / it.height : 4 / 3);
const itemH = (it) => (it.w || DEFAULT_W) / aspectOf(it);
const origUrl = (it) => `reflib://orig/${it.file_path.replace(/\\/g, '/')}`;

const styleOf = (w) => { try { return w.style ? JSON.parse(w.style) : {}; } catch (_) { return {}; } };

export async function exportBoardImage(rawItems, widgets, name, showToast) {
  // 从未在画布摆放过的图（坐标为空）自动网格排布
  let col = 0, row = 0;
  const items = rawItems.map((a) => {
    const it = { ...a };
    if (it.x == null || it.y == null) {
      it.x = col * (DEFAULT_W + GAP);
      it.y = row * 240;
      it.w = DEFAULT_W;
      col++; if (col >= 4) { col = 0; row++; }
    }
    if (!it.w) it.w = DEFAULT_W;
    return it;
  });

  const rects = [
    ...items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemH(i) })),
    ...widgets.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
  ];
  if (!rects.length) { showToast?.('图板是空的'); return; }
  showToast?.('正在合成 PNG…');

  const PAD = 48;
  const bx = Math.min(...rects.map((r) => r.x)) - PAD;
  const by = Math.min(...rects.map((r) => r.y)) - PAD;
  const bw = Math.max(...rects.map((r) => r.x + r.w)) - bx + PAD;
  const bh = Math.max(...rects.map((r) => r.y + r.h)) - by + PAD;
  const s = Math.min(1.5, 6000 / Math.max(bw, bh));

  const cv = document.createElement('canvas');
  cv.width = Math.round(bw * s);
  cv.height = Math.round(bh * s);
  const ctx = cv.getContext('2d');
  ctx.scale(s, s);
  ctx.translate(-bx, -by);
  ctx.fillStyle = '#f6faf7';
  ctx.fillRect(bx, by, bw, bh);

  for (const w of widgets.filter((x) => x.kind === 'box')) {
    ctx.save();
    ctx.strokeStyle = 'rgba(47,174,158,0.6)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(69,196,180,0.06)';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    const st = styleOf(w);
    ctx.setLineDash([]);
    ctx.fillStyle = st.color || '#2fae9e';
    ctx.font = `${st.bold ? '700' : '600'} ${st.size || 14}px ${st.font || 'Microsoft YaHei'}`;
    ctx.fillText(w.content || '', w.x + 12, w.y - 8);
    ctx.restore();
  }

  let drawn = 0;
  for (const it of [...items].sort((a, b) => (a.z || 0) - (b.z || 0))) {
    let bm = null;
    try {
      const resp = await fetch(origUrl(it));
      bm = await createImageBitmap(await resp.blob());
    } catch (_) {
      // 原图读不到就退回缩略图
      try {
        if (it.thumb_path) {
          const resp = await fetch(`reflib://thumb/${it.thumb_path.replace(/\\/g, '/')}`);
          bm = await createImageBitmap(await resp.blob());
        }
      } catch (_) {}
    }
    if (!bm) continue;
    const h = itemH(it);
    ctx.save();
    // 以中心为基准做旋转/镜像，与画布显示一致
    ctx.translate(it.x + it.w / 2, it.y + h / 2);
    if (it.rot) ctx.rotate((it.rot * Math.PI) / 180);
    if (it.flip) ctx.scale(-1, 1);
    ctx.drawImage(bm, -it.w / 2, -h / 2, it.w, h);
    ctx.restore();
    drawn++;
  }
  if (items.length && !drawn) {
    showToast?.('⚠ 图片未能渲染进导出图，请反馈');
    return;
  }

  for (const w of widgets.filter((x) => x.kind === 'text')) {
    const st = styleOf(w);
    ctx.fillStyle = st.color || '#29443d';
    const size = st.size || 15;
    ctx.font = `${st.italic ? 'italic ' : ''}${st.bold ? '700' : '400'} ${size}px ${st.font || 'Microsoft YaHei'}`;
    (w.content || '').split('\n').forEach((line, i) => ctx.fillText(line, w.x + 12, w.y + 20 + i * size * 1.5));
  }

  const res = await window.refhub.saveBoardPng(cv.toDataURL('image/png'), name);
  if (res.ok) showToast?.(`已导出：${res.path}`);
}

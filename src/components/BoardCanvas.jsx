import React, { useState, useEffect, useRef, useCallback } from 'react';
import { thumbUrl } from './Library.jsx';
import { exportBoardImage } from '../lib/exportBoard.js';
import { t } from '../lib/i18n.js';

const DEFAULT_W = 280;
const GAP = 18;

const aspectOf = (it) => (it.width && it.height ? it.width / it.height : 4 / 3);
const itemH = (it) => (it.w || DEFAULT_W) / aspectOf(it);
const origUrl = (it) => `reflib://orig/${it.file_path.replace(/\\/g, '/')}`;
const keyOf = (kind, id) => `${kind}:${id}`;

export default function BoardCanvas({ boardId, boardName, assets, onOpenAsset, showToast, onAskAI, onSendToAi }) {
  const wrapRef = useRef(null);
  const [items, setItems] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [vp, setVp] = useState({ tx: 60, ty: 60, scale: 1 });
  const [selection, setSelection] = useState([]); // ['asset:id', 'widget:3']
  const [editing, setEditing] = useState(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState(null);   // {x,y,w,h} 世界坐标（box:true = 正在框选画方框）
  const [boxDraw, setBoxDraw] = useState(false);  // 框选画方框模式：下一次拖拽的范围即新方框
  const [guides, setGuides] = useState([]);       // [{axis:'v'|'h', pos}]
  const [menu, setMenu] = useState(null);         // {sx, sy, wx, wy}
  const [drawer, setDrawer] = useState(false);    // 素材库抽屉
  const [drawerQ, setDrawerQ] = useState('');
  const [drawerAssets, setDrawerAssets] = useState([]);
  const drag = useRef(null);
  const tapRef = useRef({ key: null, t: 0 }); // 手动双击检测（指针捕获吞掉原生 dblclick）
  const selSet = new Set(selection);

  // ---------- 撤销（Ctrl+Z，最近 60 步） ----------

  const undoRef = useRef([]);
  const pushUndo = (fn) => {
    undoRef.current.push(fn);
    if (undoRef.current.length > 60) undoRef.current.shift();
  };
  const undo = async () => {
    const fn = undoRef.current.pop();
    if (!fn) { showToast?.(t('没有可撤销的操作')); return; }
    await fn();
  };
  // 记录一批图片的几何/状态快照，撤销时恢复
  const snapshotItems = (ids) => items
    .filter((i) => ids.includes(i.item_id))
    .map((i) => ({ item_id: i.item_id, x: i.x, y: i.y, w: i.w, z: i.z, locked: i.locked, flip: i.flip, rot: i.rot }));
  const pushItemsRestore = (snap) => {
    if (!snap.length) return;
    pushUndo(() => {
      setItems((prev) => prev.map((i) => {
        const s = snap.find((s) => s.item_id === i.item_id);
        if (!s) return i;
        const u = { ...i, ...s };
        persistItem(u);
        return u;
      }));
    });
  };

  useEffect(() => {
    if (!drawer) return;
    const t = setTimeout(() => {
      window.refhub.listAssets({ search: drawerQ || undefined, limit: 80 }).then(setDrawerAssets);
    }, 180);
    return () => clearTimeout(t);
  }, [drawer, drawerQ]);

  // ---------- 数据加载 ----------

  useEffect(() => {
    let col = 0, row = 0, maxZ = 0;
    const laid = assets.map((a) => { maxZ = Math.max(maxZ, a.z || 0); return { ...a }; }).map((a) => {
      if (a.x == null || a.y == null) {
        a.x = col * (DEFAULT_W + 24); a.y = row * 240; a.w = DEFAULT_W; a.z = ++maxZ;
        col++; if (col >= 4) { col = 0; row++; }
        window.refhub.updateBoardItem(a.item_id, { x: a.x, y: a.y, w: a.w, z: a.z });
      }
      if (!a.w) a.w = DEFAULT_W;
      return a;
    });
    setItems(laid);
  }, [assets, boardId]);

  useEffect(() => {
    window.refhub.boardWidgets(boardId).then(setWidgets);
    setSelection([]); setEditing(null); setMenu(null);
    // 换图板必须清空：剪贴的项 id 和撤销栈都只对原图板有效
    clipRef.current = [];
    undoRef.current = [];
    // 视口适配标记也要复位：原位切换图板时按新图板内容重新适应视图
    fitted.current = false;
  }, [boardId]);

  const persistItem = useCallback((it) => {
    window.refhub.updateBoardItem(it.item_id, { x: it.x, y: it.y, w: it.w, z: it.z || 0, locked: it.locked ? 1 : 0, flip: it.flip ? 1 : 0, rot: it.rot || 0 });
  }, []);
  const persistWidget = useCallback((w) => {
    window.refhub.updateBoardWidget(w.id, { x: w.x, y: w.y, w: w.w, h: w.h, z: w.z || 0 });
  }, []);

  // ---------- 视图 ----------

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setVp((v) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.min(4, Math.max(0.08, v.scale * factor));
      return { scale, tx: mx - (mx - v.tx) * (scale / v.scale), ty: my - (my - v.ty) * (scale / v.scale) };
    });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const allRects = () => [
    ...items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemH(i) })),
    ...widgets.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
  ];

  const fitTo = (rects) => {
    if (!rects.length || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const bx = Math.min(...rects.map((b) => b.x)), by = Math.min(...rects.map((b) => b.y));
    const bw = Math.max(...rects.map((b) => b.x + b.w)) - bx, bh = Math.max(...rects.map((b) => b.y + b.h)) - by;
    const scale = Math.min(2, Math.min(rect.width / bw, rect.height / bh) * 0.88);
    setVp({ scale, tx: (rect.width - bw * scale) / 2 - bx * scale, ty: (rect.height - bh * scale) / 2 - by * scale });
  };
  const fitView = () => {
    const selRects = selectedAssets().map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemH(i) }));
    fitTo(selRects.length ? selRects : allRects());
  };
  const zoomBy = (f) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setVp((v) => {
      const scale = Math.min(4, Math.max(0.08, v.scale * f));
      return { scale, tx: cx - (cx - v.tx) * (scale / v.scale), ty: cy - (cy - v.ty) * (scale / v.scale) };
    });
  };
  const zoom100 = () => {
    const rect = wrapRef.current.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setVp((v) => ({ scale: 1, tx: cx - (cx - v.tx) / v.scale, ty: cy - (cy - v.ty) / v.scale }));
  };

  const fitted = useRef(false);
  useEffect(() => {
    if ((items.length || widgets.length) && !fitted.current) { fitted.current = true; setTimeout(() => fitTo(allRects()), 50); }
  }, [items, widgets]);

  const toWorld = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - vp.tx) / vp.scale, y: (clientY - rect.top - vp.ty) / vp.scale };
  };

  // ---------- 选择 ----------

  const selectedAssets = () => items.filter((i) => selSet.has(keyOf('asset', i.item_id)));
  const selectedWidgets = () => widgets.filter((w) => selSet.has(keyOf('widget', w.id)));
  const selectAll = () => setSelection([
    ...items.map((i) => keyOf('asset', i.item_id)),
    ...widgets.map((w) => keyOf('widget', w.id)),
  ]);

  // ---------- 拖动 / 框选 / 平移 ----------

  const buildMoveSet = (keys) => {
    const set = new Map();
    for (const k of keys) {
      const [kind, id] = k.split(':');
      if (kind === 'asset') {
        const it = items.find((i) => String(i.item_id) === id);
        if (it && !it.locked) set.set(k, { kind, id: it.item_id, ox: it.x, oy: it.y });
      } else {
        const w = widgets.find((x) => String(x.id) === id);
        if (!w) continue;
        set.set(k, { kind, id: w.id, ox: w.x, oy: w.y });
        if (w.kind === 'box') {
          for (const i of items) {
            if (i.locked) continue;
            const cx = i.x + i.w / 2, cy = i.y + itemH(i) / 2;
            if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
              set.set(keyOf('asset', i.item_id), { kind: 'asset', id: i.item_id, ox: i.x, oy: i.y });
            }
          }
        }
      }
    }
    return [...set.values()];
  };

  const startMove = async (e, target, kind) => {
    if (editing || e.button !== 0 || spaceHeld) return;
    e.stopPropagation();
    setMenu(null);
    // 画方框模式：在图片上按下也算开始框选（方框常常要圈住已有的图）
    if (boxDraw) {
      drag.current = { type: 'boxdraw', start: toWorld(e.clientX, e.clientY) };
      wrapRef.current.setPointerCapture(e.pointerId);
      return;
    }
    const targetId = kind === 'asset' ? target.item_id : target.id;
    const key = keyOf(kind, targetId);
    // 手动双击检测：拖拽用的指针捕获会把原生 dblclick 改派给画布，
    // 方框/文字双击改名、图片双击开详情都收不到，这里自己判
    const now = Date.now();
    const prevTap = tapRef.current;
    tapRef.current = { key, t: now };
    if (prevTap.key === key && now - prevTap.t < 350 && kind === 'asset') {
      tapRef.current = { key: null, t: 0 };
      onOpenAsset(target, items);
      return;
    }
    // Alt+左键拖 = 先落一份副本，拖走的是副本（原图不动）
    if (e.altKey) {
      if (kind !== 'asset') return;
      const { clientX, clientY, pointerId } = e;
      // 同步占位 + 立刻捕获指针：await 期间松开鼠标也能收到 pointerup，
      // 避免"幽灵拖拽"和悄悄叠在原图下面的隐形副本
      const pending = { type: 'altcopy-pending', cancelled: false };
      drag.current = pending;
      try { wrapRef.current.setPointerCapture(pointerId); } catch (_) {}
      const baseKeys = selSet.has(key) ? selection : [key];
      const srcIds = items.filter((i) => baseKeys.includes(keyOf('asset', i.item_id))).map((i) => i.item_id);
      const created = [];
      let grabbedCopy = null;
      for (const id of srcIds) {
        const row = await window.refhub.duplicateBoardItem(id, 0, 0);
        if (row) { created.push(row); if (id === target.item_id) grabbedCopy = row; }
      }
      if (!created.length) { if (drag.current === pending) drag.current = null; return; }
      if (pending.cancelled) {
        // 副本还没上屏鼠标就松开了：直接撤销这批插入
        for (const r of created) window.refhub.removeFromBoard(r.item_id);
        return;
      }
      setItems((prev) => [...prev, ...created]);
      setSelection(created.map((r) => keyOf('asset', r.item_id)));
      const g = grabbedCopy || created[0];
      drag.current = {
        type: 'move', sx: clientX, sy: clientY, altCopy: true,
        moveSet: created.map((r) => ({ kind: 'asset', id: r.item_id, ox: r.x, oy: r.y })),
        grabbed: { x: g.x, y: g.y, w: g.w, h: itemH(g) },
        grabbedKey: keyOf('asset', g.item_id),
      };
      return;
    }
    let nextSel = selection;
    if (e.ctrlKey || e.metaKey) {
      nextSel = selSet.has(key) ? selection.filter((k) => k !== key) : [...selection, key];
      setSelection(nextSel);
      return; // Ctrl 点选不进入拖动
    }
    if (!selSet.has(key)) { nextSel = [key]; setSelection(nextSel); }
    if (kind === 'asset' && target.locked) return; // 锁定的只能选中
    const grabbed = { x: target.x, y: target.y, w: kind === 'asset' ? target.w : target.w, h: kind === 'asset' ? itemH(target) : target.h };
    drag.current = { type: 'move', sx: e.clientX, sy: e.clientY, moveSet: buildMoveSet(nextSel), grabbed, grabbedKey: key };
    wrapRef.current.setPointerCapture(e.pointerId);
  };

  const startResize = (e, target, kind) => {
    if (e.button !== 0 || (kind === 'asset' && target.locked)) return;
    e.stopPropagation();
    const targetId = kind === 'asset' ? target.item_id : target.id;
    setSelection([keyOf(kind, targetId)]);
    drag.current = { type: 'resize', kind, id: targetId, sx: e.clientX, sy: e.clientY, ow: target.w, oh: target.h };
    wrapRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e) => {
    wrapRef.current.focus();
    setMenu(null);
    if (e.button === 1 || spaceHeld) {
      setPanning(true);
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: vp.tx, ty: vp.ty };
      wrapRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (boxDraw && (e.target === wrapRef.current || e.target.classList.contains('canvas-stage'))) {
      drag.current = { type: 'boxdraw', start: toWorld(e.clientX, e.clientY) };
      wrapRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (e.target === wrapRef.current || e.target.classList.contains('canvas-stage')) {
      if (!e.ctrlKey && !e.metaKey) setSelection([]);
      setEditing(null);
      const p = toWorld(e.clientX, e.clientY);
      drag.current = { type: 'marquee', start: p, ctrl: e.ctrlKey || e.metaKey, base: selection };
      wrapRef.current.setPointerCapture(e.pointerId);
    }
  };

  // 吸附：拖动主体的边/中线贴近静止对象的边/中线时校正 delta 并显示参考线
  const applySnap = (d, nx, ny) => {
    const thr = 8 / vp.scale;
    const movingKeys = new Set(d.moveSet.map((m) => keyOf(m.kind, m.id)));
    const statics = [
      ...items.filter((i) => !movingKeys.has(keyOf('asset', i.item_id))).map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemH(i) })),
      ...widgets.filter((w) => !movingKeys.has(keyOf('widget', w.id))).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
    ];
    const g = [];
    let ax = 0, ay = 0, bestX = thr, bestY = thr;
    const mxs = [nx, nx + d.grabbed.w / 2, nx + d.grabbed.w];
    const mys = [ny, ny + d.grabbed.h / 2, ny + d.grabbed.h];
    for (const s of statics) {
      for (const sx of [s.x, s.x + s.w / 2, s.x + s.w]) {
        for (const mx of mxs) {
          const diff = sx - mx;
          if (Math.abs(diff) < bestX) { bestX = Math.abs(diff); ax = diff; g[0] = { axis: 'v', pos: sx }; }
        }
      }
      for (const sy of [s.y, s.y + s.h / 2, s.y + s.h]) {
        for (const my of mys) {
          const diff = sy - my;
          if (Math.abs(diff) < bestY) { bestY = Math.abs(diff); ay = diff; g[1] = { axis: 'h', pos: sy }; }
        }
      }
    }
    setGuides(g.filter(Boolean));
    return { ax, ay };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.type === 'altcopy-pending') return;
    if (d.type === 'pan') {
      setVp((v) => ({ ...v, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }));
      return;
    }
    if (d.type === 'marquee' || d.type === 'boxdraw') {
      const p = toWorld(e.clientX, e.clientY);
      setMarquee({
        x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y),
        box: d.type === 'boxdraw',
      });
      return;
    }
    const dx = (e.clientX - d.sx) / vp.scale, dy = (e.clientY - d.sy) / vp.scale;
    if (d.type === 'move') {
      const grabbedOrigin = d.moveSet.find((m) => keyOf(m.kind, m.id) === d.grabbedKey);
      const { ax, ay } = grabbedOrigin
        ? applySnap(d, grabbedOrigin.ox + dx, grabbedOrigin.oy + dy)
        : { ax: 0, ay: 0 };
      const fx = dx + ax, fy = dy + ay;
      setItems((prev) => prev.map((i) => {
        const m = d.moveSet.find((m) => m.kind === 'asset' && m.id === i.item_id);
        return m ? { ...i, x: m.ox + fx, y: m.oy + fy } : i;
      }));
      setWidgets((prev) => prev.map((w) => {
        const m = d.moveSet.find((m) => m.kind === 'widget' && m.id === w.id);
        return m ? { ...w, x: m.ox + fx, y: m.oy + fy } : w;
      }));
    } else if (d.type === 'resize') {
      if (d.kind === 'asset') {
        setItems((prev) => prev.map((i) => i.item_id === d.id ? { ...i, w: Math.max(60, d.ow + dx) } : i));
      } else {
        setWidgets((prev) => prev.map((w) => w.id === d.id
          ? { ...w, w: Math.max(80, d.ow + dx), h: Math.max(40, d.oh + dy) } : w));
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    setGuides([]);
    if (!d) return;
    if (d.type === 'altcopy-pending') { d.cancelled = true; return; }
    if (d.type === 'boxdraw') {
      const m = marquee;
      setMarquee(null);
      setBoxDraw(false);
      if (m && m.w > 24 && m.h > 24) {
        (async () => {
          const w = await window.refhub.addBoardWidget(boardId, { kind: 'box', x: m.x, y: m.y, w: m.w, h: m.h, z: 0 });
          setWidgets((prev) => [...prev, w]);
          setSelection([keyOf('widget', w.id)]);
          setEditing(w.id);
          pushUndo(() => {
            window.refhub.deleteBoardWidget(w.id);
            setWidgets((prev) => prev.filter((x) => x.id !== w.id));
          });
        })();
      }
      return;
    }
    if (d.type === 'marquee') {
      if (marquee && (marquee.w > 4 || marquee.h > 4)) {
        const hit = [];
        for (const i of items) {
          if (i.x < marquee.x + marquee.w && i.x + i.w > marquee.x && i.y < marquee.y + marquee.h && i.y + itemH(i) > marquee.y) {
            hit.push(keyOf('asset', i.item_id));
          }
        }
        for (const w of widgets) {
          if (w.x < marquee.x + marquee.w && w.x + w.w > marquee.x && w.y < marquee.y + marquee.h && w.y + w.h > marquee.y) {
            hit.push(keyOf('widget', w.id));
          }
        }
        setSelection(d.ctrl ? [...new Set([...d.base, ...hit])] : hit);
      }
      setMarquee(null);
      return;
    }
    if (d.type === 'move') {
      // Alt+单击没实际拖动：撤销刚落下的副本，避免原地叠一张看不见的
      if (d.altCopy) {
        const first = d.moveSet[0];
        const cur = items.find((i) => i.item_id === first.id);
        const moved = cur && (Math.abs(cur.x - first.ox) > 3 || Math.abs(cur.y - first.oy) > 3);
        if (!moved) {
          const ids = new Set(d.moveSet.map((m) => m.id));
          for (const id of ids) window.refhub.removeFromBoard(id);
          setItems((prev) => prev.filter((i) => !ids.has(i.item_id)));
          setSelection([]);
          return;
        }
      }
      // 记录撤销：Alt 副本拖动撤销 = 整批删掉；普通移动撤销 = 回到原位
      const ms = d.moveSet.map((m) => ({ ...m }));
      const f0 = ms[0];
      const cur0 = f0 && (f0.kind === 'asset'
        ? items.find((i) => i.item_id === f0.id)
        : widgets.find((w) => w.id === f0.id));
      if (cur0 && (Math.abs(cur0.x - f0.ox) > 0.5 || Math.abs(cur0.y - f0.oy) > 0.5)) {
        if (d.altCopy) {
          const ids = ms.map((m) => m.id);
          pushUndo(() => {
            for (const id of ids) window.refhub.removeFromBoard(id);
            setItems((prev) => prev.filter((i) => !ids.includes(i.item_id)));
          });
        } else {
          pushUndo(() => {
            setItems((prev) => prev.map((i) => { const m = ms.find((m) => m.kind === 'asset' && m.id === i.item_id); if (!m) return i; const u = { ...i, x: m.ox, y: m.oy }; persistItem(u); return u; }));
            setWidgets((prev) => prev.map((w) => { const m = ms.find((m) => m.kind === 'widget' && m.id === w.id); if (!m) return w; const u = { ...w, x: m.ox, y: m.oy }; persistWidget(u); return u; }));
          });
        }
      }
      setItems((prev) => { for (const m of d.moveSet) if (m.kind === 'asset') { const it = prev.find((i) => i.item_id === m.id); if (it) persistItem(it); } return prev; });
      setWidgets((prev) => { for (const m of d.moveSet) if (m.kind === 'widget') { const w = prev.find((x) => x.id === m.id); if (w) persistWidget(w); } return prev; });
    } else if (d.type === 'resize') {
      const { kind: rk, id: rid, ow, oh } = d;
      const curR = rk === 'asset' ? items.find((i) => i.item_id === rid) : widgets.find((w) => w.id === rid);
      if (curR && (Math.abs(curR.w - ow) > 0.5 || (rk !== 'asset' && Math.abs((curR.h ?? 0) - oh) > 0.5))) {
        pushUndo(() => {
          if (rk === 'asset') setItems((prev) => prev.map((i) => i.item_id === rid ? (() => { const u = { ...i, w: ow }; persistItem(u); return u; })() : i));
          else setWidgets((prev) => prev.map((w) => w.id === rid ? (() => { const u = { ...w, w: ow, h: oh }; persistWidget(u); return u; })() : w));
        });
      }
      if (d.kind === 'asset') setItems((prev) => { const it = prev.find((i) => i.item_id === d.id); if (it) persistItem(it); return prev; });
      else setWidgets((prev) => { const w = prev.find((x) => x.id === d.id); if (w) persistWidget(w); return prev; });
    }
  };

  // ---------- 编辑操作（右键菜单 + 快捷键共用） ----------

  const maxZ = () => Math.max(0, ...items.map((i) => i.z || 0));

  const addTextAt = async (p) => {
    const w = await window.refhub.addBoardWidget(boardId, { kind: 'text', x: p.x - 110, y: p.y - 20, w: 220, h: 44, z: 100 });
    setWidgets((prev) => [...prev, w]);
    setSelection([keyOf('widget', w.id)]);
    setEditing(w.id);
    pushUndo(() => {
      window.refhub.deleteBoardWidget(w.id);
      setWidgets((prev) => prev.filter((x) => x.id !== w.id));
    });
  };
  // 进入画方框模式：下一次拖拽框选的范围 = 新方框的位置和大小
  const startBoxDraw = () => {
    setBoxDraw(true);
    showToast?.(t('拖拽框选出方框的位置和大小，Esc 取消'));
  };

  const placeAsset = async (asset, p) => {
    const row = await window.refhub.addToBoard(boardId, asset.id);
    if (!row) return;
    if (items.some((i) => i.item_id === row.item_id)) return; // 已在画布上（保持幂等，复制副本走 Ctrl+C/V 或 Alt 拖）
    const w = DEFAULT_W;
    const it = { ...row, x: p.x - w / 2, y: p.y - w / aspectOf(row) / 2, w, z: maxZ() + 1 };
    await window.refhub.updateBoardItem(it.item_id, { x: it.x, y: it.y, w: it.w, z: it.z });
    setItems((prev) => (prev.some((i) => i.item_id === it.item_id) ? prev : [...prev, it]));
    pushUndo(() => {
      window.refhub.removeFromBoard(it.item_id);
      setItems((prev) => prev.filter((i) => i.item_id !== it.item_id));
    });
  };

  // ---------- 画布内复制粘贴（副本 = 同一张图的新实例，位置/大小/旋转独立） ----------

  const clipRef = useRef([]); // 已复制的图板项 id
  const copySelection = () => {
    const ids = selectedAssets().map((i) => i.item_id);
    if (!ids.length) return false;
    clipRef.current = ids;
    showToast?.(t('已复制 {n} 张，Ctrl+V 粘贴副本', { n: ids.length }));
    return true;
  };
  const pasteCopies = async () => {
    if (!clipRef.current.length) return false;
    // 并发发起（主进程仍按序处理，z 顺序不乱），几十张时明显更快
    const created = (await Promise.all(
      clipRef.current.map((id) => window.refhub.duplicateBoardItem(id, 28, 28))
    )).filter(Boolean);
    if (!created.length) { clipRef.current = []; return false; }
    setItems((prev) => [...prev, ...created]);
    setSelection(created.map((r) => keyOf('asset', r.item_id)));
    clipRef.current = created.map((r) => r.item_id); // 连续粘贴逐次错开
    const ids = created.map((r) => r.item_id);
    pushUndo(() => {
      for (const id of ids) window.refhub.removeFromBoard(id);
      setItems((prev) => prev.filter((i) => !ids.includes(i.item_id)));
    });
    return true;
  };
  const duplicateSel = async () => {
    const ids = selectedAssets().map((i) => i.item_id);
    if (!ids.length) return;
    const created = (await Promise.all(
      ids.map((id) => window.refhub.duplicateBoardItem(id, 28, 28))
    )).filter(Boolean);
    if (!created.length) return;
    setItems((prev) => [...prev, ...created]);
    setSelection(created.map((r) => keyOf('asset', r.item_id)));
    const newIds = created.map((r) => r.item_id);
    pushUndo(() => {
      for (const id of newIds) window.refhub.removeFromBoard(id);
      setItems((prev) => prev.filter((i) => !newIds.includes(i.item_id)));
    });
  };

  const doPaste = async (p) => {
    const pos = p || toWorldCenter();
    const res = await window.refhub.pasteImage();
    if (!res.ok) { showToast?.(`⚠ ${res.error}`); return; }
    await placeAsset(res.asset, pos);
    showToast?.(t('已粘贴入库并放到画布'));
  };
  const toWorldCenter = () => {
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: (rect.width / 2 - vp.tx) / vp.scale, y: (rect.height / 2 - vp.ty) / vp.scale };
  };

  const deleteSelection = async () => {
    const removedItems = selectedAssets().map((i) => ({ ...i }));
    const removedWidgets = selectedWidgets().map((w) => ({ ...w }));
    for (const it of removedItems) {
      await window.refhub.removeFromBoard(it.item_id);
    }
    for (const w of removedWidgets) {
      await window.refhub.deleteBoardWidget(w.id);
    }
    const aIds = new Set(removedItems.map((i) => i.item_id));
    const wIds = new Set(removedWidgets.map((w) => w.id));
    setItems((prev) => prev.filter((i) => !aIds.has(i.item_id)));
    setWidgets((prev) => prev.filter((w) => !wIds.has(w.id)));
    if (aIds.size) showToast?.(t('已移出图板（素材库仍保留）· Ctrl+Z 可撤销'));
    setSelection([]);
    if (removedItems.length || removedWidgets.length) {
      pushUndo(async () => {
        const restored = [];
        for (const row of removedItems) {
          const r = await window.refhub.restoreBoardItem(boardId, row.id, {
            x: row.x, y: row.y, w: row.w, z: row.z, locked: row.locked, flip: row.flip, rot: row.rot,
          });
          if (r) restored.push(r);
        }
        if (restored.length) setItems((prev) => [...prev, ...restored]);
        for (const w of removedWidgets) {
          const nw = await window.refhub.addBoardWidget(boardId, { kind: w.kind, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z || 0 });
          if (nw) {
            const patched = await window.refhub.updateBoardWidget(nw.id, { content: w.content || '', style: w.style || null });
            setWidgets((prev) => [...prev, patched || nw]);
          }
        }
      });
    }
  };

  const toFront = () => {
    let z = maxZ();
    setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) ? (() => { const u = { ...i, z: ++z }; persistItem(u); return u; })() : i));
  };
  const toBack = () => {
    let z = Math.min(0, ...items.map((i) => i.z || 0));
    setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) ? (() => { const u = { ...i, z: --z }; persistItem(u); return u; })() : i));
  };
  const flipSel = () => {
    pushItemsRestore(snapshotItems(selectedAssets().map((i) => i.item_id)));
    setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) ? (() => { const u = { ...i, flip: i.flip ? 0 : 1 }; persistItem(u); return u; })() : i));
  };
  const rotateSel = (deg) => {
    pushItemsRestore(snapshotItems(selectedAssets().map((i) => i.item_id)));
    setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) ? (() => { const u = { ...i, rot: ((((i.rot || 0) + deg) % 360) + 360) % 360 }; persistItem(u); return u; })() : i));
  };
  const lockSel = () => {
    const anyUnlocked = selectedAssets().some((i) => !i.locked);
    setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) ? (() => { const u = { ...i, locked: anyUnlocked ? 1 : 0 }; persistItem(u); return u; })() : i));
  };

  const alignSel = (op) => {
    const sel = selectedAssets();
    if (sel.length < 2) return;
    const bx = Math.min(...sel.map((i) => i.x)), by = Math.min(...sel.map((i) => i.y));
    const bx2 = Math.max(...sel.map((i) => i.x + i.w)), by2 = Math.max(...sel.map((i) => i.y + itemH(i)));
    setItems((prev) => prev.map((i) => {
      if (!selSet.has(keyOf('asset', i.item_id))) return i;
      const h = itemH(i);
      const u = { ...i };
      if (op === 'left') u.x = bx;
      if (op === 'right') u.x = bx2 - i.w;
      if (op === 'top') u.y = by;
      if (op === 'bottom') u.y = by2 - h;
      if (op === 'centerH') u.x = (bx + bx2) / 2 - i.w / 2;
      if (op === 'centerV') u.y = (by + by2) / 2 - h / 2;
      persistItem(u);
      return u;
    }));
  };

  const equalize = (mode) => {
    const sel = selectedAssets();
    if (sel.length < 2) return;
    const anchor = sel[0];
    setItems((prev) => prev.map((i) => {
      if (!selSet.has(keyOf('asset', i.item_id))) return i;
      const u = { ...i, w: mode === 'width' ? anchor.w : itemH(anchor) * aspectOf(i) };
      persistItem(u);
      return u;
    }));
  };

  const pack = (targets) => {
    if (targets.length < 2) return;
    const sorted = [...targets].sort((a, b) => itemH(b) - itemH(a));
    const totalArea = sorted.reduce((s, i) => s + i.w * itemH(i), 0);
    const rowLimit = Math.max(900, Math.sqrt(totalArea) * 1.35);
    const bx = Math.min(...targets.map((i) => i.x)), by = Math.min(...targets.map((i) => i.y));
    let x = bx, y = by, rowH = 0;
    const pos = new Map();
    for (const it of sorted) {
      if (x > bx && x + it.w > bx + rowLimit) { x = bx; y += rowH + GAP; rowH = 0; }
      pos.set(it.item_id, { x, y });
      x += it.w + GAP;
      rowH = Math.max(rowH, itemH(it));
    }
    setItems((prev) => prev.map((i) => {
      const p = pos.get(i.item_id);
      if (!p) return i;
      const u = { ...i, x: p.x, y: p.y };
      persistItem(u);
      return u;
    }));
  };

  const exportPng = () => exportBoardImage(items, widgets, boardName, showToast);

  // ---------- 键盘 ----------

  const onKeyDown = (e) => {
    if (editing) return;
    if (e.key === 'Tab') { e.preventDefault(); setDrawer((v) => !v); return; }
    if (e.key === 'Alt') { e.preventDefault(); return; } // 防止 Alt 聚焦系统菜单，Alt+拖图出副本
    if (e.key === ' ') { e.preventDefault(); setSpaceHeld(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { if (copySelection()) e.preventDefault(); return; }
    // Ctrl+V：先粘贴画布内复制的副本，没有的话回落到系统剪贴板图片
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteCopies().then((ok) => { if (!ok) doPaste(); }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoom100(); return; }
    if (e.key.toLowerCase() === 'f') { fitView(); return; }
    if (e.key.toLowerCase() === 'r' && selection.length) { e.preventDefault(); rotateSel(e.shiftKey ? -90 : 90); return; }
    if (e.key === 'Escape') { setSelection([]); setMenu(null); setBoxDraw(false); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); deleteSelection(); return; }
    if (e.key.startsWith('Arrow') && selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setItems((prev) => prev.map((i) => selSet.has(keyOf('asset', i.item_id)) && !i.locked ? (() => { const u = { ...i, x: i.x + dx, y: i.y + dy }; persistItem(u); return u; })() : i));
      setWidgets((prev) => prev.map((w) => selSet.has(keyOf('widget', w.id)) ? (() => { const u = { ...w, x: w.x + dx, y: w.y + dy }; persistWidget(u); return u; })() : w));
    }
  };
  const onKeyUp = (e) => {
    if (e.key === ' ') setSpaceHeld(false);
  };

  // ---------- 外部图片拖入 ----------

  const onDrop = async (e) => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    // 从素材库抽屉拖进来的图
    const assetId = e.dataTransfer.getData('text/asset-id');
    if (assetId) {
      const asset = await window.refhub.getAsset(assetId);
      if (asset) await placeAsset(asset, p);
      return;
    }
    if (e.dataTransfer.files?.length) {
      let off = 0;
      for (const f of e.dataTransfer.files) {
        const fp = window.refhub.getFilePath(f);
        if (!fp) continue;
        const res = await window.refhub.importFile(fp);
        if (res.ok) { await placeAsset(res.asset, { x: p.x + off, y: p.y + off }); off += 36; }
        else showToast?.(`⚠ ${res.error}`);
      }
      return;
    }
    // 网页拖图：优先从 text/html 里抠真正的 <img> 地址（uri-list 常是页面链接）
    const html = e.dataTransfer.getData('text/html');
    const im = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const url = im ? im[1].replace(/&amp;/g, '&')
      : (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim().split('\n')[0];
    if (url && /^https?:\/\//.test(url)) {
      const res = await window.refhub.importUrl(url);
      if (res.ok) { await placeAsset(res.asset, p); showToast?.(t('已导入')); }
      else showToast?.(t('⚠ 没拿到有效图片，用 ✦ 收藏按钮采集更稳'));
    }
  };

  // ---------- 右键菜单 ----------

  const openMenu = (e, target, kind) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current.getBoundingClientRect();
    if (target) {
      const key = keyOf(kind, kind === 'asset' ? target.item_id : target.id);
      if (!selSet.has(key)) setSelection([key]);
    }
    setMenu({
      sx: e.clientX - rect.left, sy: e.clientY - rect.top,
      world: toWorld(e.clientX, e.clientY),
      onItem: !!target,
    });
  };

  const menuItems = () => {
    if (!menu) return [];
    const run = (fn) => () => { setMenu(null); fn(); };
    if (!menu.onItem) {
      return [
        { label: t('＋ 添加文字'), onClick: run(() => addTextAt(menu.world)) },
        { label: t('＋ 方框（拖拽框选范围）'), onClick: run(startBoxDraw) },
        ...(clipRef.current.length ? [{ label: t('粘贴副本（{n} 张）', { n: clipRef.current.length }), hint: 'Ctrl+V', onClick: run(pasteCopies) }] : []),
        { label: t('粘贴图片'), hint: 'Ctrl+V', onClick: run(() => doPaste(menu.world)) },
        { divider: true },
        { label: t('全选'), hint: 'Ctrl+A', onClick: run(selectAll) },
        { label: t('一键整理全部'), onClick: run(() => pack(items)) },
        { label: t('适应视图'), hint: 'F', onClick: run(fitView) },
        { label: t('实际大小 100%'), hint: 'Ctrl+0', onClick: run(zoom100) },
        { divider: true },
        { label: t('导出图板为 PNG…'), onClick: run(exportPng) },
      ];
    }
    const sa = selectedAssets(), sw = selectedWidgets();
    const multi = sa.length >= 2;
    const list = [];
    if (sw.length === 1 && !sa.length) list.push({ label: sw[0].kind === 'box' ? t('重命名分组') : t('编辑文字'), onClick: run(() => setEditing(sw[0].id)) });
    if (sa.length && onAskAI) {
      list.push({
        label: t('✦ 问小灵这 {n} 张图', { n: sa.length }),
        onClick: run(() => onAskAI({ imageAssets: sa.map(({ id, file_path, thumb_path, width, height }) => ({ id, file_path, thumb_path, width, height })) })),
      });
    }
    if (sa.length && onSendToAi) {
      // 复制原图进剪贴板并打开 AI 面板：网页版 AI 粘贴即上传
      list.push({ label: t('⇪ 发送图片到 AI'), onClick: run(() => onSendToAi(sa[0])) });
    }
    if (sa.length) {
      list.push({ label: t('复制'), hint: 'Ctrl+C', onClick: run(copySelection) });
      list.push({ label: t('复制副本'), hint: t('Ctrl+D / Alt+拖'), onClick: run(duplicateSel) });
      list.push({ label: t('置于顶层'), onClick: run(toFront) });
      list.push({ label: t('置于底层'), onClick: run(toBack) });
      list.push({ label: t('水平镜像'), onClick: run(flipSel) });
      list.push({ label: t('向右转 90°'), hint: 'R', onClick: run(() => rotateSel(90)) });
      list.push({ label: t('向左转 90°'), hint: 'Shift+R', onClick: run(() => rotateSel(-90)) });
      list.push({ label: sa.some((i) => !i.locked) ? t('锁定位置') : t('解锁'), onClick: run(lockSel) });
    }
    if (multi) {
      list.push({ divider: true, title: t('对齐（已选 {n} 张)', { n: sa.length }) });
      list.push({ label: t('左对齐'), onClick: run(() => alignSel('left')) });
      list.push({ label: t('右对齐'), onClick: run(() => alignSel('right')) });
      list.push({ label: t('顶对齐'), onClick: run(() => alignSel('top')) });
      list.push({ label: t('底对齐'), onClick: run(() => alignSel('bottom')) });
      list.push({ label: t('水平居中'), onClick: run(() => alignSel('centerH')) });
      list.push({ label: t('垂直居中'), onClick: run(() => alignSel('centerV')) });
      list.push({ label: t('等高'), onClick: run(() => equalize('height')) });
      list.push({ label: t('等宽'), onClick: run(() => equalize('width')) });
      list.push({ label: t('一键整理所选'), onClick: run(() => pack(sa)) });
    }
    list.push({ divider: true });
    list.push({
      label: sa.length && sw.length ? t('移出/删除所选') : sa.length ? t('移出图板') : t('删除'),
      hint: 'Delete', danger: true, onClick: run(deleteSelection),
    });
    return list;
  };

  // ---------- 排版样式（沿用） ----------

  const parseStyle = (w) => { try { return w.style ? JSON.parse(w.style) : {}; } catch (_) { return {}; } };
  const styleToCss = (st) => ({
    fontSize: st.size ? st.size + 'px' : undefined,
    fontFamily: st.font || undefined,
    fontWeight: st.bold ? 700 : undefined,
    fontStyle: st.italic ? 'italic' : undefined,
    textDecoration: st.underline ? 'underline' : undefined,
    color: st.color || undefined,
  });
  const selWidget = selection.length === 1 && selection[0].startsWith('widget:')
    ? widgets.find((w) => keyOf('widget', w.id) === selection[0]) : null;
  const applyStyle = (patch) => {
    if (!selWidget) return;
    const styleStr = JSON.stringify({ ...parseStyle(selWidget), ...patch });
    setWidgets((prev) => prev.map((w) => w.id === selWidget.id ? { ...w, style: styleStr } : w));
    window.refhub.updateBoardWidget(selWidget.id, { style: styleStr });
  };

  const FONTS = [
    ['', t('默认字体')], ['Microsoft YaHei', t('微软雅黑')], ['SimSun', t('宋体')],
    ['KaiTi', t('楷体')], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Impact', 'Impact'],
  ];
  const SIZES = [12, 14, 15, 18, 20, 24, 28, 32, 40, 48];
  const COLORS = ['#29443d', '#2fae9e', '#4a7de0', '#e8a13c', '#e5766e', '#9b59b6'];

  // ---------- 渲染 ----------

  const renderWidget = (w) => {
    const sel = selSet.has(keyOf('widget', w.id));
    const isEditing = editing === w.id;
    const css = styleToCss(parseStyle(w));
    const common = {
      key: 'w' + w.id,
      style: { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.kind === 'box' ? 0 : 500 + (w.z || 0) },
      onPointerDown: (e) => startMove(e, w, 'widget'),
      onContextMenu: (e) => openMenu(e, w, 'widget'),
    };
    const editor = isEditing && (
      <textarea
        className="widget-editor"
        style={css}
        defaultValue={w.content}
        ref={(el) => {
          if (!el) return;
          // 只 blur webview 抢焦点：blur 编辑框自己会触发 onBlur 保存并瞬间关闭
          const ae = document.activeElement;
          if (ae && ae.tagName === 'WEBVIEW') { try { ae.blur(); } catch (_) {} }
          setTimeout(() => el.focus(), 30);
        }}
        autoFocus
        placeholder={w.kind === 'box' ? t('分组名称…') : t('写点什么…')}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => { setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, content: e.target.value } : x)); window.refhub.updateBoardWidget(w.id, { content: e.target.value }); setEditing(null); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
          if (e.key === 'Escape') { e.target.value = w.content; e.target.blur(); }
        }}
      />
    );
    if (w.kind === 'box') {
      return (
        <div {...common} className={'canvas-box' + (sel ? ' selected' : '')}>
          {isEditing ? editor : <div className="box-label" style={css}>{w.content || t('右键命名分组')}</div>}
          <div className="handle" onPointerDown={(e) => startResize(e, w, 'widget')} />
        </div>
      );
    }
    return (
      <div {...common} className={'canvas-text' + (sel ? ' selected' : '')}>
        {isEditing ? editor : <div className="text-body" style={css}>{w.content || t('右键编辑文字')}</div>}
        <div className="handle" onPointerDown={(e) => startResize(e, w, 'widget')} />
      </div>
    );
  };

  return (
    <div
      ref={wrapRef}
      className={'canvas-wrap' + (panning || spaceHeld ? ' panning' : '') + (boxDraw ? ' boxdraw' : '')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => openMenu(e, null, null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="canvas-stage" style={{ transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})` }}>
        {widgets.filter((w) => w.kind === 'box').map(renderWidget)}
        {items.map((it) => (
          <div
            key={'i' + it.item_id}
            className={'canvas-item' + (selSet.has(keyOf('asset', it.item_id)) ? ' selected' : '') + (it.locked ? ' locked' : '')}
            style={{ left: it.x, top: it.y, width: it.w, height: itemH(it), zIndex: 10 + (it.z || 0), transform: it.rot ? `rotate(${it.rot}deg)` : undefined }}
            onPointerDown={(e) => startMove(e, it, 'asset')}
            onDoubleClick={() => onOpenAsset(it, items)}
            onContextMenu={(e) => openMenu(e, it, 'asset')}
          >
            <img
              src={/* 显示宽度超过缩略图约2倍才换原图：避免略一放大就集体解码4K+原图 */ it.w * vp.scale > 900 ? origUrl(it) : thumbUrl(it)}
              draggable={false}
              alt=""
              style={it.flip ? { transform: 'scaleX(-1)' } : undefined}
            />
            {!!it.locked && <span className="lock-badge">🔒</span>}
            {!it.locked && <div className="handle" onPointerDown={(e) => startResize(e, it, 'asset')} />}
          </div>
        ))}
        {widgets.filter((w) => w.kind === 'text').map(renderWidget)}
        {marquee && (
          <div className={'marquee' + (marquee.box ? ' boxdraw' : '')} style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
        )}
        {guides.map((g, i) => (
          <div
            key={i}
            className="snap-guide"
            style={g.axis === 'v'
              ? { left: g.pos, top: -100000, width: 1 / vp.scale, height: 200000 }
              : { top: g.pos, left: -100000, height: 1 / vp.scale, width: 200000 }}
          />
        ))}
      </div>

      {selWidget && (
        <div className="fmt-bar" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <select value={parseStyle(selWidget).font || ''} onChange={(e) => applyStyle({ font: e.target.value || undefined })}>
            {FONTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <select value={parseStyle(selWidget).size || 15} onChange={(e) => applyStyle({ size: Number(e.target.value) })}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={'fmt-btn' + (parseStyle(selWidget).bold ? ' on' : '')} style={{ fontWeight: 800 }} onClick={() => applyStyle({ bold: !parseStyle(selWidget).bold })}>B</button>
          <button className={'fmt-btn' + (parseStyle(selWidget).italic ? ' on' : '')} style={{ fontStyle: 'italic' }} onClick={() => applyStyle({ italic: !parseStyle(selWidget).italic })}>I</button>
          <button className={'fmt-btn' + (parseStyle(selWidget).underline ? ' on' : '')} style={{ textDecoration: 'underline' }} onClick={() => applyStyle({ underline: !parseStyle(selWidget).underline })}>U</button>
          {COLORS.map((c) => (
            <span key={c} className={'color-dot' + (parseStyle(selWidget).color === c ? ' on' : '')} style={{ background: c }} onClick={() => applyStyle({ color: c })} />
          ))}
        </div>
      )}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.sx, top: menu.sy }} onPointerDown={(e) => e.stopPropagation()}>
          {menuItems().map((m, i) => m.divider
            ? <div key={i} className="ctx-divider">{m.title || ''}</div>
            : (
              <div key={i} className={'ctx-item' + (m.danger ? ' danger' : '')} onClick={m.onClick}>
                <span>{m.label}</span>
                {m.hint && <span className="hint">{m.hint}</span>}
              </div>
            ))}
        </div>
      )}

      {drawer && (
        <div className="lib-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ld-head">
            <input
              type="text"
              placeholder={t('搜素材，拖到画布…')}
              value={drawerQ}
              autoFocus
              onChange={(e) => setDrawerQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); setDrawer(false); } e.stopPropagation(); }}
            />
            <button className="ghost" onClick={() => setDrawer(false)}>✕</button>
          </div>
          <div className="ld-grid">
            {drawerAssets.map((a) => (
              <img
                key={a.id}
                src={thumbUrl(a)}
                draggable
                title={a.page_title || ''}
                onDragStart={(e) => { e.dataTransfer.setData('text/asset-id', a.id); e.dataTransfer.effectAllowed = 'copy'; }}
                onDoubleClick={async () => { await placeAsset(a, toWorldCenter()); showToast?.(t('已放到画布')); }}
              />
            ))}
            {!drawerAssets.length && <div className="ld-empty">{t('没有匹配的素材')}</div>}
          </div>
          <div className="ld-hint">{t('拖到画布任意位置 · 双击放到中央 · Tab 关闭')}</div>
        </div>
      )}

      <div className="canvas-tools">
        <div className="tool" onClick={() => setDrawer((v) => !v)}><span className="t-ico">🗂</span>{t('素材')}</div>
        <div className="tool" onClick={() => addTextAt(toWorldCenter())}><span className="t-ico">✎</span>{t('标注')}</div>
        <div className={'tool' + (boxDraw ? ' on' : '')} onClick={() => (boxDraw ? setBoxDraw(false) : startBoxDraw())}><span className="t-ico">▢</span>{t('方框')}</div>
        <div className="tool" onClick={() => pack(selectedAssets().length >= 2 ? selectedAssets() : items)}><span className="t-ico">✦</span>{t('整理')}</div>
        <div className="tool" onClick={exportPng}><span className="t-ico">⤓</span>{t('导出')}</div>
      </div>

      <div className="canvas-hud">
        <button className="ghost zoom-btn" onClick={() => zoomBy(1 / 1.25)}>−</button>
        <span className="pct">{Math.round(vp.scale * 100)}%</span>
        <button className="ghost zoom-btn" onClick={() => zoomBy(1.25)}>+</button>
        <button className="ghost" onClick={fitView}>{t('适应视图')}</button>
        <span>{t('框选多选 · 右键全部操作 · 空格/中键平移 · Alt+拖=拖出副本 · Ctrl+C/V 复制粘贴 · Ctrl+Z 撤销')}</span>
      </div>
    </div>
  );
}

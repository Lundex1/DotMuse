import React, { useState, useEffect, useRef, useCallback } from 'react';
import faceUrl from '../assets/xiaoling.png';

const QUIPS = [
  '卡壳了？聊两句，帮你捋捋思路',
  '今天找什么参考？废墟、霓虹还是装饰艺术',
  '要搜索词吗？给你配几组英文的，比中文好搜',
  '扔个主题过来，我给你几个参考方向',
  '场景没头绪的话，从光影和色调切入试试',
];

export default function FloatingBall({ open, onToggle }) {
  const anchorRef = useRef(null);
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ballPos')) || null; } catch (_) { return null; }
  });
  const [quip, setQuip] = useState(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const timerRef = useRef(null);

  // 定时冒泡：面板打开时不打扰
  const scheduleQuip = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!document.hidden) {
        let text = QUIPS[Math.floor(Math.random() * QUIPS.length)];
        try {
          const assets = await window.refhub.listAssets({ limit: 50 });
          const d = new Date();
          const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const n = assets.filter((a) => (a.created_at || '').startsWith(localToday)).length;
          if (n === 0 && Math.random() < 0.5) text = '今天还没收图，去转一圈？';
          else if (n >= 8 && Math.random() < 0.5) text = `今天收了 ${n} 张，效率可以`;
        } catch (_) {}
        setQuip(text);
        setTimeout(() => setQuip(null), 9000);
      }
      scheduleQuip();
    }, 60000 + Math.random() * 90000);
  }, []);

  useEffect(() => {
    // 开场 15 秒后先冒一次泡
    timerRef.current = setTimeout(() => {
      setQuip(QUIPS[0]);
      setTimeout(() => setQuip(null), 9000);
      scheduleQuip();
    }, 15000);
    return () => clearTimeout(timerRef.current);
  }, [scheduleQuip]);

  useEffect(() => { if (open) setQuip(null); }, [open]);

  const onPointerDown = (e) => {
    movedRef.current = false;
    // 拖动边界 = 主区域（anchor 的定位父级），而不是 anchor 自身
    const container = anchorRef.current?.offsetParent;
    if (!container || !anchorRef.current) return;
    const crect = container.getBoundingClientRect();
    const arect = anchorRef.current.getBoundingClientRect();
    dragRef.current = {
      sx: e.clientX, sy: e.clientY,          // 按下时的指针位置
      ox: arect.left - crect.left,           // 按下时 anchor 在容器内的位置快照
      oy: arect.top - crect.top,
      crect,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!movedRef.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 死区：防误触
    movedRef.current = true;
    setPos({
      x: Math.min(Math.max(8, d.ox + dx), d.crect.width - 68),
      y: Math.min(Math.max(8, d.oy + dy), d.crect.height - 68),
    });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (movedRef.current) {
      // 松手吸附到左右边缘
      setPos((p) => {
        if (!p) return p;
        const snapped = { ...p, x: p.x + 30 < d.crect.width / 2 ? 16 : d.crect.width - 76 };
        localStorage.setItem('ballPos', JSON.stringify(snapped));
        return snapped;
      });
    } else {
      onToggle();
    }
  };

  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {};

  return (
    <div className="ball-anchor" ref={anchorRef} style={style}>
      {quip && !open && (
        <div className="ball-quip" onClick={() => { setQuip(null); onToggle(); }}>
          {quip}
        </div>
      )}
      <div
        className={'ball' + (open ? ' open' : '') + (quip ? ' excited' : '')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="小灵 · AI 助手"
      >
        <img src={faceUrl} alt="小灵" draggable={false} />
      </div>
    </div>
  );
}

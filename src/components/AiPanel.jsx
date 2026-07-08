import React, { useState, useRef, useEffect } from 'react';
import { t } from '../lib/i18n.js';

// 分发版：不内置 AI 引擎，集成免费网页版 AI，登录态持久保存
const SITES = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { key: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' },
  { key: 'claude', name: 'Claude', url: 'https://claude.ai/' },
];

export default function AiPanel({ open }) {
  const [site, setSite] = useState(() => localStorage.getItem('aiSite') || 'deepseek');
  const webRef = useRef(null);

  useEffect(() => { localStorage.setItem('aiSite', site); }, [site]);

  // 网页字号整体放大一档，太小看着费眼
  useEffect(() => {
    const wv = webRef.current;
    if (!wv) return;
    const onReady = () => { try { wv.setZoomFactor(1.12); } catch (_) {} };
    wv.addEventListener('dom-ready', onReady);
    return () => wv.removeEventListener('dom-ready', onReady);
  }, []);

  // 面板宽度可拖拽（Blender 式左缘把手），宽度记忆到本地
  const [panelW, setPanelW] = useState(() => {
    const v = parseInt(localStorage.getItem('aiPanelW'), 10);
    return v >= 300 && v <= 1400 ? v : 400;
  });
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef(null);
  const startResize = (e) => {
    e.preventDefault();
    resizeRef.current = { sx: e.clientX, w: panelW };
    setResizing(true);
    const onMove = (ev) => {
      const d = resizeRef.current;
      if (!d) return;
      setPanelW(Math.min(Math.round(window.innerWidth * 0.75), Math.max(300, d.w + (d.sx - ev.clientX))));
    };
    const onUp = () => {
      resizeRef.current = null;
      setResizing(false);
      setPanelW((w) => { localStorage.setItem('aiPanelW', String(w)); return w; });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const current = SITES.find((s) => s.key === site) || SITES[0];

  const pick = (key) => {
    setSite(key);
    const s = SITES.find((x) => x.key === key);
    webRef.current?.loadURL(s.url).catch(() => {});
  };

  return (
    <div className={'ai-panel' + (open ? ' open' : '') + (resizing ? ' resizing' : '')} style={{ width: open ? `min(${panelW}px, 92vw)` : 0 }}>
      {open && <div className="ai-resizer" onPointerDown={startResize} title={t('拖拽调整宽度')} />}
      {resizing && <div className="resize-shield" />}
      <div className="ai-inner" style={{ width: `min(${panelW}px, 92vw)` }}>
        <div className="ai-head">
          <span className="title">{t('✦ AI 助手')}</span>
          <button className="ghost icon" title={t('刷新')} onClick={() => webRef.current?.reload()}>⟳</button>
        </div>
        <div className="ai-tabs">
          {SITES.map((s) => (
            <button key={s.key}
              className={'ai-tab' + (site === s.key ? ' on' : '')}
              onClick={() => pick(s.key)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="ai-webview">
          <webview ref={webRef} src={current.url} partition="persist:aiweb" allowpopups="true" />
        </div>
        <div className="ai-note">
          {t('登录一次永久保持。把灵感笔记「复制全文」粘到这里，让 AI 帮你展开方向、给搜索词。')}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { t } from '../lib/i18n.js';

// 分发版：不内置 AI 引擎，集成免费网页版 AI，登录态持久保存
const SITES = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { key: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { key: 'qwen', name: '千问', url: 'https://www.tongyi.com/' },
  { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' },
  { key: 'claude', name: 'Claude', url: 'https://claude.ai/' },
];

// 网页图片 → 系统剪贴板（不入库）：主进程带登录态下载字节，
// 渲染层用 Chromium 解码（webp/avif 都认）转成 PNG 再写剪贴板
async function copyWebImageToClipboard(url) {
  let bytes;
  if (url.startsWith('data:image/')) {
    bytes = await (await fetch(url)).arrayBuffer();
  } else {
    const dl = await window.refhub.fetchImageBytes(url);
    // error 保持中文原文往外传，显示处统一过 t()（中文键即译文键）
    if (!dl?.ok) return { ok: false, error: dl?.error || '下载失败' };
    bytes = dl.buf;
  }
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return await window.refhub.copyImageBuffer(new Uint8Array(await blob.arrayBuffer()));
  } catch (_) {
    return { ok: false, error: '这张图的格式无法处理' };
  }
}

export default function AiPanel({ open, pasteRequest, showToast }) {
  const [site, setSite] = useState(() => localStorage.getItem('aiSite') || 'deepseek');
  const webRef = useRef(null);
  const pasteTsRef = useRef(0);

  useEffect(() => { localStorage.setItem('aiSite', site); }, [site]);

  // 面板宽度可拖拽（Blender 式左缘把手），宽度记忆到本地。
  // 注意声明在下面的拖拽接收罩 effect 之前：它的依赖里引用了 panelW
  const [panelW, setPanelW] = useState(() => {
    const v = parseInt(localStorage.getItem('aiPanelW'), 10);
    return v >= 300 && v <= 1400 ? v : 400;
  });
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef(null);

  // 拖网页图片时弹出接收罩：接住拖拽直接发给网页 AI，不经过素材库。
  // 拖库内素材（系统级文件拖拽，带 Files）不拦，让网站自己收文件
  const [webDrop, setWebDrop] = useState(false);
  const dragTimer = useRef(0);
  useEffect(() => {
    if (!open) { setWebDrop(false); return; }
    const onDragOver = (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes('Files')) return;          // 库内素材的系统级文件拖拽：让网站自己接
      if (types.includes('text/asset-id')) return;  // 画布素材抽屉等应用内拖拽：不拦
      if (!types.includes('text/html') && !types.includes('text/uri-list')) return;
      // 只在拖到 AI 面板附近才弹罩子：往画布/素材库方向拖网页图不打扰
      if (e.clientX < window.innerWidth - Math.min(panelW, window.innerWidth * 0.92) - 80) return;
      setWebDrop(true);
      clearTimeout(dragTimer.current);
      dragTimer.current = setTimeout(() => setWebDrop(false), 600);
    };
    window.addEventListener('dragover', onDragOver);
    return () => { window.removeEventListener('dragover', onDragOver); clearTimeout(dragTimer.current); };
  }, [open, panelW]);

  const onWebDrop = async (e) => {
    e.preventDefault();
    clearTimeout(dragTimer.current);
    setWebDrop(false);
    // 优先从 text/html 抠真正的 <img> 地址（uri-list 常是页面链接）
    const html = e.dataTransfer.getData('text/html');
    const im = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const raw = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim().split('\n')[0];
    let url = im ? im[1].replace(/&amp;/g, '&') : '';
    if (!url && /^data:image\//.test(raw)) url = raw;
    if (!url && /^https?:\/\/\S+\.(jpe?g|png|gif|webp|avif)([?#]|$)/i.test(raw)) url = raw;
    if (!url && !html && /^https?:\/\//.test(raw)) url = raw; // 没有 html 的纯地址拖拽：多半是图
    if (url) {
      showToast?.(t('正在下载图片…'));
      const r = await copyWebImageToClipboard(url);
      if (!r?.ok) { showToast?.(`⚠ ${t(r?.error || '下载失败')}`); return; }
      try { webRef.current?.focus(); webRef.current?.paste(); } catch (_) {}
      showToast?.(t('已发送到网页 AI（未入库）；如没出现，点一下输入框按 Ctrl+V'));
      return;
    }
    // 拖进来的是链接/选中文字：别吞掉，转交给网页输入框
    const text = (e.dataTransfer.getData('text/plain') || raw || '').trim();
    if (text) {
      try { await navigator.clipboard.writeText(text); } catch (_) {}
      try { webRef.current?.focus(); webRef.current?.insertText(text); } catch (_) {}
      showToast?.(t('已把文字转交给输入框；没出现的话点一下输入框 Ctrl+V'));
      return;
    }
    showToast?.(t('⚠ 没拿到图片地址，请拖图片本体'));
  };

  // 面板关超过 5 分钟就卸掉网页 webview（ChatGPT/豆包页面常驻 150-300MB）；
  // 登录态在 persist:aiweb 分区里，重开只是重新加载页面
  const [webAlive, setWebAlive] = useState(open);
  useEffect(() => {
    if (open) { setWebAlive(true); return; }
    const idle = setTimeout(() => setWebAlive(false), 5 * 60 * 1000);
    return () => clearTimeout(idle);
  }, [open]);

  // 「发送图片到 AI」：图已进系统剪贴板，等面板动画结束后自动聚焦+粘贴
  useEffect(() => {
    if (!pasteRequest || pasteRequest.ts === pasteTsRef.current) return;
    pasteTsRef.current = pasteRequest.ts;
    const timer = setTimeout(() => {
      try { webRef.current?.focus(); webRef.current?.paste(); } catch (_) {}
    }, 500);
    return () => clearTimeout(timer);
  }, [pasteRequest]);

  // 网页字号整体放大一档，太小看着费眼。
  // webAlive 变化（休眠后重建 webview）要重新绑监听
  useEffect(() => {
    const wv = webRef.current;
    if (!wv) return;
    const onReady = () => { try { wv.setZoomFactor(1.12); } catch (_) {} };
    wv.addEventListener('dom-ready', onReady);
    return () => wv.removeEventListener('dom-ready', onReady);
  }, [webAlive]);

  const startResize = (e) => {
    e.preventDefault();
    // 指针捕获 + 拖拽期间让所有 webview 不参与命中：
    // 否则拖到浏览器页的网页上，事件被 webview 吞掉就卡住了
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    document.documentElement.classList.add('ai-resizing');
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
      document.documentElement.classList.remove('ai-resizing');
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
          {webAlive && <webview ref={webRef} src={current.url} partition="persist:aiweb" allowpopups="true" />}
          {webDrop && (
            <div className="aiweb-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onWebDrop}>
              {t('拖到这里 · 直接发给网页 AI（不入库）')}
            </div>
          )}
        </div>
        <div className="ai-note">
          {t('登录一次永久保持。把灵感笔记「复制全文」粘到这里，让 AI 帮你展开方向、给搜索词。')}
        </div>
      </div>
    </div>
  );
}

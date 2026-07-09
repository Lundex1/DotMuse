import React, { useState, useEffect, useCallback, useRef } from 'react';
import Library from './components/Library.jsx';
import Boards from './components/Boards.jsx';
import BrowserPane from './components/BrowserPane.jsx';
import AssetDetail from './components/AssetDetail.jsx';
import AiPanel from './components/AiPanel.jsx';
import xiaolingUrl from './assets/xiaoling.png';
import IdeasView from './components/IdeasView.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import FirstRun from './components/FirstRun.jsx';
import logoUrl from './assets/icon.png';
import navLibrary from './assets/nav-library.png';
import navBoards from './assets/nav-boards.png';
import navIdeas from './assets/nav-ideas.png';
import navBrowser from './assets/nav-browser.png';
import { t } from './lib/i18n.js';

const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.1" />
    <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M18.8 5.2l-1.5 1.5M6.7 17.3l-1.5 1.5" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none">
    <path d="M20.2 14.6A8.3 8.3 0 0 1 9.4 3.8 8.3 8.3 0 1 0 20.2 14.6z" />
  </svg>
);

// 侧栏小锁：锁上 = 保持收起，不随鼠标展开
const LockIcon = ({ locked }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="5.5" y="11" width="13" height="8.5" rx="2.6" />
    {locked
      ? <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
      : <path d="M8.5 11V8a3.5 3.5 0 0 1 6.6-1.6" />}
  </svg>
);

// Electron 禁用了原生 prompt()，用自己的输入弹窗全局替代
function PromptModal({ req, onDone }) {
  const [val, setVal] = useState(req.def || '');
  const inputRef = useRef(null);
  // 内嵌浏览器(webview)会扣住键盘焦点：先把它 blur 掉再聚焦输入框，
  // 否则时不时出现"光标不闪、打字没反应"
  useEffect(() => {
    document.activeElement?.blur?.();
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);
  const finish = (v) => { req.resolve(v); onDone(); };
  return (
    <div className="detail-overlay" onClick={() => finish(null)}>
      <div className="prompt-box" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-msg">{req.message}</div>
        <input type="text" ref={inputRef} autoFocus value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(val.trim() || null);
            if (e.key === 'Escape') finish(null);
          }} />
        <div className="prompt-actions">
          <button className="ghost" onClick={() => finish(null)}>{t('取消')}</button>
          <button className="primary" onClick={() => finish(val.trim() || null)}>{t('确定')}</button>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { key: 'library', img: navLibrary, label: t('素材库') },
  { key: 'boards', img: navBoards, label: t('工作图板') },
  { key: 'ideas', img: navIdeas, label: t('灵感笔记') },
  { key: 'browser', img: navBrowser, label: t('浏览器') },
];
const VIEW_ORDER = NAV.map((n) => n.key);

export default function App() {
  const [view, setView] = useState('library');
  const [detailAsset, setDetailAsset] = useState(null);
  const [detailList, setDetailList] = useState(null); // 详情页 ← → 翻图用的列表上下文
  const openAsset = useCallback((a, list) => {
    setDetailAsset(a);
    setDetailList(Array.isArray(list) && list.length > 1 ? list : null);
  }, []);
  const [aiPasteReq, setAiPasteReq] = useState(null); // 「发送图片到 AI」触发网页面板自动粘贴
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [boardReq, setBoardReq] = useState(null);
  const [ideaReq, setIdeaReq] = useState(null);
  const [promptReq, setPromptReq] = useState(null);
  const [firstRun, setFirstRun] = useState(false);
  const [railLocked, setRailLocked] = useState(() => localStorage.getItem('railLocked') === '1');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const browserRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    window.appPrompt = (message, def = '') =>
      new Promise((resolve) => setPromptReq({ message, def, resolve }));
    window.refhub.getSettings().then((s) => { if (s.firstRun) setFirstRun(true); });
  }, []);

  const showToast = useCallback((msg, action) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2500);
  }, []);

  // 发送图片到网页版 AI：复制进剪贴板 → 打开面板 → 尝试自动粘贴
  const sendImgToAi = useCallback(async (a) => {
    const r = await window.refhub.copyImageToClipboard(a.id);
    // 主进程返回的错误是中文原文，过一遍 t() 让 en/ja 用户看到译文
    if (!r?.ok) { showToast(`⚠ ${t(r?.error || '复制图片失败')}`); return; }
    setAiOpen(true);
    setAiPasteReq({ ts: Date.now() });
    showToast(t('已复制图片并打开 AI 面板；如输入框没自动出现，点一下输入框按 Ctrl+V'));
  }, [showToast]);

  // 用户直接操作后的立即刷新（稳定引用，保住下游 memo 不被击穿）
  const notifyChanged = useCallback(() => setRefreshKey((k) => k + 1), []);
  // 高频事件（批量导入等）合并成一次刷新，别让各页面反复全量拉数据
  const refreshDebounce = useRef(null);
  const bumpRefresh = useCallback(() => {
    clearTimeout(refreshDebounce.current);
    refreshDebounce.current = setTimeout(() => setRefreshKey((k) => k + 1), 300);
  }, []);

  useEffect(() => {
    const off = window.refhub.onAssetAdded((asset) => {
      const activeBoard = Number(localStorage.getItem('activeBoardId') || 0);
      if (asset.__origin === 'capture' && activeBoard) window.refhub.addToBoard(activeBoard, asset.id);
      // 隐藏素材（.dlb 仅图板导入等）没有真的"入库"，不弹入库提示
      if (asset.hidden) { bumpRefresh(); return; }
      showToast(
        t('已入库 · {title}（点击查看）', { title: (asset.page_title || asset.note || asset.id).slice(0, 26) }),
        () => { setView('library'); setDetailAsset(asset); }
      );
      bumpRefresh();
    });
    const offFail = window.refhub.onCaptureFailed((msg) => showToast(`⚠ ${msg}`));
    const offLib = window.refhub.onLibraryChanged(() => bumpRefresh());
    return () => { off(); offFail(); offLib(); };
  }, [showToast, bumpRefresh]);

  // 全局兜底：没被任何组件接住的拖拽一律取消默认行为，
  // 否则 Chromium 会把整个界面导航成被拖的图片/链接（软件界面直接被顶掉）
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx >= 0) { e.preventDefault(); setView(VIEW_ORDER[idx]); return; }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openInBrowser = useCallback((url) => {
    setView('browser');
    setDetailAsset(null);
    browserRef.current?.navigate(url);
  }, []);

  // 离开浏览器页时把 webview 扣住的焦点收回来，否则其他页输入框会点不进去
  useEffect(() => {
    if (view !== 'browser') {
      try { document.querySelector('webview')?.blur(); } catch (_) {}
      document.activeElement?.blur?.();
    }
  }, [view]);

  // 系统性修复"双击改名/输入框点不进去"：只要在主界面（非 webview）按下鼠标，
  // 焦点还被某个 webview 扣着就立刻抢回来，改名输入框才能保住焦点
  useEffect(() => {
    const onDown = (e) => {
      if (e.target && e.target.tagName === 'WEBVIEW') return;
      const ae = document.activeElement;
      if (ae && ae.tagName === 'WEBVIEW') { try { ae.blur(); } catch (_) {} }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <div className="app">
      <div className={'rail' + (railLocked ? ' locked' : '')}>
        <div className="brand">
          <div className="logo"><img src={logoUrl} alt="点灵" /></div>
          <span className="brand-name">点灵</span>
        </div>
        {NAV.map((n, i) => (
          <div key={n.key}
            className={'rail-item' + (view === n.key ? ' active' : '')}
            onClick={() => setView(n.key)} title={`Ctrl+${i + 1}`}>
            <span className="ico"><img className="nav-ico" src={n.img} alt={n.label} /></span>
            <span className="lbl">{n.label}</span>
          </div>
        ))}
        <div className="rail-item" onClick={() => setSearchOpen(true)} title="Ctrl+K">
          <span className="ico">⌕</span>
          <span className="lbl">{t('全局搜索')}</span>
        </div>
        <div className={'rail-item' + (aiOpen ? ' active' : '')} onClick={() => setAiOpen((v) => !v)} title={t('AI 助手')}>
          <span className="ico"><img className="nav-ico round" src={xiaolingUrl} alt={t('AI 助手')} /></span>
          <span className="lbl">{t('AI 助手')}</span>
        </div>
        <div className="spacer" />
        <div className="rail-item rail-toggle"
          title={railLocked ? t('已锁定收起 · 点击恢复鼠标悬停展开') : t('锁定侧栏（保持收起，不随鼠标展开）')}
          onClick={() => setRailLocked((v) => { const n = !v; localStorage.setItem('railLocked', n ? '1' : '0'); return n; })}>
          <span className="ico"><LockIcon locked={railLocked} /></span>
          <span className="lbl">{railLocked ? t('解锁 · 恢复悬停展开') : t('锁定侧栏不展开')}</span>
        </div>
        <div className="rail-item" onClick={() => setSettingsOpen(true)}>
          <span className="ico">⚙</span>
          <span className="lbl">{t('设置')}</span>
        </div>
        <div className="rail-foot">DotMuse</div>
      </div>
      <div className="main">
        <div className={'pane' + (view === 'library' ? ' visible' : '')}>
          <Library refreshKey={refreshKey} active={view === 'library'} onOpenAsset={openAsset} showToast={showToast} onChanged={notifyChanged} onSendToAi={sendImgToAi} />
        </div>
        <div className={'pane' + (view === 'boards' ? ' visible' : '')}>
          <Boards refreshKey={refreshKey} active={view === 'boards'} onOpenAsset={openAsset} showToast={showToast} openRequest={boardReq} onSendToAi={sendImgToAi} />
        </div>
        <div className={'pane' + (view === 'ideas' ? ' visible' : '')}>
          <IdeasView showToast={showToast} openRequest={ideaReq} />
        </div>
        <div className={'pane browser-pane' + (view === 'browser' ? ' visible' : '')}>
          <BrowserPane ref={browserRef} refreshKey={refreshKey} />
        </div>
        <button className="theme-toggle"
          title={theme === 'light' ? t('浅色模式 · 点击切深色') : t('深色模式 · 点击切浅色')}
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
          {theme === 'light' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      <AiPanel open={aiOpen} pasteRequest={aiPasteReq} showToast={showToast} />
      {detailAsset && (
        <AssetDetail asset={detailAsset} list={detailList} onNavigate={setDetailAsset} onClose={() => setDetailAsset(null)}
          onOpenInBrowser={openInBrowser} onChanged={() => setRefreshKey((k) => k + 1)} showToast={showToast} />
      )}
      {searchOpen && (
        <GlobalSearch onClose={() => setSearchOpen(false)}
          onOpenAsset={(a) => { setSearchOpen(false); openAsset(a); }}
          onOpenBoard={(id) => { setSearchOpen(false); setView('boards'); setBoardReq({ ts: Date.now(), id }); }}
          onOpenIdea={(id) => { setSearchOpen(false); setView('ideas'); setIdeaReq({ ts: Date.now(), id }); }} />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} showToast={showToast} />}
      {promptReq && <PromptModal req={promptReq} onDone={() => setPromptReq(null)} />}
      {firstRun && <FirstRun onDone={() => { setFirstRun(false); setRefreshKey((k) => k + 1); }} />}
      {toast && (
        <div className={'toast' + (toast.action ? ' clickable' : '')}
          onClick={() => { if (toast.action) { toast.action(); setToast(null); } }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { t } from '../lib/i18n.js';

const DEFAULT_SITES = [
  { name: 'Pinterest', url: 'https://www.pinterest.com/' },
  { name: 'ArtStation', url: 'https://www.artstation.com/' },
  { name: '花瓣', url: 'https://huaban.com/' },
  { name: 'Google', url: 'https://www.google.com/' },
];

// 常用网站可由用户增删，持久化在本地
function loadSites() {
  try {
    const s = JSON.parse(localStorage.getItem('quickSites'));
    if (Array.isArray(s)) return s;
  } catch (_) {}
  return DEFAULT_SITES;
}

function hostName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

const BrowserPane = forwardRef(function BrowserPane({ refreshKey }, ref) {
  const [preloadPath, setPreloadPath] = useState(null);
  const [sites, setSites] = useState(loadSites);
  const [homeUrl] = useState(() => loadSites()[0]?.url || 'https://www.google.com/');
  const [addr, setAddr] = useState(homeUrl);
  const [boards, setBoards] = useState([]);
  const [activeBoard, setActiveBoard] = useState(() => localStorage.getItem('activeBoardId') || '');
  const [ddOpen, setDdOpen] = useState(false);
  const [siteDd, setSiteDd] = useState(false);
  const webviewRef = useRef(null);

  useEffect(() => {
    window.refhub.getPaths().then((p) => setPreloadPath(p.webviewPreload));
  }, []);

  useEffect(() => {
    window.refhub.listBoards().then(setBoards);
  }, [refreshKey]);

  useEffect(() => {
    localStorage.setItem('quickSites', JSON.stringify(sites));
  }, [sites]);

  const pickBoard = async (v) => {
    setDdOpen(false);
    if (v === '__new__') {
      const name = await window.appPrompt(t('新图板名称：'));
      if (!name) return;
      const b = await window.refhub.createBoard(name);
      setBoards(await window.refhub.listBoards());
      v = String(b.id);
    }
    setActiveBoard(v);
    localStorage.setItem('activeBoardId', v);
  };

  const currentBoard = boards.find((b) => String(b.id) === activeBoard);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onNav = () => setAddr(wv.getURL());
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
    };
  }, [preloadPath]);

  const navigate = (url) => {
    let u = url.trim();
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    setAddr(u);
    // 快速连续导航时上一次加载会被中断（ERR_ABORTED），属正常，静音处理
    webviewRef.current?.loadURL(u).catch(() => {});
  };

  useImperativeHandle(ref, () => ({ navigate }));

  // 把地址栏当前网站加进常用（名称取域名，已存在则跳过）
  const addCurrentSite = () => {
    const url = (addr || '').trim();
    if (!url) { setSiteDd(false); return; }
    if (!sites.some((s) => s.url === url)) setSites((prev) => [...prev, { name: hostName(url), url }]);
    setSiteDd(false);
  };

  // 手动输入网址 + 名称
  const addCustomSite = async () => {
    const raw = await window.appPrompt(t('网站地址（如 behance.net）：'));
    if (!raw) return;
    let u = raw.trim();
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    const name = await window.appPrompt(t('显示名称：'), hostName(u));
    setSites((prev) => [...prev, { name: (name || hostName(u)).trim(), url: u }]);
    setSiteDd(false);
  };

  const removeSite = (url, e) => {
    e.stopPropagation();
    setSites((prev) => prev.filter((s) => s.url !== url));
  };

  return (
    <>
      <div className="toolbar">
        <button onClick={() => webviewRef.current?.goBack()}>←</button>
        <button onClick={() => webviewRef.current?.goForward()}>→</button>
        <button onClick={() => webviewRef.current?.reload()}>⟳</button>
        <input
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(addr); }}
        />
        <div className="site-wrap">
          <button
            className="site-btn"
            title={t('常用网站 · 可自己增删')}
            onClick={() => setSiteDd((v) => !v)}
          >
            {t('常用网站')}<span className="car">▾</span>
          </button>
          {siteDd && (
            <>
              <div className="pop-backdrop" onClick={() => setSiteDd(false)} />
              <div className="site-pop">
                {sites.map((l) => (
                  <div key={l.url} className="pop-item" onClick={() => { navigate(l.url); setSiteDd(false); }}>
                    <span className="name">{l.name}</span>
                    <span className="rm" title={t('移除')} onClick={(e) => removeSite(l.url, e)}>×</span>
                  </div>
                ))}
                {!sites.length && <div className="pop-empty">{t('还没有常用网站')}</div>}
                <div className="pop-item create" onClick={addCurrentSite}>{t('＋ 把当前网站加进来')}</div>
                <div className="pop-item create" onClick={addCustomSite}>{t('＋ 手动添加网址…')}</div>
              </div>
            </>
          )}
        </div>
        <div className="ab-wrap">
          <button
            className={'ab-btn' + (activeBoard ? ' on' : '')}
            title={t('活动图板：采集的图自动同时放进这个图板')}
            onClick={() => {
              setDdOpen((v) => !v);
              if (!ddOpen) window.refhub.listBoards().then(setBoards);
            }}
          >
            {activeBoard
              ? <><span className="dot" />{currentBoard?.name || t('图板')}</>
              : t('收藏到：仅素材库')}
            <span className="car">▾</span>
          </button>
          {ddOpen && (
            <>
              <div className="pop-backdrop" onClick={() => setDdOpen(false)} />
              <div className="ab-pop">
                <div className="pop-item" onClick={() => pickBoard('')}>
                  <span className="name">{t('仅素材库')}</span>
                  {!activeBoard && <span className="ck">✓</span>}
                </div>
                {boards.map((b) => (
                  <div key={b.id} className="pop-item" onClick={() => pickBoard(String(b.id))}>
                    <span className="dot" />
                    <span className="name">{b.name}</span>
                    {activeBoard === String(b.id) && <span className="ck">✓</span>}
                  </div>
                ))}
                <div className="pop-item create" onClick={() => pickBoard('__new__')}>{t('＋ 新建图板…')}</div>
              </div>
            </>
          )}
        </div>
      </div>
      {preloadPath && (
        <webview
          ref={webviewRef}
          src={homeUrl}
          partition="persist:browse"
          preload={`file:///${preloadPath.replace(/\\/g, '/')}`}
          allowpopups="true"
          style={{ flex: 1 }}
        />
      )}
    </>
  );
});

export default BrowserPane;

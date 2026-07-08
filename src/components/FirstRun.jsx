import React, { useState, useEffect } from 'react';
import heroUrl from '../assets/hero.png';
import { t, getLang, setLang, LANGS } from '../lib/i18n.js';

// 创作方向：按职业铺推荐分类
const DIRECTIONS = [
  { key: 'scene', name: t('游戏场景设计师') },
  { key: 'character', name: t('角色设计师') },
  { key: 'illustration', name: t('插画师') },
  { key: 'ui', name: t('UI 设计师') },
  { key: 'generic', name: t('其他创作者') },
];

// 首次启动：欢迎 + 选择素材库存放位置 + 创作方向
export default function FirstRun({ onDone }) {
  const [dir, setDir] = useState('');
  const [direction, setDirection] = useState('scene');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    window.refhub.getSettings().then((s) => setDir(s.libraryRoot || ''));
  }, []);

  const choose = async () => {
    const picked = await window.refhub.pickLibraryDir();
    if (picked) setDir(picked);
  };

  const start = async () => {
    setBusy(true);
    setErr('');
    const res = await window.refhub.confirmSetup(dir, direction);
    setBusy(false);
    if (res && res.ok === false) { setErr(res.error || t('这个位置暂时不能用，换一个试试')); return; }
    onDone();
  };

  return (
    <div className="fr-overlay">
      <div className="fr-panel">
        <div className="fr-hero"><img src={heroUrl} alt="点灵 DotMuse" /></div>
        <div className="fr-body">
          <h1>{t('欢迎使用 点灵 DotMuse')}</h1>
          <p className="fr-sub">{t('收集灵感 · 整理有序 · 启发创作')}</p>
          <p className="fr-desc">
            {t('你收集的所有图片、图板、笔记都保存在下面这个文件夹里，整体拷走即可迁移备份。以后可在「设置」里随时更改。')}
          </p>
          <div className="fr-field">
            <div className="fr-label">语言 / Language / 言語</div>
            <select
              className="fr-select"
              defaultValue={getLang()}
              onChange={async (e) => {
                setLang(e.target.value);
                try { await window.refhub.setLangCfg(e.target.value); } catch (_) {}
                location.reload(); // 向导会以新语言重新打开
              }}
            >
              {LANGS.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
            </select>
          </div>
          <div className="fr-field">
            <div className="fr-label">{t('素材库存放位置')}</div>
            <div className="fr-dir">
              <span className="fr-path" title={dir}>{dir || t('读取中…')}</span>
              <button onClick={choose}>{t('选择其他位置…')}</button>
            </div>
          </div>
          <div className="fr-field">
            <div className="fr-label">{t('你的创作方向')}</div>
            <select className="fr-select" value={direction} onChange={(e) => setDirection(e.target.value)}>
              {DIRECTIONS.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
            <div className="fr-sub2">{t('会按方向帮你建好一套推荐分类，之后可随意增删')}</div>
          </div>
          {err && <p className="fr-err">{err}</p>}
          <button className="primary fr-start" disabled={busy || !dir} onClick={start}>
            {busy ? t('正在准备…') : t('开始使用 →')}
          </button>
          <p className="fr-privacy">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ verticalAlign: '-2px', marginRight: '4px' }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v6" strokeLinecap="round" />
              <circle cx="12" cy="16.6" r="0.4" fill="currentColor" stroke="none" />
            </svg>
            {t('所有素材仅保存在你本机，不会上传任何服务器')}
          </p>
        </div>
      </div>
    </div>
  );
}

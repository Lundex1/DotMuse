import React, { useState, useEffect } from 'react';
import { t, getLang, setLang, LANGS } from '../lib/i18n.js';

export default function SettingsModal({ onClose, showToast }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);

  // 切换语言：本地记录 + 同步主进程（弹窗语言），整窗重载生效
  const switchLang = async (lang) => {
    setLang(lang);
    try { await window.refhub.setLangCfg(lang); } catch (_) {}
    location.reload();
  };

  useEffect(() => {
    window.refhub.getSettings().then(setSettings);
  }, []);

  const changeRoot = async () => {
    setBusy(true);
    const res = await window.refhub.changeLibraryRoot();
    setBusy(false);
    if (res.ok) {
      setSettings((s) => ({ ...s, libraryRoot: res.root }));
      showToast?.(res.migrated ? t('已迁移素材库到：{root}', { root: res.root }) : t('已切换素材库：{root}', { root: res.root }));
    } else if (!res.canceled && res.error) {
      showToast?.(`⚠ ${res.error}`);
    }
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>{t('⚙ 设置')}</h2>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>{t('关闭')}</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">语言 / Language / 言語</div>
          <div className="settings-row">
            <div className="row-main">
              <div className="row-title">{t('界面语言')}</div>
            </div>
            <div className="row-actions">
              <select defaultValue={getLang()} onChange={(e) => switchLang(e.target.value)}>
                {LANGS.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-section">{t('采集')}</div>
          <div className="settings-row">
            <div className="row-main">
              <div className="row-title">{t('剪贴板监听')}</div>
              <div className="row-hint">{t('开启后，在任何软件里复制图片（Ctrl+C），点灵自动收进素材库并 AI 归档')}</div>
            </div>
            <div className="row-actions">
              <button
                className={settings?.clipboardWatch ? 'primary' : ''}
                onClick={async () => {
                  const next = !settings?.clipboardWatch;
                  await window.refhub.setClipboardWatch(next);
                  setSettings((s) => ({ ...s, clipboardWatch: next }));
                  showToast?.(next ? t('剪贴板监听已开启') : t('剪贴板监听已关闭'));
                }}
              >
                {settings?.clipboardWatch ? t('已开启') : t('已关闭')}
              </button>
            </div>
          </div>
          <div className="settings-section">{t('维护')}</div>
          <div className="settings-row">
            <div className="row-main">
              <div className="row-title">{t('清理损坏素材')}</div>
              <div className="row-hint">{t('扫描并删除库里不是有效图片的文件（如早期误存的网页），正常图片不受影响')}</div>
            </div>
            <div className="row-actions">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await window.refhub.cleanBrokenAssets();
                  setBusy(false);
                  showToast?.(r.removed ? t('已清理 {n} 个损坏素材', { n: r.removed }) : t('没有发现损坏素材'));
                }}
              >
                {t('扫描并清理')}
              </button>
            </div>
          </div>
          <div className="settings-section">{t('存储')}</div>
          <div className="settings-row">
            <div className="row-main">
              <div className="row-title">{t('素材库位置')}</div>
              <div className="row-desc">{settings?.libraryRoot || t('读取中…')}</div>
              <div className="row-hint">{t('原图、缩略图、数据库都在这个文件夹里，整体拷走即可迁移备份')}</div>
            </div>
            <div className="row-actions">
              <button className="ghost" onClick={() => window.refhub.openLibraryFolder()}>{t('打开文件夹')}</button>
              <button onClick={changeRoot} disabled={busy}>{busy ? t('处理中…') : t('更改位置…')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

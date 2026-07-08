import React, { useState, useEffect } from 'react';
import { t } from '../lib/i18n.js';

export default function AssetDetail({ asset, list, onNavigate, onClose, onOpenInBrowser, onChanged, showToast }) {
  const [full, setFull] = useState(asset);
  const [boards, setBoards] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    window.refhub.getAsset(asset.id).then((a) => {
      setFull(a);
      setTagInput((a.tags || []).join(' '));
      setNote(a.note || '');
    });
    window.refhub.listBoards().then(setBoards);
  }, [asset.id]);

  // ← → 在当前列表里翻上一张/下一张（输入框聚焦时不抢按键）
  const idx = list ? list.findIndex((x) => (x.item_id ?? x.id) === (asset.item_id ?? asset.id)) : -1;
  useEffect(() => {
    if (!list || !onNavigate) return;
    const onKey = (e) => {
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); onNavigate(list[idx - 1]); }
      if (e.key === 'ArrowRight' && idx >= 0 && idx < list.length - 1) { e.preventDefault(); onNavigate(list[idx + 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, idx, onNavigate]);

  const origUrl = `reflib://orig/${full.file_path.replace(/\\/g, '/')}`;

  const save = async () => {
    await window.refhub.updateAsset(full.id, {
      note,
      tags: tagInput.split(/[\s,，]+/).filter(Boolean),
    });
    onChanged();
    showToast(t('已保存'));
  };

  const addToBoard = async (boardId) => {
    if (!boardId) return;
    await window.refhub.addToBoard(Number(boardId), full.id);
    onChanged();
    showToast(t('已加入图板'));
  };

  const del = async () => {
    if (!confirm(t('从素材库删除这张图？（所有图板中也会移除）'))) return;
    await window.refhub.deleteAsset(full.id);
    onChanged();
    onClose();
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail" onClick={(e) => e.stopPropagation()}>
        <div className="image-side">
          <img src={origUrl} alt="" />
          {list && idx >= 0 && list.length > 1 && (
            <div className="nav-pos">{t('← → 翻图 · {n}/{total}', { n: idx + 1, total: list.length })}</div>
          )}
        </div>
        <div className="info-side">
          <h3>{full.page_title || t('（无标题）')}</h3>
          {full.author && (
            <div className="field">
              <div className="label">{t('作者')}</div>
              <div>{full.author}</div>
            </div>
          )}
          <div className="field">
            <div className="label">{t('采集时间 · 尺寸')}</div>
            <div>{full.created_at}{full.width ? ` · ${full.width}×${full.height}` : ''}</div>
          </div>
          <div className="field">
            <div className="label">{t('标签（空格分隔）')}</div>
            <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
          </div>
          <div className="field">
            <div className="label">{t('备注')}</div>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <div className="label">{t('加入图板')}</div>
            <select defaultValue="" onChange={(e) => { addToBoard(e.target.value); e.target.value = ''; }}>
              <option value="" disabled>{t('选择图板…')}</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="actions">
            {!!full.hidden && (
              <button
                className="primary"
                title={t('这张图目前只在图板里显示。收入素材库后可搜索、归档、复用')}
                onClick={async () => {
                  await window.refhub.assetUnhide(full.id);
                  setFull((f) => ({ ...f, hidden: 0 }));
                  onChanged();
                  showToast(t('已收入素材库'));
                }}
              >
                {t('⇪ 收入素材库')}
              </button>
            )}
            <button onClick={save}>{t('保存标签/备注')}</button>
            {full.page_url && (
              <>
                <button onClick={() => onOpenInBrowser(full.page_url)}>{t('↗ 跳转原页（程序内）')}</button>
                <button onClick={() => window.refhub.openExternal(full.page_url)}>{t('↗ 系统浏览器打开')}</button>
              </>
            )}
            <button className="danger" onClick={del}>{t('删除素材')}</button>
            <button onClick={onClose}>{t('关闭')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

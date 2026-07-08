import React, { useState, useEffect } from 'react';
import { thumbUrl } from './Library.jsx';
import { t } from '../lib/i18n.js';

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export default function GlobalSearch({ onClose, onOpenAsset, onOpenBoard, onOpenIdea }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ assets: [], boards: [], ideas: [] });

  useEffect(() => {
    if (!q.trim()) { setRes({ assets: [], boards: [], ideas: [] }); return; }
    const t = setTimeout(async () => {
      const kw = q.trim().toLowerCase();
      const [assets, boards, ideas] = await Promise.all([
        window.refhub.listAssets({ search: q.trim(), limit: 8 }),
        window.refhub.listBoards(),
        window.refhub.listIdeas(),
      ]);
      setRes({
        assets,
        boards: boards.filter((b) => b.name.toLowerCase().includes(kw)).slice(0, 5),
        ideas: ideas.filter((i) => (i.title + strip(i.preview)).toLowerCase().includes(kw)).slice(0, 5),
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const empty = q.trim() && !res.assets.length && !res.boards.length && !res.ideas.length;

  return (
    <div className="gs-overlay" onClick={onClose}>
      <div className="gs-panel" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          autoFocus
          placeholder={t('全局搜索：素材 / 图板 / 灵感笔记…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        />
        <div className="gs-results">
          {res.assets.length > 0 && (
            <>
              <div className="gs-section">{t('素材')}</div>
              <div className="gs-thumbs">
                {res.assets.map((a) => (
                  <img key={a.id} src={thumbUrl(a)} title={a.page_title || ''} onClick={() => onOpenAsset(a)} />
                ))}
              </div>
            </>
          )}
          {res.boards.length > 0 && <div className="gs-section">{t('图板')}</div>}
          {res.boards.map((b) => (
            <div key={b.id} className="gs-row" onClick={() => onOpenBoard(b.id)}>
              <span className="gi">⿻</span><span className="gt">{b.name}</span>
              <span className="gm">{t('{n} 张', { n: b.asset_count })}</span>
            </div>
          ))}
          {res.ideas.length > 0 && <div className="gs-section">{t('灵感笔记')}</div>}
          {res.ideas.map((i) => (
            <div key={i.id} className="gs-row" onClick={() => onOpenIdea(i.id)}>
              <span className="gi">✎</span><span className="gt">{i.title || t('未命名灵感')}</span>
              <span className="gm">{i.created_at?.slice(5, 10)}</span>
            </div>
          ))}
          {empty && <div className="gs-empty">{t('没搜到相关内容')}</div>}
          {!q.trim() && <div className="gs-empty">{t('输入关键词，一个框搜全部 · Esc 关闭')}</div>}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, memo } from 'react';
import { t } from '../lib/i18n.js';

export function thumbUrl(asset) {
  const rel = (asset.thumb_path || asset.file_path).replace(/\\/g, '/');
  return `reflib://${asset.thumb_path ? 'thumb' : 'orig'}/${rel}`;
}

// memo：搜索框打字、筛选切换时不重渲染没变的卡片
const CardImage = memo(function CardImage({ asset }) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  if (err) return <div className="card-broken">{t('⚠ 图片损坏')}<br /><span>{t('点开后可删除，或到设置里一键清理')}</span></div>;
  return (
    <img
      src={thumbUrl(asset)}
      loading="lazy"
      alt={asset.note || ''}
      className={loaded ? 'loaded' : ''}
      onLoad={() => setLoaded(true)}
      onError={() => setErr(true)}
    />
  );
});

// 图板选择弹层（fixed 定位，不被卡片圆角裁剪）。pop.assetIds 支持批量。
function BoardPicker({ pop, onClose, showToast, onChanged }) {
  const [boards, setBoards] = useState(null);
  const ids = pop.assetIds;

  useEffect(() => {
    window.refhub.listBoards().then(setBoards);
  }, []);

  const add = async (boardId) => {
    // 批量走一次 IPC + 一个事务：几十张也不卡，且不会中途失败留半截
    await window.refhub.addToBoardMany(boardId, ids);
    onChanged?.();
    showToast?.(ids.length > 1 ? t('已加入 {n} 张', { n: ids.length }) : t('已加入图板'));
    onClose();
  };

  const createAndAdd = async () => {
    const name = await window.appPrompt(t('新图板名称：'));
    if (!name) return;
    const b = await window.refhub.createBoard(name);
    add(b.id);
  };

  const style = {
    left: Math.min(pop.x, window.innerWidth - 230),
    top: Math.min(pop.y, window.innerHeight - 300),
  };

  return (
    <>
      <div className="pop-backdrop" onClick={onClose} />
      <div className="board-pop" style={style}>
        <div className="pop-title">{ids.length > 1 ? t('加入图板（{n} 张）', { n: ids.length }) : t('加入图板')}</div>
        <div className="pop-list">
          {boards === null && <div className="pop-hint">{t('加载中…')}</div>}
          {boards?.length === 0 && <div className="pop-hint">{t('还没有图板')}</div>}
          {boards?.map((b) => (
            <div key={b.id} className="pop-item" onClick={() => add(b.id)}>
              <span className="name">{b.name}</span>
              <span className="n">{b.asset_count}</span>
            </div>
          ))}
        </div>
        <div className="pop-item create" onClick={createAndAdd}>{t('＋ 新建图板…')}</div>
      </div>
    </>
  );
}

// memo：父组件的输入框打字等无关渲染不再牵连整个瀑布流（数百张卡片）
export const Waterfall = memo(function Waterfall({ assets, onOpenAsset, onRemove, showToast, onChanged, onDelete, selMode, selIds, onToggleSel, onAskAI, onSendToAi, onTogglePin, onRemoveFromCat }) {
  const [pop, setPop] = useState(null); // { assetIds, x, y }
  const [ctx, setCtx] = useState(null); // { x, y, asset } 卡片右键菜单
  const selected = (id) => selMode && selIds?.includes(id);

  if (!assets.length) {
    return (
      <div className="empty">
        <div className="glyph">◫</div>
        {t('还没有素材。去「浏览器」逛 Pinterest / ArtStation，')}
        <br />{t('悬停图片点 ✦ 收藏。')}
      </div>
    );
  }
  return (
    <>
      <div className="waterfall">
        {assets.map((a, i) => (
          <div
            className={'card' + (selected(a.id) ? ' sel' : '')}
            key={a.item_id ?? a.id}
            style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
            onClick={() => (selMode ? onToggleSel(a.id) : onOpenAsset(a, assets))}
            onContextMenu={(e) => { e.preventDefault(); if (!selMode) setCtx({ x: e.clientX, y: e.clientY, asset: a }); }}
            draggable={!selMode}
            onDragStart={(e) => {
              // 升级为操作系统级文件拖拽：网页版 AI（豆包/Gemini 等）、PS 等外部软件都能接收
              e.preventDefault();
              window.refhub.startDrag(a.id);
            }}
          >
            <CardImage asset={a} />
            {onTogglePin && !selMode && (
              <button
                className={'pin-btn' + (a.pinned_at ? ' on' : '')}
                title={a.pinned_at ? t('取消置顶') : t('置顶到最前')}
                onClick={(e) => { e.stopPropagation(); onTogglePin(a); }}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M14.6 2.6l6.8 6.8-1.7 1.6-.9-.3-3.4 3.4.3 3.7-1.6 1.6-4.1-4.1-5.9 5.9-1.4-1.4 5.9-5.9-4.1-4.1 1.6-1.6 3.7.3 3.4-3.4-.3-.9 1.7-1.6z" />
                </svg>
              </button>
            )}
            {selMode && <span className={'sel-check' + (selected(a.id) ? ' on' : '')}>{selected(a.id) ? '✓' : ''}</span>}
            <div className="veil">
              <div className="meta">{a.author || a.page_title || a.created_at}</div>
            </div>
            {!selMode && (
              <button
                className="quick-add"
                title={t('加入图板')}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setPop({ assetIds: [a.id], x: r.left - 180, y: r.bottom + 8 });
                }}
              >
                +
              </button>
            )}
            {!selMode && onDelete && (
              <button
                className="del-btn"
                title={t('从素材库删除')}
                onClick={(e) => { e.stopPropagation(); onDelete(a); }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 7h15" />
                  <path d="M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7" />
                  <path d="M6.5 7l.9 12.1c.1.7.6 1.2 1.3 1.2h6.6c.7 0 1.2-.5 1.3-1.2L17.5 7" />
                  <path d="M10 10.5v6M14 10.5v6" />
                </svg>
              </button>
            )}
            {onRemove && (
              <button className="remove-btn danger" onClick={(e) => { e.stopPropagation(); onRemove(a); }}>
                {t('移出')}
              </button>
            )}
          </div>
        ))}
      </div>
      {pop && <BoardPicker pop={pop} onClose={() => setPop(null)} showToast={showToast} onChanged={onChanged} />}
      {ctx && (
        <>
          <div className="pop-backdrop" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div className="ctx-menu fixed" style={{ left: Math.min(ctx.x, window.innerWidth - 210), top: Math.min(ctx.y, window.innerHeight - 240) }}>
            {onAskAI && (
              <div className="ctx-item" onClick={() => {
                const a = ctx.asset; setCtx(null);
                onAskAI({ imageAssets: [{ id: a.id, file_path: a.file_path, thumb_path: a.thumb_path, width: a.width, height: a.height }] });
              }}>
                <span>{t('✦ 发给小灵')}</span>
              </div>
            )}
            {onSendToAi && (
              <div className="ctx-item" onClick={() => { const a = ctx.asset; setCtx(null); onSendToAi(a); }}>
                <span>{t('⇪ 发送图片到 AI')}</span>
              </div>
            )}
            <div className="ctx-item" onClick={() => {
              const { x, asset } = ctx; setCtx(null);
              setPop({ assetIds: [asset.id], x: Math.min(x, window.innerWidth - 230), y: ctx.y });
            }}>
              <span>{t('＋ 加入图板…')}</span>
            </div>
            {onTogglePin && (
              <div className="ctx-item" onClick={() => { const a = ctx.asset; setCtx(null); onTogglePin(a); }}>
                <span>{ctx.asset.pinned_at ? t('取消置顶') : t('置顶到最前')}</span>
              </div>
            )}
            {onRemoveFromCat && (
              <div className="ctx-item" onClick={() => { const a = ctx.asset; setCtx(null); onRemoveFromCat(a); }}>
                <span>{t('移出这个分类')}</span>
              </div>
            )}
            <div className="ctx-item" onClick={() => { const a = ctx.asset; setCtx(null); onOpenAsset(a, assets); }}>
              <span>{t('打开详情')}</span>
            </div>
            {onRemove && (
              <div className="ctx-item danger" onClick={() => { const a = ctx.asset; setCtx(null); onRemove(a); }}>
                <span>{t('移出图板')}</span>
              </div>
            )}
            {onDelete && (
              <>
                <div className="ctx-divider" />
                <div className="ctx-item danger" onClick={() => { const a = ctx.asset; setCtx(null); onDelete(a); }}>
                  <span>{t('从素材库删除')}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
});

const PAGE = 500; // 每次加载的张数：底部「加载更多」按需追加

export default function Library({ refreshKey, active = true, onOpenAsset, showToast, onChanged, onSendToAi }) {
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState('');
  const [cats, setCats] = useState([]);
  const [catId, setCatId] = useState(null);
  const [dropCat, setDropCat] = useState(null);
  // 多选
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState([]);
  const [batchPop, setBatchPop] = useState(null); // { assetIds, x, y }
  // 分类栏整栏折叠
  const [railFold, setRailFold] = useState(() => localStorage.getItem('catRailFold') === '1');
  const toggleFold = () => setRailFold((v) => { const n = !v; localStorage.setItem('catRailFold', n ? '1' : '0'); return n; });
  // 分类内置顶
  const [pinBump, setPinBump] = useState(0);
  const togglePin = useCallback(async (a) => {
    const r = await window.refhub.toggleAssetPin(a.id, catId);
    if (r?.ok) { showToast?.(r.pinned ? t('已置顶，在这个分类里排最前') : t('已取消置顶')); setPinBump((b) => b + 1); }
  }, [catId, showToast]);

  // 把单张图移出当前分类（只解绑，素材还在库里）
  const removeFromCat = useCallback(async (a) => {
    await window.refhub.removeAssetFromCategory(a.id, catId);
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    setTotal((n) => Math.max(0, n - 1));
    window.refhub.listCategories().then(setCats);
    showToast?.(t('已移出这个分类（素材还在库里）'));
  }, [catId, showToast]);

  useEffect(() => {
    if (!active) return; // 不在素材库页时不拉数据，切回来会因 active 变化补一次
    window.refhub.listCategories().then(setCats);
  }, [refreshKey, active]);

  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryOpts = () => ({
    search: search || undefined,
    categoryId: catId || undefined,
  });

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const q = queryOpts();
      window.refhub.listAssets({ ...q, limit: PAGE, offset: 0 }).then(setAssets);
      window.refhub.countAssets(q).then((n) => setTotal(n || 0));
    }, 200);
    return () => clearTimeout(timer);
  }, [search, refreshKey, catId, pinBump, active]); // eslint-disable-line

  // 「加载更多」：按当前筛选条件从已加载位置继续取一页
  const loadMore = async () => {
    setLoadingMore(true);
    const rows = await window.refhub.listAssets({ ...queryOpts(), limit: PAGE, offset: assets.length });
    setLoadingMore(false);
    setAssets((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
  };

  const addCat = async () => {
    const name = await window.appPrompt(t('新分类的名字：'));
    if (!name) return;
    await window.refhub.addCategory(name);
    setCats(await window.refhub.listCategories());
  };

  const delCat = async (c, e) => {
    e.stopPropagation();
    if (!confirm(t('删除分类「{name}」？（里面的图片不受影响）', { name: c.name }))) return;
    await window.refhub.deleteCategory(c.id);
    if (catId === c.id) setCatId(null);
    setCats(await window.refhub.listCategories());
    showToast?.(t('已删除分类'));
  };

  // ---------- 多选批量 ----------
  const toggleSel = useCallback((id) => setSelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), []);
  const exitSel = () => { setSelMode(false); setSelIds([]); };
  const selectAllVisible = () => setSelIds(assets.map((a) => a.id));

  const delOne = useCallback(async (a) => {
    if (!confirm(t('从素材库彻底删除这张图？不可撤销（图板里的引用也会一并移除）。'))) return;
    await window.refhub.deleteAsset(a.id);
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    setTotal((n) => Math.max(0, n - 1));
    showToast?.(t('已删除'));
    onChanged?.();
  }, [showToast, onChanged]);

  const batchDelete = async () => {
    if (!selIds.length) return;
    if (!confirm(t('从素材库彻底删除选中的 {n} 张？不可撤销。', { n: selIds.length }))) return;
    // 批量走一次 IPC + 一个事务
    await window.refhub.deleteAssets(selIds);
    const gone = new Set(selIds);
    setAssets((prev) => prev.filter((a) => !gone.has(a.id)));
    setTotal((n) => Math.max(0, n - selIds.length));
    showToast?.(t('已删除 {n} 张', { n: selIds.length }));
    setSelIds([]);
    onChanged?.();
  };

  const openBatchBoard = (e) => {
    if (!selIds.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    setBatchPop({ assetIds: [...selIds], x: r.left - 60, y: r.bottom + 8 });
  };

  // 批量移出当前分类（一个事务解绑，素材都还在库里）
  const batchRemoveFromCat = async () => {
    if (!selIds.length || catId == null) return;
    await window.refhub.removeAssetsFromCategory(selIds, catId);
    const gone = new Set(selIds);
    setAssets((prev) => prev.filter((a) => !gone.has(a.id)));
    setTotal((n) => Math.max(0, n - selIds.length));
    window.refhub.listCategories().then(setCats);
    showToast?.(t('已移出 {n} 张（素材还在库里）', { n: selIds.length }));
    setSelIds([]);
  };

  const [importing, setImporting] = useState(false);
  const importImages = async () => {
    setImporting(true);
    const r = await window.refhub.importImagesDialog();
    setImporting(false);
    if (r?.canceled) return;
    if (!r?.ok) { showToast?.(t('导入失败')); return; }
    const parts = [t('已导入 {n} 张', { n: r.added })];
    if (r.dup) parts.push(t('{n} 张重复已跳过', { n: r.dup }));
    if (r.failed) parts.push(t('{n} 张失败', { n: r.failed }));
    showToast?.(parts.join('，'));
    onChanged?.();
  };

  return (
    <>
      <div className="toolbar">
        <span className="title">{t('素材库')}</span>
        <input
          type="text"
          placeholder={t('搜索标题 / 作者 / 标签 / 备注…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!selMode ? (
          <>
            <button className="primary" disabled={importing} onClick={importImages}>{importing ? t('导入中…') : t('＋ 导入图片')}</button>
            <button className="ghost" onClick={() => setSelMode(true)}>{t('多选')}</button>
            <span className="count">{t('{n} 张', { n: total || assets.length })}</span>
          </>
        ) : (
          <div className="batch-bar">
            <span className="count">{t('已选 {n}', { n: selIds.length })}</span>
            <button className="ghost" onClick={selectAllVisible}>{t('全选')}</button>
            <button disabled={!selIds.length} onClick={openBatchBoard}>{t('加入图板')}</button>
            {catId != null && (
              <button disabled={!selIds.length} onClick={batchRemoveFromCat}>{t('移出分类')}</button>
            )}
            <button className="danger" disabled={!selIds.length} onClick={batchDelete}>{t('删除')}</button>
            <button className="ghost" onClick={exitSel}>{t('取消')}</button>
          </div>
        )}
      </div>
      <div className="lib-body">
        <div className={'cat-wrap' + (railFold ? ' folded' : '')}>
          <button className="rail-fold" onClick={toggleFold} title={railFold ? t('展开分类栏') : t('收起分类栏')}>
            {railFold ? '»' : '«'}
          </button>
          <div className="cat-rail">
          {!railFold && (<>
          <div
            className={'cat-item' + (catId === null ? ' active' : '')}
            onClick={() => setCatId(null)}
          >
            <span className="name">{t('全部素材')}</span>
          </div>
          <div className="rail-title" style={{ marginTop: 14 }}>{t('我的分类')}</div>
          {cats.map((c) => (
            <div
              key={c.id}
              className={'cat-item' + (catId === c.id ? ' active' : '') + (dropCat === c.id ? ' drop-over' : '')}
              onClick={() => setCatId((v) => (v === c.id ? null : c.id))}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropCat(c.id); }}
              onDragLeave={() => setDropCat((v) => (v === c.id ? null : v))}
              onDrop={async (e) => {
                e.preventDefault();
                setDropCat(null);
                let assetId = e.dataTransfer.getData('text/asset-id');
                // 素材卡片现在是系统级文件拖拽：文件名就是素材 id（`${id}.${ext}`）
                if (!assetId && e.dataTransfer.files?.length) {
                  const p = window.refhub.getFilePath(e.dataTransfer.files[0]);
                  const cand = p ? p.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') : '';
                  if (cand && await window.refhub.getAsset(cand)) assetId = cand;
                }
                if (!assetId) return;
                await window.refhub.addAssetToCategory(assetId, c.id);
                setCats(await window.refhub.listCategories());
                showToast?.(t('已加入「{name}」', { name: c.name }));
              }}
            >
              <span className="name">{c.name}</span>
              <button className="del" title={t('删除分类')} onClick={(e) => delCat(c, e)}>×</button>
            </div>
          ))}
          {!cats.length && (
            <div className="cat-hint">{t('把素材卡片拖到这里的分类上即可归类。点下面新建你的第一个分类。')}</div>
          )}
          <button className="cat-add" onClick={addCat}>{t('＋ 新建分类')}</button>
          </>)}
          </div>
        </div>
        <div className="waterfall-wrap">
          <Waterfall
            assets={assets}
            onOpenAsset={onOpenAsset}
            showToast={showToast}
            onChanged={onChanged}
            onDelete={delOne}
            selMode={selMode}
            selIds={selIds}
            onToggleSel={toggleSel}
            onSendToAi={onSendToAi}
            onTogglePin={catId ? togglePin : undefined}
            onRemoveFromCat={catId ? removeFromCat : undefined}
          />
          {assets.length < total && (
            <div className="load-more">
              <button className="ghost" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? t('加载中…') : t('加载更多（已显示 {shown} / {total} 张）', { shown: assets.length, total })}
              </button>
            </div>
          )}
        </div>
      </div>
      {batchPop && <BoardPicker pop={batchPop} onClose={() => setBatchPop(null)} showToast={showToast} onChanged={onChanged} />}
    </>
  );
}

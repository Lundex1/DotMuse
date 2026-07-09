import React, { useState, useEffect, useCallback } from 'react';
import { Waterfall } from './Library.jsx';
import BoardCanvas from './BoardCanvas.jsx';
import { exportBoardImage } from '../lib/exportBoard.js';
import { t } from '../lib/i18n.js';

export default function Boards({ refreshKey, active = true, onOpenAsset, showToast, openRequest, onSendToAi }) {
  const [boards, setBoards] = useState([]);
  const [current, setCurrent] = useState(null);
  const [assets, setAssets] = useState([]);
  const [mode, setMode] = useState('canvas'); // canvas | grid
  const openTsRef = React.useRef(0);

  const loadBoards = useCallback(() => window.refhub.listBoards().then(setBoards), []);
  useEffect(() => {
    if (!active) return; // 不在图板页时不拉数据，切回来会因 active 变化补一次
    loadBoards();
  }, [refreshKey, loadBoards, active]);

  // 全局搜索直达某个图板
  useEffect(() => {
    if (!openRequest || openRequest.ts === openTsRef.current || !boards.length) return;
    const b = boards.find((x) => x.id === openRequest.id);
    if (b) { openTsRef.current = openRequest.ts; setCurrent(b); }
  }, [openRequest, boards]);

  useEffect(() => {
    // mode 也作为依赖：画布↔瀑布流切换时重新读库，
    // 否则画布重挂载拿到的是打开图板时的旧坐标，布局会错乱
    if (!active) return;
    if (current) window.refhub.boardAssets(current.id).then(setAssets);
  }, [current, refreshKey, mode, active]);

  const [nameEdit, setNameEdit] = useState(null); // { id, value } 改名中

  // 重命名输入框挂载时抢回被 webview 扣住的焦点。
  // 注意只 blur webview：blur 输入框自己会触发 onBlur 自动提交、瞬间关闭
  const grabFocus = (el) => {
    if (!el) return;
    const ae = document.activeElement;
    if (ae && ae.tagName === 'WEBVIEW') { try { ae.blur(); } catch (_) {} }
    setTimeout(() => el.focus(), 30);
  };
  const [menu, setMenu] = useState(null);         // { x, y, board } 总览右键菜单

  const exportBoard = async (b) => {
    setMenu(null);
    const [bAssets, bWidgets] = await Promise.all([
      window.refhub.boardAssets(b.id),
      window.refhub.boardWidgets(b.id),
    ]);
    await exportBoardImage(bAssets, bWidgets, b.name, showToast);
  };

  const createBoard = async () => {
    const name = await window.appPrompt(t('新图板名称：'));
    if (name) { await window.refhub.createBoard(name); loadBoards(); }
  };

  // .dlb 图板文件：导出整板（含图片+摆放+标注），导入别人的图板
  const exportDlb = async (b) => {
    setMenu(null);
    const r = await window.refhub.boardExportDlb(b.id, b.name);
    if (r.ok) showToast?.(t('已导出 {count} 张图 → {path}', { count: r.count, path: r.path }));
    else if (!r.canceled) showToast?.(t('⚠ 导出失败：{error}', { error: r.error }));
  };
  const importDlb = async () => {
    const r = await window.refhub.boardImportDlb();
    if (r?.canceled) return;
    if (!r?.ok) { showToast?.(t('⚠ 导入失败：{error}', { error: r.error })); return; }
    showToast?.(r.boardOnly
      ? t('已导入「{name}」：{images} 张（仅图板显示，不进素材库）', { name: r.name, images: r.images })
      : t('已导入「{name}」：{images} 张（新入库 {added}，复用已有 {linked}）', { name: r.name, images: r.images, added: r.added, linked: r.linked }));
    loadBoards();
  };

  const commitRename = async (id, value, oldName) => {
    setNameEdit(null);
    const name = (value || '').trim();
    if (!name || name === oldName) return;
    const updated = await window.refhub.renameBoard(id, name);
    // 重名冲突：db 层带 __dupName 标记回来，明确提示而不是静默失败
    if (updated?.__dupName) { showToast?.(t('⚠ 已有叫「{name}」的图板，换个名字吧', { name })); return; }
    loadBoards();
    if (current?.id === id && updated) setCurrent(updated);
    showToast?.(t('已重命名'));
  };

  const deleteBoard = async (board) => {
    if (!confirm(t('删除图板「{name}」？（库里的图片不受影响）', { name: board.name }))) return;
    await window.refhub.deleteBoard(board.id);
    if (current?.id === board.id) setCurrent(null);
    loadBoards();
  };

  const removeFromBoard = async (asset) => {
    await window.refhub.removeFromBoard(asset.item_id);
    setAssets((prev) => prev.filter((a) => a.item_id !== asset.item_id));
    loadBoards();
  };

  if (current) {
    return (
      <>
        <div className="toolbar">
          <button className="ghost" onClick={() => { setCurrent(null); loadBoards(); }}>{t('← 图板')}</button>
          {nameEdit?.id === current.id ? (
            <input
              type="text"
              className="name-input"
              ref={grabFocus}
              autoFocus
              value={nameEdit.value}
              onChange={(e) => setNameEdit({ id: current.id, value: e.target.value })}
              onBlur={() => commitRename(current.id, nameEdit.value, current.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(current.id, nameEdit.value, current.name);
                if (e.key === 'Escape') setNameEdit(null);
              }}
            />
          ) : (
            <span className="title" title={t('右键重命名')} onContextMenu={(e) => { e.preventDefault(); setNameEdit({ id: current.id, value: current.name }); }}>
              {current.name}
            </span>
          )}
          <span className="count">{t('{n} 张', { n: assets.length })}</span>
          <span className="grow" />
          <div className="seg">
            <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>{t('画布')}</button>
            <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>{t('瀑布流')}</button>
          </div>
          <button onClick={() => exportDlb(current)} title={t('打包成 .dlb 文件发给别人，对方「导入图板」即可原样打开（含图片、摆放、标注）')}>{t('⇪ 分享图板')}</button>
          <button onClick={() => window.refhub.openBoardFloat(current.id, current.name)} title={t('弹出置顶小窗，一边干活一边看参考')}>{t('⧉ 悬浮窗')}</button>
          <button className="danger" onClick={() => deleteBoard(current)}>{t('删除')}</button>
        </div>
        {mode === 'canvas' ? (
          <BoardCanvas boardId={current.id} boardName={current.name} assets={assets} onOpenAsset={onOpenAsset} showToast={showToast} onSendToAi={onSendToAi} />
        ) : (
          <div className="waterfall-wrap">
            <Waterfall assets={assets} onOpenAsset={onOpenAsset} onRemove={removeFromBoard} onSendToAi={onSendToAi} />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <span className="title">{t('工作图板')}</span>
        <span className="count">{t('{n} 个', { n: boards.length })}</span>
        <span className="grow" />
        <button onClick={importDlb} title={t('导入别人分享的 .dlb 图板文件，图片和摆放原样还原')}>{t('⇥ 导入图板…')}</button>
        <button className="primary" onClick={createBoard}>{t('＋ 新建图板')}</button>
      </div>
      <div className="waterfall-wrap">
        {!boards.length && (
          <div className="empty">
            <div className="glyph">⿻</div>
            {t('还没有图板。点右上角「＋ 新建图板」，')}<br />{t('把素材拖进来自由拼贴。')}
          </div>
        )}
        <div className="board-grid">
          {boards.map((b, i) => (
            <div
              className="board-card"
              key={b.id}
              style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              onClick={() => setCurrent(b)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, board: b }); }}
            >
              <div className="cover">
                {b.cover_thumb
                  ? <img src={`reflib://thumb/${b.cover_thumb.replace(/\\/g, '/')}`} alt="" />
                  : b.cover_file
                    ? <img src={`reflib://orig/${b.cover_file.replace(/\\/g, '/')}`} alt="" />
                    : <span>{t('空图板')}</span>}
              </div>
              <div className="info">
                {nameEdit?.id === b.id ? (
                  <input
                    type="text"
                    className="name-input"
                    ref={grabFocus}
                    autoFocus
                    value={nameEdit.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNameEdit({ id: b.id, value: e.target.value })}
                    onBlur={() => commitRename(b.id, nameEdit.value, b.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(b.id, nameEdit.value, b.name);
                      if (e.key === 'Escape') setNameEdit(null);
                    }}
                  />
                ) : (
                  <div className="name" title={t('右键重命名')}>
                    {b.name}
                  </div>
                )}
                <div className="count">{t('{n} 张', { n: b.asset_count })} · {b.created_at?.slice(0, 10)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {menu && (
        <>
          <div className="pop-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu fixed" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 160) }}>
            <div className="ctx-item" onClick={() => { setMenu(null); setNameEdit({ id: menu.board.id, value: menu.board.name }); }}>
              <span>{t('重命名')}</span>
            </div>
            <div className="ctx-item" onClick={() => exportBoard(menu.board)}>
              <span>{t('导出为整张图片…')}</span>
            </div>
            <div className="ctx-item" onClick={() => exportDlb(menu.board)}>
              <span>{t('导出为图板文件(.dlb)…')}</span>
            </div>
            <div className="ctx-divider" />
            <div className="ctx-item danger" onClick={() => { setMenu(null); deleteBoard(menu.board); }}>
              <span>{t('删除图板')}</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

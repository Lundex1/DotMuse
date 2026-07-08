import React, { useState, useEffect, useCallback } from 'react';
import BoardCanvas from './BoardCanvas.jsx';

// 图板悬浮小窗入口：?float=board&id=N
export default function FloatBoard({ boardId }) {
  const [assets, setAssets] = useState([]);

  const reload = useCallback(() => {
    window.refhub.boardAssets(boardId).then(setAssets);
  }, [boardId]);

  useEffect(() => {
    reload();
    // 分发版 preload 没有 onAssetUpdated，可选调用兼容两版
    const off = window.refhub.onAssetAdded?.(reload) || (() => {});
    const offUpd = window.refhub.onAssetUpdated?.(reload) || (() => {});
    return () => { off(); offUpd(); };
  }, [reload]);

  return (
    <div className="float-app">
      <BoardCanvas
        boardId={boardId}
        boardName=""
        assets={assets}
        onOpenAsset={() => {}}
        showToast={() => {}}
      />
    </div>
  );
}

const Database = require('better-sqlite3');

let db = null;

function close() {
  if (db) { try { db.close(); } catch (_) {} db = null; }
}

function init(dbPath) {
  close();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      thumb_path TEXT,
      ext TEXT,
      bytes INTEGER,
      width INTEGER,
      height INTEGER,
      source_url TEXT,
      page_url TEXT,
      page_title TEXT,
      author TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (asset_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS board_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      asset_id TEXT NOT NULL,
      x REAL, y REAL, w REAL, z INTEGER,
      locked INTEGER DEFAULT 0,
      flip INTEGER DEFAULT 0,
      rot REAL DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id);
    CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      position INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS asset_categories (
      asset_id TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (asset_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS asset_facets (
      asset_id TEXT NOT NULL,
      facet TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (asset_id, facet, value)
    );
    CREATE INDEX IF NOT EXISTS idx_facets ON asset_facets(facet, value);
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS board_widgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT DEFAULT '',
      x REAL, y REAL, w REAL, h REAL,
      z INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
  // 旧表 board_assets（一图板一图只允许一份）迁移到 board_items（支持一图多副本）
  const oldTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'board_assets'").get();
  if (oldTable) {
    for (const col of ['x REAL', 'y REAL', 'w REAL', 'z INTEGER', 'locked INTEGER DEFAULT 0', 'flip INTEGER DEFAULT 0', 'rot REAL DEFAULT 0']) {
      try { db.exec(`ALTER TABLE board_assets ADD COLUMN ${col}`); } catch (_) {}
    }
    // 事务保证迁移原子性：中途失败整体回滚，下次启动重来，不会复制出重复行
    db.exec('BEGIN');
    try {
      db.exec(`INSERT INTO board_items (board_id, asset_id, x, y, w, z, locked, flip, rot, added_at)
               SELECT board_id, asset_id, x, y, w, z, locked, flip, rot, added_at FROM board_assets`);
      db.exec('DROP TABLE board_assets');
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }
  }
  // 画布文字/框名的排版样式（迁移旧库）
  try { db.exec('ALTER TABLE board_widgets ADD COLUMN style TEXT'); } catch (_) {}
  // 内容指纹：采集查重用（旧图不回填，只对新图生效）
  try { db.exec('ALTER TABLE assets ADD COLUMN hash TEXT'); } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash)'); } catch (_) {}
  // "仅图板显示"标记：hidden=1 的图不出现在素材库/搜索里，只在引用它的图板里可见
  try { db.exec('ALTER TABLE assets ADD COLUMN hidden INTEGER DEFAULT 0'); } catch (_) {}
  // 合集内置顶时间（null = 未置顶）
  try { db.exec('ALTER TABLE asset_categories ADD COLUMN pinned_at TEXT'); } catch (_) {}
  // 按 asset_id 的反向查找索引：删素材 / 查隐藏孤儿不再全表扫
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_board_items_asset ON board_items(asset_id)'); } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_asset_categories_cat ON asset_categories(category_id)'); } catch (_) {}
  // 历史数据卫生：老版本删除不级联留下的残留关联/悬空图板项，启动时一次清掉
  try {
    db.exec(`
      DELETE FROM board_items WHERE asset_id NOT IN (SELECT id FROM assets);
      DELETE FROM asset_tags WHERE asset_id NOT IN (SELECT id FROM assets);
      DELETE FROM asset_categories WHERE asset_id NOT IN (SELECT id FROM assets);
      DELETE FROM asset_facets WHERE asset_id NOT IN (SELECT id FROM assets);
    `);
  } catch (_) {}
  // 首次启动播种场景设计常用大类
  const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (catCount === 0) {
    const seed = ['建筑风格', '色彩氛围', '光影参考', '材质纹理', '构图视角', '自然环境', '道具与载具', '角色与生物'];
    const ins = db.prepare('INSERT INTO categories (name, position) VALUES (?, ?)');
    seed.forEach((name, i) => ins.run(name, i));
  }
}

function attachTags(asset) {
  if (!asset) return asset;
  asset.tags = db.prepare(`
    SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id = t.id
    WHERE at.asset_id = ?
  `).all(asset.id).map(r => r.name);
  return asset;
}

function insertAsset(a) {
  db.prepare(`
    INSERT INTO assets (id, file_path, thumb_path, ext, bytes, width, height,
      source_url, page_url, page_title, author, note, hash, hidden)
    VALUES (@id, @file_path, @thumb_path, @ext, @bytes, @width, @height,
      @source_url, @page_url, @page_title, @author, @note, @hash, @hidden)
  `).run({ hash: null, hidden: 0, ...a });
  return getAsset(a.id);
}

function setAssetHidden(id, hidden) {
  db.prepare('UPDATE assets SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  return true;
}

function findAssetByHash(hash) {
  if (!hash) return null;
  const row = db.prepare('SELECT * FROM assets WHERE hash = ? LIMIT 1').get(hash);
  return row ? attachTags(row) : null;
}

function getAsset(id) {
  return attachTags(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
}

function updateAsset(id, fields) {
  const allowed = ['note', 'author', 'page_title'];
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) {
      db.prepare(`UPDATE assets SET ${k} = ? WHERE id = ?`).run(fields[k], id);
    }
  }
  if (Array.isArray(fields.tags)) setTags(id, fields.tags);
  return getAsset(id);
}

function setTags(assetId, tagNames) {
  db.transaction(() => { setTagsInner(assetId, tagNames); })();
}

function setTagsInner(assetId, tagNames) {
  db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)');
  for (const name of tagNames) {
    const n = String(name).trim();
    if (!n) continue;
    insTag.run(n);
    link.run(assetId, getTag.get(n).id);
  }
}

function listAssets({ search, boardId, categoryId, facets, limit = 500, offset = 0 } = {}) {
  let sql, params;
  if (boardId) {
    sql = `SELECT a.*, bi.id AS item_id, bi.x, bi.y, bi.w, bi.z, bi.locked, bi.flip, bi.rot
           FROM assets a JOIN board_items bi ON bi.asset_id = a.id
           WHERE bi.board_id = @boardId`;
    params = { boardId, limit, offset };
  } else if (categoryId) {
    // 合集视图：连出置顶时间，置顶的图排最前（"仅图板"的隐藏图不出现）
    sql = `SELECT a.*, ac.pinned_at FROM assets a
           JOIN asset_categories ac ON ac.asset_id = a.id AND ac.category_id = @categoryId
           WHERE COALESCE(a.hidden, 0) = 0`;
    params = { categoryId, limit, offset };
  } else {
    sql = 'SELECT a.* FROM assets a WHERE COALESCE(a.hidden, 0) = 0';
    params = { limit, offset };
  }
  // 分面筛选：多个选中项之间取交集
  if (Array.isArray(facets)) {
    facets.forEach((f, i) => {
      sql += ` AND a.id IN (SELECT af.asset_id FROM asset_facets af WHERE af.facet = @f${i} AND af.value = @v${i})`;
      params[`f${i}`] = f.facet;
      params[`v${i}`] = f.value;
    });
  }
  if (search) {
    // %/_ 转义：搜"100%"就是找字面的 100%，不是通配
    sql += ` AND (a.page_title LIKE @q ESCAPE '\\' OR a.author LIKE @q ESCAPE '\\' OR a.note LIKE @q ESCAPE '\\'
             OR a.id IN (SELECT at.asset_id FROM asset_tags at
                         JOIN tags t ON t.id = at.tag_id WHERE t.name LIKE @q ESCAPE '\\'))`;
    params.q = `%${String(search).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  }
  if (!boardId && categoryId) {
    sql += ' ORDER BY (ac.pinned_at IS NULL), ac.pinned_at DESC, a.created_at DESC LIMIT @limit OFFSET @offset';
  } else {
    sql += ' ORDER BY a.created_at DESC LIMIT @limit OFFSET @offset';
  }
  return db.prepare(sql).all(params).map(attachTags);
}

// 与 listAssets 同条件的总数：素材库「加载更多」分页显示 已显示/总数 用
function countAssets({ search, boardId, categoryId, facets } = {}) {
  let sql, params;
  if (boardId) {
    sql = 'SELECT COUNT(*) AS n FROM assets a JOIN board_items bi ON bi.asset_id = a.id WHERE bi.board_id = @boardId';
    params = { boardId };
  } else if (categoryId) {
    sql = `SELECT COUNT(*) AS n FROM assets a
           JOIN asset_categories ac ON ac.asset_id = a.id AND ac.category_id = @categoryId
           WHERE COALESCE(a.hidden, 0) = 0`;
    params = { categoryId };
  } else {
    sql = 'SELECT COUNT(*) AS n FROM assets a WHERE COALESCE(a.hidden, 0) = 0';
    params = {};
  }
  if (Array.isArray(facets)) {
    facets.forEach((f, i) => {
      sql += ` AND a.id IN (SELECT af.asset_id FROM asset_facets af WHERE af.facet = @f${i} AND af.value = @v${i})`;
      params[`f${i}`] = f.facet;
      params[`v${i}`] = f.value;
    });
  }
  if (search) {
    sql += ` AND (a.page_title LIKE @q ESCAPE '\\' OR a.author LIKE @q ESCAPE '\\' OR a.note LIKE @q ESCAPE '\\'
             OR a.id IN (SELECT at.asset_id FROM asset_tags at
                         JOIN tags t ON t.id = at.tag_id WHERE t.name LIKE @q ESCAPE '\\'))`;
    params.q = `%${String(search).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  }
  return db.prepare(sql).get(params).n;
}

// 合集内置顶开关：置顶的图在该合集排最前，再次调用取消
function toggleAssetPin(assetId, categoryId) {
  const row = db.prepare('SELECT pinned_at FROM asset_categories WHERE asset_id = ? AND category_id = ?').get(assetId, categoryId);
  if (!row) return { ok: false };
  if (row.pinned_at) {
    db.prepare('UPDATE asset_categories SET pinned_at = NULL WHERE asset_id = ? AND category_id = ?').run(assetId, categoryId);
    return { ok: true, pinned: false };
  }
  db.prepare("UPDATE asset_categories SET pinned_at = datetime('now', 'localtime') WHERE asset_id = ? AND category_id = ?").run(assetId, categoryId);
  return { ok: true, pinned: true };
}

function deleteAssetRows(id) {
  db.prepare('DELETE FROM board_items WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM asset_categories WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM asset_facets WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
}

function deleteAsset(id) {
  // 事务 + 全量级联：中途断电不留半截，合集/分面计数不虚高
  db.transaction(deleteAssetRows)(id);
  return true;
}

// 批量删除：一个事务跑完，「多选删除」一次 IPC 完成且原子
function deleteAssets(ids) {
  db.transaction((list) => { for (const id of list) deleteAssetRows(id); })(ids || []);
  return true;
}

function listBoards() {
  // 封面优先取最新的"有缩略图"项；全都没有缩略图时退回原图（cover_file）。
  // added_at 只有秒级精度，补 id 排序保证同秒加入时封面稳定取最新。
  return db.prepare(`
    SELECT b.*, COUNT(bi.asset_id) AS asset_count,
      (SELECT a.thumb_path FROM board_items bi2 JOIN assets a ON a.id = bi2.asset_id
       WHERE bi2.board_id = b.id AND a.thumb_path IS NOT NULL
       ORDER BY bi2.added_at DESC, bi2.id DESC LIMIT 1) AS cover_thumb,
      (SELECT a2.file_path FROM board_items bi3 JOIN assets a2 ON a2.id = bi3.asset_id
       WHERE bi3.board_id = b.id
       ORDER BY bi3.added_at DESC, bi3.id DESC LIMIT 1) AS cover_file
    FROM boards b LEFT JOIN board_items bi ON bi.board_id = b.id
    GROUP BY b.id ORDER BY b.created_at DESC
  `).all();
}

function getOrCreateBoardByName(name) {
  db.prepare('INSERT OR IGNORE INTO boards (name) VALUES (?)').run(name);
  return db.prepare('SELECT * FROM boards WHERE name = ?').get(name);
}

function renameBoard(id, name) {
  // 重名（UNIQUE 冲突）不抛异常：带 __dupName 标记回去让前端提示
  try {
    db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, id);
  } catch (_) {
    const cur = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    return cur ? { ...cur, __dupName: true } : null;
  }
  return db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
}

function deleteBoard(id) {
  // 只删图板（引用层），库里的图片不受影响
  db.transaction(() => {
    db.prepare('DELETE FROM board_items WHERE board_id = ?').run(id);
    db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  })();
  // "仅图板显示"的隐藏图：最后一个图板引用没了就交给主进程物理清理，避免不可见占盘
  return { ok: true, orphans: listHiddenOrphans() };
}

// 隐藏图（仅图板 / AI 临时参考图）的孤儿：没有任何图板引用。
// 启动时和删图板时由主进程物理清理文件
function listHiddenOrphans() {
  return db.prepare(`
    SELECT a.id, a.file_path, a.thumb_path FROM assets a
    WHERE COALESCE(a.hidden, 0) = 1
      AND NOT EXISTS (SELECT 1 FROM board_items bi WHERE bi.asset_id = a.id)
  `).all();
}

// 单个图板项（连素材字段一起返回，供画布直接摆放）
function getBoardItem(itemId) {
  const row = db.prepare(`
    SELECT a.*, bi.id AS item_id, bi.board_id, bi.x, bi.y, bi.w, bi.z, bi.locked, bi.flip, bi.rot
    FROM board_items bi JOIN assets a ON a.id = bi.asset_id WHERE bi.id = ?
  `).get(itemId);
  return row ? attachTags(row) : null;
}

// 常规「加入图板」保持幂等：已在图板上就返回现有项，不产生重复。
// 想要多副本走 duplicateBoardItem（画布内复制/Alt 拖拽）。
function addAssetToBoard(boardId, assetId) {
  const existing = db.prepare('SELECT id FROM board_items WHERE board_id = ? AND asset_id = ? LIMIT 1').get(boardId, assetId);
  if (existing) return getBoardItem(existing.id);
  const r = db.prepare('INSERT INTO board_items (board_id, asset_id) VALUES (?, ?)').run(boardId, assetId);
  return getBoardItem(r.lastInsertRowid);
}

// 批量入板：一个事务完成（多选「加入图板」一次 IPC）
function addAssetsToBoard(boardId, assetIds) {
  const out = [];
  db.transaction(() => {
    for (const id of assetIds || []) {
      const it = addAssetToBoard(boardId, id);
      if (it) out.push(it);
    }
  })();
  return out;
}

// 撤销「移出图板」时按原布局恢复（总是新插入，不做幂等）
function restoreBoardItem(boardId, assetId, layout = {}) {
  // 撤销前素材可能已被从库中删除：不插入悬空引用（图板计数会虚高）
  if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) return null;
  const r = db.prepare(`
    INSERT INTO board_items (board_id, asset_id, x, y, w, z, locked, flip, rot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(boardId, assetId, layout.x ?? null, layout.y ?? null, layout.w ?? null,
    layout.z ?? 0, layout.locked ? 1 : 0, layout.flip ? 1 : 0, layout.rot ?? 0);
  return getBoardItem(r.lastInsertRowid);
}

// 画布内复制副本：同图新实例，位置错开、置于顶层、解除锁定
function duplicateBoardItem(itemId, dx = 28, dy = 28) {
  const src = db.prepare('SELECT * FROM board_items WHERE id = ?').get(itemId);
  if (!src) return null;
  const topZ = db.prepare('SELECT COALESCE(MAX(z), 0) AS z FROM board_items WHERE board_id = ?').get(src.board_id).z;
  const r = db.prepare(`
    INSERT INTO board_items (board_id, asset_id, x, y, w, z, locked, flip, rot)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(src.board_id, src.asset_id, (src.x ?? 0) + dx, (src.y ?? 0) + dy, src.w, topZ + 1, src.flip || 0, src.rot || 0);
  return getBoardItem(r.lastInsertRowid);
}

function updateBoardItem(itemId, fields) {
  const allowed = ['x', 'y', 'w', 'z', 'locked', 'flip', 'rot'];
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k) && fields[k] !== undefined) {
      db.prepare(`UPDATE board_items SET ${k} = ? WHERE id = ?`).run(fields[k], itemId);
    }
  }
  return true;
}

function removeBoardItem(itemId) {
  db.prepare('DELETE FROM board_items WHERE id = ?').run(itemId);
  return true;
}

// ---------- AI 归纳大类 ----------

function listCategories() {
  return db.prepare(`
    SELECT c.*, COUNT(ac.asset_id) AS asset_count
    FROM categories c LEFT JOIN asset_categories ac ON ac.category_id = c.id
    GROUP BY c.id ORDER BY c.position, c.id
  `).all();
}

function addCategory(name) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories').get().p;
  db.prepare('INSERT OR IGNORE INTO categories (name, position) VALUES (?, ?)').run(name, pos);
  return db.prepare('SELECT * FROM categories WHERE name = ?').get(name);
}

function deleteCategory(id) {
  db.prepare('DELETE FROM asset_categories WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return true;
}

function renameCategory(id, name) {
  // 重名（UNIQUE 冲突）时静默跳过
  try { db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id); } catch (_) {}
  return true;
}

// 首启按创作方向替换种子分类：只清掉还没挂图的空分类，有图的绝不动
function replaceSeedCategories(names) {
  db.transaction(() => {
    const empty = db.prepare(`
      SELECT c.id FROM categories c
      LEFT JOIN asset_categories ac ON ac.category_id = c.id
      GROUP BY c.id HAVING COUNT(ac.asset_id) = 0
    `).all();
    for (const r of empty) db.prepare('DELETE FROM categories WHERE id = ?').run(r.id);
    for (const n of names || []) addCategory(n);
  })();
  return true;
}

function categoryNames() {
  return db.prepare('SELECT name FROM categories ORDER BY position, id').all().map((r) => r.name);
}

// 手动拖拽：把素材挂进指定大类
function addAssetToCategory(assetId, categoryId) {
  db.prepare('INSERT OR IGNORE INTO asset_categories (asset_id, category_id) VALUES (?, ?)').run(assetId, categoryId);
  return true;
}

// 把素材移出某个合集：只解绑关联（含置顶状态），素材本身不受影响
function removeAssetFromCategory(assetId, categoryId) {
  db.prepare('DELETE FROM asset_categories WHERE asset_id = ? AND category_id = ?').run(assetId, categoryId);
  return true;
}

// 批量移出（多选一次完成）
function removeAssetsFromCategory(assetIds, categoryId) {
  db.transaction(() => {
    const del = db.prepare('DELETE FROM asset_categories WHERE asset_id = ? AND category_id = ?');
    for (const id of assetIds || []) del.run(id, categoryId);
  })();
  return true;
}

// AI 归档结果：按名称把素材挂进大类（未知名称忽略）
function setAssetCategories(assetId, names) {
  const get = db.prepare('SELECT id FROM categories WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO asset_categories (asset_id, category_id) VALUES (?, ?)');
  for (const name of names || []) {
    const c = get.get(String(name).trim());
    if (c) link.run(assetId, c.id);
  }
}

// ---------- 分面归档（题材/风格/用途/色调） ----------

function setAssetFacets(assetId, fx = {}) {
  // 事务：清旧写新一体完成，中断不会留下"分面被清了还没写回"的半截状态
  db.transaction(() => {
    db.prepare('DELETE FROM asset_facets WHERE asset_id = ?').run(assetId);
    const ins = db.prepare('INSERT OR IGNORE INTO asset_facets (asset_id, facet, value) VALUES (?, ?, ?)');
    const norm = (s) => String(s || '').trim();
    if (norm(fx.subject)) ins.run(assetId, 'subject', norm(fx.subject));
    for (const s of fx.styles || []) if (norm(s)) ins.run(assetId, 'style', norm(s));
    for (const u of fx.uses || []) if (norm(u)) ins.run(assetId, 'use', norm(u));
    if (norm(fx.tone)) ins.run(assetId, 'tone', norm(fx.tone));
  })();
}

function listFacets() {
  return db.prepare(`
    SELECT facet, value, COUNT(*) AS n
    FROM asset_facets GROUP BY facet, value
    ORDER BY facet, n DESC, value
  `).all();
}

// ---------- 对话总结文档 ----------

function createNote(title, content) {
  const r = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run(title, content);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(r.lastInsertRowid);
}

function listNotes() {
  return db.prepare('SELECT id, title, substr(content, 1, 200) AS preview, created_at FROM notes ORDER BY created_at DESC').all();
}

function getNote(id) {
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
}

function deleteNote(id) {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return true;
}

// ---------- 灵感笔记 ----------

function createIdea() {
  const r = db.prepare("INSERT INTO ideas (title, content) VALUES ('', '')").run();
  return db.prepare('SELECT * FROM ideas WHERE id = ?').get(r.lastInsertRowid);
}

function listIdeas() {
  return db.prepare('SELECT id, title, substr(content, 1, 300) AS preview, created_at, updated_at FROM ideas ORDER BY created_at DESC').all();
}

function getIdea(id) {
  return db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
}

function updateIdea(id, { title, content }) {
  db.prepare("UPDATE ideas SET title = ?, content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
    .run(title ?? '', content ?? '', id);
  return getIdea(id);
}

function deleteIdea(id) {
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  return true;
}

// ---------- 画布组件（文字标注 / 归纳方框） ----------

function listWidgets(boardId) {
  return db.prepare('SELECT * FROM board_widgets WHERE board_id = ? ORDER BY z').all(boardId);
}

function addWidget(boardId, w) {
  const r = db.prepare(`
    INSERT INTO board_widgets (board_id, kind, content, x, y, w, h, z)
    VALUES (@boardId, @kind, @content, @x, @y, @w, @h, @z)
  `).run({ boardId, content: '', z: 0, ...w });
  return db.prepare('SELECT * FROM board_widgets WHERE id = ?').get(r.lastInsertRowid);
}

function updateWidget(id, fields) {
  const allowed = ['content', 'x', 'y', 'w', 'h', 'z', 'style'];
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) {
      db.prepare(`UPDATE board_widgets SET ${k} = ? WHERE id = ?`).run(fields[k], id);
    }
  }
  return db.prepare('SELECT * FROM board_widgets WHERE id = ?').get(id);
}

function deleteWidget(id) {
  db.prepare('DELETE FROM board_widgets WHERE id = ?').run(id);
  return true;
}

module.exports = {
  init, close, insertAsset, getAsset, updateAsset, listAssets, countAssets, deleteAsset, deleteAssets, findAssetByHash, setAssetHidden, listHiddenOrphans,
  listBoards, getOrCreateBoardByName, renameBoard, deleteBoard,
  addAssetToBoard, addAssetsToBoard, removeBoardItem, updateBoardItem, getBoardItem, duplicateBoardItem, restoreBoardItem,
  createNote, listNotes, getNote, deleteNote,
  createIdea, listIdeas, getIdea, updateIdea, deleteIdea,
  listCategories, addCategory, deleteCategory, renameCategory, categoryNames, setAssetCategories, addAssetToCategory, removeAssetFromCategory, removeAssetsFromCategory, toggleAssetPin, replaceSeedCategories,
  setAssetFacets, listFacets,
  listWidgets, addWidget, updateWidget, deleteWidget,
};

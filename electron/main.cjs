const { app, BrowserWindow, ipcMain, shell, nativeImage, net, protocol, session, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const db = require('./db.cjs');

// reflib:// 需要 fetch 权限：图板导出用 fetch 读原图合成 PNG，
// 未注册特权时 fetch 自定义协议会被 Chromium 拒绝（img 标签不受影响）
protocol.registerSchemesAsPrivileged([
  { scheme: 'reflib', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// 独立用户数据目录：与完整版 Dotli 隔离，各自的登录态/配置/单实例锁互不干扰
app.setPath('userData', path.join(app.getPath('appData'), 'dotmuse'));

// 内嵌浏览器登录 Google 常被「此浏览器或应用可能不安全」拦截：
// 从 UA 里去掉 Electron / 应用名标识，伪装成普通 Chrome，能绕过大部分检测
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|dotmuse|DotMuse)\/[\d.]+/g, '');

// 单实例锁：两个实例共用登录数据会互相锁死 cookie 库（表现为网站全部"掉线"）。
// 重复启动时直接唤起已开的窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 素材库根目录：原图、缩略图、数据库全部在这里，整体拷走即迁移。
// 位置可在设置里更改，持久化于 userData/config.json
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}
function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const cfg0 = loadConfig();
// 首次启动没有配置：默认放到「文档\点灵素材库」，并标记 firstRun 触发欢迎向导
let LIBRARY_ROOT = cfg0.libraryRoot || path.join(app.getPath('documents'), '点灵素材库');
let ORIGINALS_DIR = path.join(LIBRARY_ROOT, 'originals');
let THUMBS_DIR = path.join(LIBRARY_ROOT, 'thumbs');
let firstRun = !cfg0.libraryRoot;

function applyLibraryRoot(root) {
  LIBRARY_ROOT = root;
  ORIGINALS_DIR = path.join(root, 'originals');
  THUMBS_DIR = path.join(root, 'thumbs');
}

let mainWindow = null;

function ensureLibraryDirs() {
  for (const d of [LIBRARY_ROOT, ORIGINALS_DIR, THUMBS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

// 探测目标位置是否可写：建目录 + 写一个临时文件再删。
// 返回 null 表示可写，否则返回一句给用户看的中文原因。
function checkWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.dotmuse-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return null;
  } catch (e) {
    const perm = e.code === 'EPERM' || e.code === 'EACCES';
    return {
      perm,
      msg: perm
        ? '这个位置没有写入权限。\n常见原因：系统盘保护目录、只读/移动硬盘，或被 Windows 安全中心「受控文件夹访问」/杀毒软件拦截。'
        : `这个位置暂时不能用：${e.message}`,
    };
  }
}

// ---------- 主进程弹窗的多语言（语言偏好存 config.lang，渲染层切换时同步过来） ----------
const MAIN_DICTS = {
  en: {
    '导入图板': 'Import Board',
    '「{name}」共 {n} 张图，怎么导入？': '"{name}" contains {n} images. How to import?',
    '收入素材库：图片进素材库，可搜索、复用到别的图板。\n只放进图板：图片只在这个图板里显示，素材库保持干净；删除该图板时这些图会一并清理。': 'Add to Library: images become searchable and reusable in other boards.\nBoard only: images appear only in this board; they are cleaned up when the board is deleted.',
    '同时收入素材库': 'Add to Library',
    '只放进图板': 'Board only',
    '取消': 'Cancel',
    '选择点灵图板文件': 'Choose a Dotli board file',
    '点灵图板文件': 'Dotli board file',
    '选择要导入素材库的图片': 'Choose images to import',
    '图片': 'Images',
    '选择素材库存放位置': 'Choose library location',
    '选择新的素材库位置': 'Choose new library location',
    '无法使用该位置': 'Location not usable',
    '素材库位置没有更改': 'Library location unchanged',
    '这个位置需要更高权限才能写入': 'This location requires elevated permission',
    '以管理员身份重启': 'Restart as administrator',
    '换个位置': 'Pick another location',
    '知道了': 'OK',
    '更改存储位置': 'Change storage location',
    '迁移现有素材过去': 'Migrate existing library',
    '直接使用该素材库': 'Use that library',
    '在新位置从零开始': 'Start fresh there',
    '「迁移」会把当前全部原图、缩略图和数据库复制到新位置（原位置保留，作为备份）。': '"Migrate" copies all originals, thumbnails and the database to the new location (the old one is kept as a backup).',
  },
  ja: {
    '导入图板': 'ボードをインポート',
    '「{name}」共 {n} 张图，怎么导入？': '「{name}」には {n} 枚の画像があります。どのように取り込みますか？',
    '收入素材库：图片进素材库，可搜索、复用到别的图板。\n只放进图板：图片只在这个图板里显示，素材库保持干净；删除该图板时这些图会一并清理。': 'ライブラリに追加：検索でき、他のボードでも再利用できます。\nボードのみ：このボードにだけ表示され、ボード削除時に一緒に削除されます。',
    '同时收入素材库': 'ライブラリに追加',
    '只放进图板': 'ボードのみ',
    '取消': 'キャンセル',
    '选择点灵图板文件': 'Dotli ボードファイルを選択',
    '点灵图板文件': 'Dotli ボードファイル',
    '选择要导入素材库的图片': 'インポートする画像を選択',
    '图片': '画像',
    '选择素材库存放位置': 'ライブラリの保存先を選択',
    '选择新的素材库位置': '新しい保存先を選択',
    '无法使用该位置': 'この場所は使用できません',
    '素材库位置没有更改': '保存先は変更されていません',
    '这个位置需要更高权限才能写入': 'この場所への書き込みには管理者権限が必要です',
    '以管理员身份重启': '管理者として再起動',
    '换个位置': '別の場所を選ぶ',
    '知道了': 'OK',
    '更改存储位置': '保存先の変更',
    '迁移现有素材过去': '既存の素材を移行',
    '直接使用该素材库': 'そのライブラリを使う',
    '在新位置从零开始': '新しい場所でゼロから',
    '「迁移」会把当前全部原图、缩略图和数据库复制到新位置（原位置保留，作为备份）。': '「移行」は原画・サムネイル・データベースを新しい場所へコピーします（元の場所はバックアップとして残ります）。',
  },
};
function T(zh, vars) {
  const lang = uiLang();
  let s = zh;
  if (lang !== 'zh') s = (MAIN_DICTS[lang] && MAIN_DICTS[lang][zh]) || zh;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// 系统语言映射（用户没手动选语言时的默认）
function sysLangMain() {
  try {
    const l = (app.getLocale() || 'zh').toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('ja')) return 'ja';
    return 'en';
  } catch (_) { return 'zh'; }
}
function uiLang() {
  return loadConfig().lang || sysLangMain();
}

// 各创作方向的推荐分类种子（三语平行数组：同下标 = 同一个分类的不同语言名）
const PERSONA_SEED_CATS = {
  zh: {
    scene: ['建筑风格', '色彩氛围', '光影参考', '材质纹理', '构图视角', '自然环境', '道具与载具', '角色与生物'],
    character: ['头部与面部', '服饰参考', '剪影与体块', '动态姿势', '材质细节', '生物设计', '配件道具', '配色参考'],
    illustration: ['构图参考', '配色方案', '笔触质感', '光影参考', '人物姿态', '场景氛围', '装饰元素'],
    ui: ['界面布局', '图标参考', '配色系统', '组件样式', '字体排印', '动效参考'],
    generic: ['灵感收集', '配色参考', '构图参考', '风格研究'],
  },
  en: {
    scene: ['Architecture', 'Color & Mood', 'Lighting', 'Materials', 'Composition', 'Nature', 'Props & Vehicles', 'Characters'],
    character: ['Head & Face', 'Costume', 'Silhouette & Forms', 'Poses', 'Material Details', 'Creature Design', 'Props & Accessories', 'Color Reference'],
    illustration: ['Composition', 'Color Schemes', 'Brushwork', 'Lighting', 'Figure Poses', 'Scene Mood', 'Decorative Elements'],
    ui: ['Layouts', 'Icons', 'Color Systems', 'Components', 'Typography', 'Motion'],
    generic: ['Inspiration', 'Color Reference', 'Composition', 'Style Studies'],
  },
  ja: {
    scene: ['建築様式', '色彩と雰囲気', 'ライティング', 'マテリアル', '構図', '自然環境', '小道具・乗り物', 'キャラクター'],
    character: ['頭部と顔', '衣装', 'シルエットと量感', 'ポーズ', '質感ディテール', 'クリーチャー', '小物・装飾', '配色'],
    illustration: ['構図', '配色', '筆致・質感', 'ライティング', 'ポーズ', '情景の雰囲気', '装飾要素'],
    ui: ['レイアウト', 'アイコン', 'カラーシステム', 'コンポーネント', 'タイポグラフィ', 'モーション'],
    generic: ['インスピレーション', '配色', '構図', 'スタイル研究'],
  },
};

// 切换语言时：名字仍是种子原名的分类跟随语言改名——有没有图都改，
// 改的只是标签、图片不受影响；用户自己改过名的分类永远不匹配、永远不动
function renameSeedCats(targetLang) {
  const langs = ['zh', 'en', 'ja'];
  const cats = db.listCategories();
  for (const personaKey of Object.keys(PERSONA_SEED_CATS.zh)) {
    const len = PERSONA_SEED_CATS.zh[personaKey].length;
    for (let i = 0; i < len; i++) {
      const variants = langs.map((L) => PERSONA_SEED_CATS[L][personaKey][i]);
      const target = PERSONA_SEED_CATS[targetLang][personaKey][i];
      for (const c of cats) {
        if (variants.includes(c.name) && c.name !== target) {
          db.renameCategory(c.id, target);
        }
      }
    }
  }
}

// 内嵌网页的语言协商：Accept-Language 跟随应用语言（Pinterest/Gemini 等按它出对应语言页）
function applyAcceptLanguage(lang) {
  const accept = lang === 'ja' ? 'ja-JP,ja;q=0.9,en;q=0.7'
    : lang === 'en' ? 'en-US,en;q=0.9'
    : 'zh-CN,zh;q=0.9,en;q=0.7';
  for (const p of ['persist:browse', 'persist:aiweb']) {
    try {
      const s = session.fromPartition(p);
      s.setUserAgent(s.getUserAgent(), accept);
    } catch (_) {}
  }
}

// 以管理员身份重启（弹 UAC 授权），用于写入受保护目录
function relaunchElevated() {
  const { spawn } = require('child_process');
  const exe = process.execPath;
  const args = process.argv.slice(1).map((a) => `"${a}"`).join(' ');
  app.releaseSingleInstanceLock();
  const cmd = `Start-Process -FilePath "${exe}"${args ? ` -ArgumentList '${args.replace(/'/g, "''")}'` : ''} -Verb RunAs`;
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 200);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    backgroundColor: '#f3f9f4',
    title: '点灵 DotMuse',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  const devUrl = 'http://localhost:5175';
  const prodIndex = path.join(__dirname, '..', 'dist', 'index.html');

  const tryLoad = (attempt = 0) => {
    if (fs.existsSync(prodIndex) && !process.env.REFHUB_DEV) {
      mainWindow.loadFile(prodIndex);
      return;
    }
    mainWindow.loadURL(devUrl).catch(() => {
      if (attempt < 30) setTimeout(() => tryLoad(attempt + 1), 500);
    });
  };
  tryLoad();
}

// ---------- 图片下载与入库 ----------

function extFromUrlOrType(url, contentType) {
  const m = /\.(jpe?g|png|gif|webp|avif)(?:$|\?)/i.exec(url);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (contentType) {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('avif')) return 'avif';
  }
  return 'jpg';
}

async function downloadFirstOk(urls) {
  // 用浏览分区 session 下载：带用户登录 cookies 和 Chrome UA。
  // 注意不能加 Referer 头——Chromium 视其为禁止头，会直接 ERR_BLOCKED_BY_CLIENT
  const ses = session.fromPartition('persist:browse');
  for (const url of urls) {
    try {
      const res = await ses.fetch(url);
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // 必须是图片：拖拽/导入时经常混进网页 URL，HTML 一律拒收
        const looksImage = ct.startsWith('image/')
          || ((!ct || ct.includes('octet-stream')) && /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url));
        if (!looksImage) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        // 小于 2KB 的多半是占位图/错误页
        if (buf.length > 2048) {
          return { url, buf, contentType: ct };
        }
      }
    } catch (e) { console.error('[capture] 候选失败:', url, e.message); }
  }
  return null;
}

// 各网站的"原图升级"规则：把缩略图 URL 换成尽可能大的版本，按优先级排列候选
function upgradeCandidates(imgUrl, pageUrl) {
  const candidates = [];
  if (/i\.pinimg\.com/.test(imgUrl)) {
    candidates.push(imgUrl.replace(/\/\d+x\d*\//, '/originals/'));
    candidates.push(imgUrl.replace(/\/\d+x\d*\//, '/1200x/'));
    candidates.push(imgUrl.replace(/\/\d+x\d*\//, '/736x/'));
  } else if (/artstation\.com/.test(imgUrl)) {
    candidates.push(imgUrl.replace('/smaller_square/', '/large/').replace('/medium/', '/large/').replace('/small/', '/large/'));
  }
  candidates.push(imgUrl);
  return [...new Set(candidates)];
}

// 统一入库：网页采集 / 剪贴板粘贴 / 本地文件 / URL 导入 全走这里
function ingestImageBuffer(buf, { ext = 'png', sourceUrl = null, pageUrl = null, pageTitle = null, author = null, note = null, origin = 'other', silentDup = false, hidden = false } = {}) {
  ensureLibraryDirs();
  // 内容查重：同一张图（字节级指纹）只入库一次，返回已有素材
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  const dup = db.findAssetByHash(hash);
  if (dup) {
    console.log('[ingest] 查重命中，跳过重复入库:', dup.id);
    // 命中的是"未入库"隐藏图（.dlb 仅图板等）而这次是真入库：就地转正，
    // 否则会误报"已在素材库"但库里永远看不到它
    if (dup.hidden && !hidden) {
      db.setAssetHidden(dup.id, 0);
      const promoted = { ...dup, hidden: 0 };
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send('asset-added', { ...promoted, __origin: origin }); } catch (_) {}
      }
      return { ...promoted, __dup: true };
    }
    if (!silentDup && mainWindow) mainWindow.webContents.send('capture-failed', T('这张图已经在素材库里了，跳过重复入库'));
    return { ...dup, __dup: true };
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const d = new Date();
  const subdir = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  fs.mkdirSync(path.join(ORIGINALS_DIR, subdir), { recursive: true });
  const relPath = path.join(subdir, `${id}.${ext}`);
  const absPath = path.join(ORIGINALS_DIR, relPath);
  fs.writeFileSync(absPath, buf);

  // 缩略图（浏览走缩略图，机械盘上也流畅）
  let thumbRel = null;
  let width = null, height = null;
  try {
    const img = nativeImage.createFromPath(absPath);
    if (!img.isEmpty()) {
      const size = img.getSize();
      width = size.width; height = size.height;
      const thumb = img.resize({ width: Math.min(480, size.width) });
      fs.mkdirSync(path.join(THUMBS_DIR, subdir), { recursive: true });
      thumbRel = path.join(subdir, `${id}.jpg`);
      fs.writeFileSync(path.join(THUMBS_DIR, thumbRel), thumb.toJPEG(82));
    }
  } catch (_) { /* webp/avif 等格式 nativeImage 可能不支持，直接用原图当缩略图 */ }

  const asset = db.insertAsset({
    id,
    file_path: relPath,
    thumb_path: thumbRel,
    ext,
    bytes: buf.length,
    width, height,
    source_url: sourceUrl,
    page_url: pageUrl,
    page_title: pageTitle,
    author,
    note,
    hash,
    hidden: hidden ? 1 : 0,
  });

  // 广播给所有窗口（主窗 + 图板悬浮窗），悬浮窗才能实时刷新
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('asset-added', { ...asset, __origin: origin }); } catch (_) {}
  }
  return asset;
}

async function captureImage(payload) {
  const { imgUrl, pageUrl, pageTitle, author, alt } = payload;
  console.log('[capture] 收到采集请求:', imgUrl);

  const dl = await downloadFirstOk(upgradeCandidates(imgUrl, pageUrl));
  if (!dl) {
    console.error('[capture] 下载失败:', imgUrl);
    if (mainWindow) mainWindow.webContents.send('capture-failed', `下载失败：${imgUrl.slice(0, 80)}`);
    return { ok: false, error: '下载失败：' + imgUrl };
  }
  console.log('[capture] 下载成功:', dl.url, `${Math.round(dl.buf.length / 1024)}KB`);

  const asset = ingestImageBuffer(dl.buf, {
    ext: extFromUrlOrType(dl.url, dl.contentType),
    sourceUrl: dl.url,
    pageUrl, pageTitle, author, note: alt,
    origin: 'capture',
  });
  return { ok: true, asset };
}

// ---------- 剪贴板监听（设置里开关） ----------

const crypto = require('crypto');
let clipTimer = null;
let clipBaseline = '';

function clipHash() {
  const img = clipboard.readImage();
  if (img.isEmpty()) return '';
  const buf = img.toPNG();
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function startClipboardWatch() {
  stopClipboardWatch();
  clipBaseline = clipHash(); // 开启瞬间已有的内容不收
  clipTimer = setInterval(() => {
    try {
      const h = clipHash();
      if (!h || h === clipBaseline) return;
      clipBaseline = h;
      const img = clipboard.readImage();
      ingestImageBuffer(img.toPNG(), { ext: 'png', note: '剪贴板监听', origin: 'clipwatch' });
      console.log('[clipwatch] 收到剪贴板图片');
    } catch (_) {}
  }, 1500);
}

function stopClipboardWatch() {
  if (clipTimer) { clearInterval(clipTimer); clipTimer = null; }
}

// ---------- IPC ----------

app.whenReady().then(() => {
  ensureLibraryDirs();
  db.init(path.join(LIBRARY_ROOT, 'refhub.db'));

  // 启动清扫：失去全部图板引用的隐藏图（.dlb 仅图板 / 从画布逐张移出的图）
  // 连文件一起回收，避免不可见占盘
  try {
    for (const o of db.listHiddenOrphans()) {
      try { fs.unlinkSync(path.join(ORIGINALS_DIR, o.file_path)); } catch (_) {}
      if (o.thumb_path) { try { fs.unlinkSync(path.join(THUMBS_DIR, o.thumb_path)); } catch (_) {} }
      db.deleteAsset(o.id);
    }
  } catch (_) {}

  // 启动时把还叫种子原名的分类对齐到当前语言（补上「切语言前就有图」的漏网分类）
  try { renameSeedCats(uiLang()); } catch (_) {}
  // 内嵌网页语言协商跟随应用语言（未手动选择时=系统语言）
  applyAcceptLanguage(uiLang());

  // 伪装成标准 Chrome UA：否则 Google 会以"此浏览器不安全"拦截内嵌登录
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  // Google 登录页还会校验 Chromium Client-Hints 指纹（Sec-CH-UA 会暴露 Electron）。
  // 对 accounts.google.com 单独伪装成 Firefox（Firefox 没有 Client-Hints，Google 走宽松路径）
  const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
  for (const part of ['persist:browse', 'persist:aiweb']) {
    const ses = session.fromPartition(part);
    ses.setUserAgent(CHROME_UA);
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'] },
      (details, callback) => {
        details.requestHeaders['User-Agent'] = FIREFOX_UA;
        for (const h of Object.keys(details.requestHeaders)) {
          if (h.toLowerCase().startsWith('sec-ch-ua')) delete details.requestHeaders[h];
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );
  }

  // reflib://thumb/<相对路径> 和 reflib://orig/<相对路径> → G 盘素材库文件
  protocol.handle('reflib', (req) => {
    const u = new URL(req.url);
    const base = u.host === 'thumb' ? THUMBS_DIR : ORIGINALS_DIR;
    const rel = decodeURIComponent(u.pathname).replace(/^\//, '').replace(/\//g, path.sep);
    const abs = path.join(base, rel);
    if (!abs.startsWith(base)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });

  ipcMain.handle('capture-image', (_e, payload) => captureImage(payload));
  ipcMain.handle('list-assets', (_e, opts) => db.listAssets(opts || {}));
  ipcMain.handle('count-assets', (_e, opts) => db.countAssets(opts || {}));
  ipcMain.handle('get-asset', (_e, id) => db.getAsset(id));
  // 删除素材 = 数据行 + 原图 + 缩略图一起删（界面承诺的就是"彻底删除"）
  const unlinkAssetFiles = (a) => {
    if (!a) return;
    try { fs.unlinkSync(path.join(ORIGINALS_DIR, a.file_path)); } catch (_) {}
    if (a.thumb_path) { try { fs.unlinkSync(path.join(THUMBS_DIR, a.thumb_path)); } catch (_) {} }
  };
  ipcMain.handle('delete-asset', (_e, id) => {
    const a = db.getAsset(id);
    db.deleteAsset(id);
    unlinkAssetFiles(a);
    return true;
  });
  // 批量删除：数据库一个事务，随后统一清文件
  ipcMain.handle('delete-assets', (_e, ids) => {
    const rows = (ids || []).map((id) => db.getAsset(id)).filter(Boolean);
    db.deleteAssets(ids || []);
    for (const a of rows) unlinkAssetFiles(a);
    return true;
  });
  // 批量入板：一次 IPC + 一个事务
  ipcMain.handle('add-to-board-many', (_e, boardId, ids) => db.addAssetsToBoard(boardId, ids || []));
  ipcMain.handle('update-asset', (_e, id, fields) => db.updateAsset(id, fields));
  ipcMain.handle('list-boards', () => db.listBoards());
  ipcMain.handle('create-board', (_e, name) => db.getOrCreateBoardByName(name));
  ipcMain.handle('rename-board', (_e, id, name) => db.renameBoard(id, name));
  ipcMain.handle('delete-board', (_e, id) => {
    const r = db.deleteBoard(id);
    // "仅图板显示"的图失去最后引用：连文件一起清掉
    for (const o of r.orphans || []) {
      try { fs.unlinkSync(path.join(ORIGINALS_DIR, o.file_path)); } catch (_) {}
      if (o.thumb_path) { try { fs.unlinkSync(path.join(THUMBS_DIR, o.thumb_path)); } catch (_) {} }
      db.deleteAsset(o.id);
    }
    return true;
  });
  ipcMain.handle('asset-unhide', (_e, id) => db.setAssetHidden(id, 0));
  // 把素材原图写入系统剪贴板（发送到网页版 AI：粘贴即上传）
  ipcMain.handle('copy-image-clipboard', (_e, assetId) => {
    try {
      const a = db.getAsset(assetId);
      if (!a) return { ok: false, error: '素材不存在' };
      const img = nativeImage.createFromPath(path.join(ORIGINALS_DIR, a.file_path));
      if (img.isEmpty()) return { ok: false, error: '这张图的格式无法复制为图片' };
      clipboard.writeImage(img);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // 素材卡片的拖拽升级为操作系统级文件拖拽：网页端 AI / PS 等外部软件都能接收
  ipcMain.on('asset-start-drag', (event, assetId) => {
    try {
      const a = db.getAsset(assetId);
      if (!a) return;
      const abs = path.join(ORIGINALS_DIR, a.file_path);
      let icon = nativeImage.createFromPath(a.thumb_path ? path.join(THUMBS_DIR, a.thumb_path) : abs);
      if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
      if (!icon.isEmpty()) icon = icon.resize({ width: 96 });
      event.sender.startDrag({ file: abs, icon });
    } catch (_) {}
  });
  // 网页图片直发网页 AI（不入库）：带浏览分区登录态下载原图字节，交回渲染层解码
  ipcMain.handle('fetch-image-bytes', async (_e, url) => {
    try {
      const dl = await downloadFirstOk(upgradeCandidates(url, null));
      if (!dl) return { ok: false, error: '下载失败' };
      return { ok: true, buf: dl.buf, contentType: dl.contentType };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // 渲染层解码转成 PNG 后写系统剪贴板（webp/avif 由渲染层转格式，这里只收 PNG）
  ipcMain.handle('copy-image-buffer', (_e, buf) => {
    try {
      const img = nativeImage.createFromBuffer(Buffer.from(buf));
      if (img.isEmpty()) return { ok: false, error: '这张图的格式无法复制为图片' };
      clipboard.writeImage(img);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // 渲染层切换语言时同步给主进程：弹窗语言、空种子分类改名、内嵌网页 Accept-Language
  ipcMain.handle('set-lang', (_e, lang) => {
    const L = ['zh', 'en', 'ja'].includes(lang) ? lang : 'zh';
    saveConfig({ lang: L });
    try { renameSeedCats(L); } catch (_) {}
    applyAcceptLanguage(L);
    return true;
  });
  ipcMain.handle('board-assets', (_e, boardId) => db.listAssets({ boardId }));
  ipcMain.handle('add-to-board', (_e, boardId, assetId) => db.addAssetToBoard(boardId, assetId));
  ipcMain.handle('update-board-item', (_e, itemId, layout) => db.updateBoardItem(itemId, layout));
  ipcMain.handle('duplicate-board-item', (_e, itemId, dx, dy) => db.duplicateBoardItem(itemId, dx, dy));
  ipcMain.handle('restore-board-item', (_e, boardId, assetId, layout) => db.restoreBoardItem(boardId, assetId, layout));
  ipcMain.handle('list-categories', () => db.listCategories());
  ipcMain.handle('add-category', (_e, name) => db.addCategory(name));
  ipcMain.handle('add-asset-category', (_e, assetId, categoryId) => db.addAssetToCategory(assetId, categoryId));
  ipcMain.handle('remove-asset-category', (_e, assetId, categoryId) => db.removeAssetFromCategory(assetId, categoryId));
  ipcMain.handle('remove-assets-category', (_e, assetIds, categoryId) => db.removeAssetsFromCategory(assetIds || [], categoryId));
  ipcMain.handle('toggle-asset-pin', (_e, assetId, categoryId) => db.toggleAssetPin(assetId, categoryId));
  ipcMain.handle('delete-category', (_e, id) => db.deleteCategory(id));
  ipcMain.handle('create-idea', () => db.createIdea());
  ipcMain.handle('list-ideas', () => db.listIdeas());
  ipcMain.handle('get-idea', (_e, id) => db.getIdea(id));
  ipcMain.handle('update-idea', (_e, id, fields) => db.updateIdea(id, fields));
  ipcMain.handle('delete-idea', (_e, id) => db.deleteIdea(id));
  ipcMain.handle('board-widgets', (_e, boardId) => db.listWidgets(boardId));
  ipcMain.handle('add-board-widget', (_e, boardId, w) => db.addWidget(boardId, w));
  ipcMain.handle('update-board-widget', (_e, id, fields) => db.updateWidget(id, fields));
  ipcMain.handle('delete-board-widget', (_e, id) => db.deleteWidget(id));
  ipcMain.handle('remove-from-board', (_e, itemId) => db.removeBoardItem(itemId));
  ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
  // 画布导入三通路：剪贴板 / 本地文件 / 图片 URL
  ipcMain.handle('paste-image', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false, error: '剪贴板里没有图片' };
    return { ok: true, asset: ingestImageBuffer(img.toPNG(), { ext: 'png', note: '剪贴板粘贴', origin: 'paste' }) };
  });
  ipcMain.handle('import-file', (_e, filePath, opts) => {
    try {
      const buf = fs.readFileSync(filePath);
      const ext = (path.extname(filePath).slice(1) || 'png').toLowerCase();
      // opts.hidden：临时参考图，不出现在素材库（与 .dlb「仅图板」同机制）
      const hidden = !!(opts && opts.hidden);
      return { ok: true, asset: ingestImageBuffer(buf, { ext, pageTitle: path.basename(filePath), note: '本地导入', origin: 'file', hidden, silentDup: hidden }) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // 素材库「导入图片」：弹系统选择框（可多选），批量入库，走查重
  ipcMain.handle('import-images-dialog', async () => {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: T('选择要导入素材库的图片'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: T('图片'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'] }],
    });
    if (pick.canceled || !pick.filePaths.length) return { ok: false, canceled: true };
    let added = 0, dup = 0, failed = 0;
    for (const fp of pick.filePaths) {
      try {
        const buf = fs.readFileSync(fp);
        const ext = (path.extname(fp).slice(1) || 'png').toLowerCase();
        const r = ingestImageBuffer(buf, { ext, pageTitle: path.basename(fp), note: '本地导入', origin: 'file' });
        if (r && r.__dup) dup++; else added++;
      } catch (_) { failed++; }
      // 每张之间让出事件循环：批量导入不再冻住整个界面
      await new Promise((res) => setImmediate(res));
    }
    return { ok: true, added, dup, failed, total: pick.filePaths.length };
  });
  ipcMain.handle('import-url', async (_e, url, opts) => {
    const dl = await downloadFirstOk(upgradeCandidates(url, null));
    if (!dl) return { ok: false, error: '下载失败' };
    // opts.hidden：临时参考图，不出现在素材库（与 .dlb「仅图板」同机制）
    const hidden = !!(opts && opts.hidden);
    return { ok: true, asset: ingestImageBuffer(dl.buf, { ext: extFromUrlOrType(dl.url, dl.contentType), sourceUrl: dl.url, origin: 'url', hidden, silentDup: hidden }) };
  });
  // 图板悬浮小窗（置顶，可一边干活一边看参考）
  ipcMain.handle('open-board-float', (_e, boardId, name) => {
    const win = new BrowserWindow({
      width: 480, height: 580,
      alwaysOnTop: true,
      title: `${name || '图板'} · 点灵悬浮窗`,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      backgroundColor: '#f3f9f4',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenuBarVisibility(false);
    const prodIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(prodIndex) && !process.env.REFHUB_DEV) {
      win.loadFile(prodIndex, { query: { float: 'board', id: String(boardId) } });
    } else {
      win.loadURL(`http://localhost:5175/?float=board&id=${boardId}`).catch(() => {});
    }
    return true;
  });
  // ---------- 设置 / 首启 ----------
  ipcMain.handle('get-settings', () => ({ libraryRoot: LIBRARY_ROOT, clipboardWatch: !!loadConfig().clipboardWatch, firstRun }));
  // 首启：仅选目录返回预览路径（非空目录下自动建「点灵素材库」子目录），不落盘
  ipcMain.handle('pick-library-dir', async () => {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: T('选择素材库存放位置'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    let root = pick.filePaths[0];
    try {
      const isLib = fs.existsSync(path.join(root, 'refhub.db'));
      if (!isLib && fs.readdirSync(root).length > 0) root = path.join(root, '点灵素材库');
    } catch (_) {}
    return root;
  });
  // 首启：确认存储位置，正式建库并消除 firstRun
  ipcMain.handle('confirm-setup', (_e, root, personaKey) => {
    const target = root || LIBRARY_ROOT;
    const probeErr = checkWritable(target);
    if (probeErr) return { ok: false, error: probeErr.msg };
    if (root) { applyLibraryRoot(root); }
    ensureLibraryDirs();
    db.init(path.join(LIBRARY_ROOT, 'refhub.db'));
    saveConfig({ libraryRoot: LIBRARY_ROOT });
    // 首启选的创作方向：按当前语言替换默认种子分类（只动没挂图的空分类）
    if (personaKey && PERSONA_SEED_CATS.zh[personaKey]) {
      saveConfig({ personaKey });
      const L = uiLang();
      db.replaceSeedCategories((PERSONA_SEED_CATS[L] || PERSONA_SEED_CATS.zh)[personaKey]);
    }
    firstRun = false;
    console.log('[setup] 素材库位置确定:', LIBRARY_ROOT, '方向:', personaKey || '默认');
    return { ok: true, root: LIBRARY_ROOT };
  });
  // 清理损坏素材：按文件魔数校验，非图片（如误存的 HTML）连库带文件一起删
  ipcMain.handle('clean-broken-assets', () => {
    const rows = db.listAssets({ limit: 100000 });
    let removed = 0;
    for (const a of rows) {
      const abs = path.join(ORIGINALS_DIR, a.file_path);
      let bad = false;
      if (!fs.existsSync(abs)) {
        bad = true;
      } else {
        try {
          const fd = fs.openSync(abs, 'r');
          const buf = Buffer.alloc(16);
          fs.readSync(fd, buf, 0, 16, 0);
          fs.closeSync(fd);
          const sig = buf.toString('latin1');
          const isImg = (buf[0] === 0xFF && buf[1] === 0xD8) // jpg
            || sig.startsWith('\x89PNG') || sig.startsWith('GIF8')
            || sig.startsWith('RIFF') || sig.includes('ftyp') || sig.startsWith('BM');
          if (!isImg) bad = true;
        } catch (_) { bad = true; }
      }
      if (bad) {
        db.deleteAsset(a.id);
        try { fs.unlinkSync(abs); } catch (_) {}
        if (a.thumb_path) { try { fs.unlinkSync(path.join(THUMBS_DIR, a.thumb_path)); } catch (_) {} }
        removed++;
      }
    }
    console.log('[clean] 清理损坏素材:', removed);
    if (removed && mainWindow) mainWindow.webContents.send('library-changed', LIBRARY_ROOT);
    return { removed };
  });
  ipcMain.handle('set-clipboard-watch', (_e, enabled) => {
    saveConfig({ clipboardWatch: !!enabled });
    if (enabled) startClipboardWatch(); else stopClipboardWatch();
    return true;
  });
  ipcMain.handle('open-library-folder', () => shell.openPath(LIBRARY_ROOT));
  ipcMain.handle('change-library-root', async () => {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: T('选择新的素材库位置'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    let newRoot = pick.filePaths[0];
    const isExistingLib = fs.existsSync(path.join(newRoot, 'refhub.db'));
    // 选了非空的普通目录时，在其下建 RefLibrary 子目录，避免和已有文件混在一起
    if (!isExistingLib && fs.readdirSync(newRoot).length > 0) {
      newRoot = path.join(newRoot, 'RefLibrary');
    }
    if (path.resolve(newRoot) === path.resolve(LIBRARY_ROOT)) {
      return { ok: false, error: '选的就是当前位置，没变化' };
    }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [T('迁移现有素材过去'), isExistingLib ? T('直接使用该素材库') : T('在新位置从零开始'), T('取消')],
      defaultId: 0, cancelId: 2,
      title: T('更改存储位置'),
      message: `新位置：${newRoot}`,
      detail: T('「迁移」会把当前全部原图、缩略图和数据库复制到新位置（原位置保留，作为备份）。'),
    });
    if (choice.response === 2) return { ok: false, canceled: true };

    // 先探测新位置能不能写，不能写就直接返回、绝不动当前库（避免关库后才失败）
    const probe = checkWritable(newRoot);
    if (probe) {
      if (probe.perm) {
        // 权限问题：给「提权重启」出路，UAC 授权后即可写入
        const c = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: T('无法使用该位置'),
          message: T('这个位置需要更高权限才能写入'),
          detail: probe.msg + '\n\n点「以管理员身份重启」，Windows 授权后再到设置里重新更改一次位置即可。',
          buttons: [T('以管理员身份重启'), T('换个位置')], defaultId: 0, cancelId: 1,
        });
        if (c.response === 0) relaunchElevated();
      } else {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: T('无法使用该位置'),
          message: T('素材库位置没有更改'), detail: probe.msg, buttons: [T('知道了')],
        });
      }
      return { ok: false, error: probe.msg };
    }

    const oldRoot = LIBRARY_ROOT;
    db.close();
    try {
      if (choice.response === 0) {
        fs.mkdirSync(newRoot, { recursive: true });
        for (const sub of ['originals', 'thumbs']) {
          const src = path.join(oldRoot, sub);
          if (fs.existsSync(src)) fs.cpSync(src, path.join(newRoot, sub), { recursive: true });
        }
        for (const f of ['refhub.db', 'refhub.db-wal', 'refhub.db-shm']) {
          const src = path.join(oldRoot, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(newRoot, f));
        }
      }
      applyLibraryRoot(newRoot);
      ensureLibraryDirs();
      db.init(path.join(newRoot, 'refhub.db'));
      saveConfig({ libraryRoot: newRoot });
      if (mainWindow) mainWindow.webContents.send('library-changed', newRoot);
      console.log('[settings] 素材库已切换到:', newRoot);
      return { ok: true, root: newRoot, migrated: choice.response === 0 };
    } catch (e) {
      // 失败回滚到旧库
      applyLibraryRoot(oldRoot);
      db.init(path.join(oldRoot, 'refhub.db'));
      console.error('[settings] 切换失败已回滚:', e.message);
      return { ok: false, error: e.message };
    }
  });

  // ---------- 图板文件 .dlb：导出/导入（zip 容器：board.json + images/） ----------
  ipcMain.handle('board-export-dlb', async (_e, boardId, boardName) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${boardName || '图板'}.dlb`,
      filters: [{ name: T('点灵图板文件'), extensions: ['dlb'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const items = db.listAssets({ boardId, limit: 100000 });
      const widgets = db.listWidgets(boardId);
      const manifest = {
        format: 'dotli-board',
        version: 1,
        name: boardName || '导入图板',
        exportedAt: new Date().toISOString(),
        items: [],
        widgets: widgets.map((w) => ({
          kind: w.kind, content: w.content || '', x: w.x, y: w.y, w: w.w, h: w.h, z: w.z || 0, style: w.style || null,
        })),
      };
      let i = 0;
      for (const it of items) {
        const abs = path.join(ORIGINALS_DIR, it.file_path);
        if (!fs.existsSync(abs)) continue;
        const entryName = `${String(i).padStart(3, '0')}${path.extname(it.file_path) || '.png'}`;
        zip.addFile(`images/${entryName}`, fs.readFileSync(abs));
        manifest.items.push({
          image: entryName,
          layout: { x: it.x, y: it.y, w: it.w, z: it.z, locked: it.locked, flip: it.flip, rot: it.rot },
          meta: {
            ext: it.ext || (path.extname(it.file_path).slice(1) || 'png'),
            source_url: it.source_url, page_url: it.page_url, page_title: it.page_title,
            author: it.author, note: it.note, tags: it.tags || [],
          },
        });
        i++;
      }
      zip.addFile('board.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
      zip.writeZip(r.filePath);
      console.log('[dlb] 导出:', r.filePath, manifest.items.length, '张');
      return { ok: true, path: r.filePath, count: manifest.items.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('board-import-dlb', async () => {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: T('选择点灵图板文件'),
      properties: ['openFile'],
      filters: [{ name: T('点灵图板文件'), extensions: ['dlb'] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(pick.filePaths[0]);
      const mEntry = zip.getEntry('board.json');
      if (!mEntry) return { ok: false, error: '不是有效的点灵图板文件（缺少 board.json）' };
      const manifest = JSON.parse(zip.readAsText(mEntry, 'utf8'));
      if (manifest.format !== 'dotli-board') return { ok: false, error: '不是有效的点灵图板文件' };
      // 让用户选：图片收入素材库，还是只在图板里显示
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [T('同时收入素材库'), T('只放进图板'), T('取消')],
        defaultId: 0, cancelId: 2,
        title: T('导入图板'),
        message: T('「{name}」共 {n} 张图，怎么导入？', { name: manifest.name || T('导入图板'), n: (manifest.items || []).length }),
        detail: T('收入素材库：图片进素材库，可搜索、复用到别的图板。\n只放进图板：图片只在这个图板里显示，素材库保持干净；删除该图板时这些图会一并清理。'),
      });
      if (choice.response === 2) return { ok: false, canceled: true };
      const boardOnly = choice.response === 1;
      // 重名自动加后缀
      let name = manifest.name || '导入图板';
      const exists = (n) => db.listBoards().some((b) => b.name === n);
      if (exists(name)) {
        const base = `${name}（导入）`;
        name = base;
        let k = 2;
        while (exists(name)) name = `${base}${k++}`;
      }
      const board = db.getOrCreateBoardByName(name);
      let added = 0, linked = 0;
      for (const item of manifest.items || []) {
        const entry = zip.getEntry(`images/${item.image}`);
        if (!entry) continue;
        const buf = entry.getData();
        // 走统一入库管线：sha1 查重命中就复用已有素材，不重复占空间
        const asset = ingestImageBuffer(buf, {
          ext: String(item.meta?.ext || 'png').toLowerCase(),
          sourceUrl: item.meta?.source_url || null,
          pageUrl: item.meta?.page_url || null,
          pageTitle: item.meta?.page_title || null,
          author: item.meta?.author || null,
          note: item.meta?.note || null,
          origin: 'board-import',
          silentDup: true,
          hidden: boardOnly,
        });
        if (asset.__dup) linked++; else added++;
        // 选了收入素材库、但查重命中的是之前"仅图板"的隐藏图 → 顺势转正进库
        if (!boardOnly && asset.__dup && asset.hidden) db.setAssetHidden(asset.id, 0);
        if (!asset.__dup && Array.isArray(item.meta?.tags) && item.meta.tags.length) {
          db.updateAsset(asset.id, { tags: item.meta.tags });
        }
        db.restoreBoardItem(board.id, asset.id, item.layout || {});
        // 每张之间让出事件循环：大图板导入不冻住界面
        await new Promise((res) => setImmediate(res));
      }
      for (const w of manifest.widgets || []) {
        const nw = db.addWidget(board.id, { kind: w.kind, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z || 0 });
        if (w.content || w.style) db.updateWidget(nw.id, { content: w.content || '', style: w.style || null });
      }
      console.log('[dlb] 导入:', name, `新增 ${added} 复用 ${linked}`, boardOnly ? '(仅图板)' : '(入库)');
      return { ok: true, name, boardId: board.id, images: (manifest.items || []).length, added, linked, boardOnly };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('save-board-png', async (_e, dataUrl, name) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${name || '图板'}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('get-paths', () => ({
    libraryRoot: LIBRARY_ROOT,
    originalsDir: ORIGINALS_DIR,
    thumbsDir: THUMBS_DIR,
    webviewPreload: path.join(__dirname, 'webview-preload.cjs'),
  }));

  ipcMain.on('webview-preload-ready', (_e, host) => console.log('[capture] 采集脚本已注入:', host));
  // 采集脚本从内嵌页面 invoke 上来，返回真实结果供按钮反馈
  ipcMain.handle('webview-capture', (_e, payload) => captureImage(payload));
  ipcMain.on('webview-capture', (_e, payload) => { captureImage(payload); });

  if (loadConfig().clipboardWatch) startClipboardWatch();

  createWindow();
});

app.on('window-all-closed', () => app.quit());

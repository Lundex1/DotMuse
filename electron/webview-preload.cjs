// 注入到内嵌浏览器页面：鼠标悬停图片时浮现"收藏"按钮，点击采集入库
const { ipcRenderer } = require('electron');

const MIN_SIZE = 100; // 小于这个尺寸的图（图标、头像）不显示采集按钮

function pickBestUrl(img) {
  // srcset 里选最大的 w 候选；URL 一律解析成绝对地址，非 http(s)（data:/blob: 占位图）不收
  try {
    if (img.srcset) {
      let best = null, bestW = 0;
      const re = /(\S+)\s+(\d+)w/g; // \S+ 抓 URL：含逗号也不会切错（imgix 等）
      let m;
      while ((m = re.exec(img.srcset))) {
        const w = parseInt(m[2]);
        if (w >= bestW) { bestW = w; best = m[1]; }
      }
      if (best) {
        const abs = new URL(best, document.baseURI).href; // 相对/协议相对 → 绝对
        if (/^https?:/.test(abs)) return abs;
      }
    }
  } catch (_) {}
  const u = img.currentSrc || img.src || '';
  return /^https?:/.test(u) ? u : null;
}

// div 背景图渲染的图片（Pinterest 部分实验变体）：从 computed style 抠 URL
function bgImageUrl(el) {
  try {
    if (!el || el === document.body || el === document.documentElement) return null;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return null;
    // 引号配对捕获，URL 里带括号（如 a(1).jpg）也不截断
    const m = bg.match(/url\((['"]?)(.*?)\1\)/);
    if (!m || !m[2]) return null;
    if (!/^https?:/.test(m[2])) return null; // data:/blob: 占位图不收
    return m[2];
  } catch (_) { return null; }
}

function findAuthor() {
  // 通用兜底：站点特定的作者提取以后按适配器扩展
  const host = location.hostname;
  try {
    if (host.includes('artstation.com')) {
      const el = document.querySelector('.artist-name, [class*="project-author"] a, h3 a[href*="/artist"], .name a');
      if (el) return el.textContent.trim();
    }
    if (host.includes('pinterest.')) {
      const el = document.querySelector('[data-test-id="creator-profile-name"], [data-test-id="pinner-name"]');
      if (el) return el.textContent.trim();
    }
    const meta = document.querySelector('meta[name="author"], meta[property="og:author"]');
    if (meta) return meta.content;
  } catch (_) {}
  return null;
}

function ensureButton() {
  let btn = document.getElementById('__refhub_capture_btn');
  if (btn) return btn;
  btn = document.createElement('div');
  btn.id = '__refhub_capture_btn';
  btn.textContent = '✦ 收藏';
  Object.assign(btn.style, {
    position: 'fixed', zIndex: '2147483647', display: 'none',
    padding: '6px 14px', background: 'rgba(255,255,255,0.96)', color: '#1f9c8d',
    font: '600 13px/1.4 system-ui, sans-serif', borderRadius: '999px',
    border: '1px solid rgba(47,174,158,0.45)', cursor: 'pointer',
    userSelect: 'none', boxShadow: '0 3px 12px rgba(41,100,88,0.22)',
  });
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = btn.__target; // { el, url }
    if (!t || !t.el || btn.__busy) return;
    const imgUrl = t.url || pickBestUrl(t.el);
    if (!imgUrl) return;
    btn.__busy = true; // 防连点重复采集
    btn.textContent = '⋯ 入库中';
    btn.style.color = '#6d8a82';
    ipcRenderer.invoke('webview-capture', {
      imgUrl,
      pageUrl: location.href,
      pageTitle: document.title,
      author: findAuthor(),
      alt: t.el.alt || t.el.getAttribute?.('aria-label') || null,
    }).then((res) => {
      // 按真实结果反馈，失败不再假装成功
      if (res && res.ok) {
        btn.textContent = '✓ 已入库';
        btn.style.color = '#2fae9e';
      } else {
        btn.textContent = '✗ 失败';
        btn.style.color = '#e5766e';
      }
      setTimeout(() => { btn.textContent = '✦ 收藏'; btn.style.color = '#1f9c8d'; btn.__busy = false; }, 1600);
    }).catch(() => {
      btn.textContent = '✗ 失败';
      setTimeout(() => { btn.textContent = '✦ 收藏'; btn.style.color = '#1f9c8d'; btn.__busy = false; }, 1600);
    });
  }, true);
  document.documentElement.appendChild(btn);
  return btn;
}

const rectHasPoint = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const bigEnough = (r) => r.width >= MIN_SIZE && r.height >= MIN_SIZE;
// 整屏大小的背景（页面装饰）不算内容图
const notFullScreen = (r) => !(r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.98);

// 多层探测找鼠标下的"内容图"。站点渲染方式各异，逐层兜底：
// ① elementsFromPoint 穿透遮罩找 <img>（Pinterest 常规悬停遮罩）
// ② 同列表里找 <video poster> 和背景图 div（部分实验变体用 background-image 渲染）
// ③ img 带 pointer-events:none 时不参与命中检测——从悬停元素向上 4 层，
//    在容器里找覆盖鼠标点的大图
function findImageAt(x, y, hoverTarget) {
  try {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el instanceof HTMLImageElement) {
        const r = el.getBoundingClientRect();
        // 占位图（data:）拿不到可下载地址，跳过继续探下层
        if (bigEnough(r) && pickBestUrl(el)) return { el, url: null };
      }
    }
    for (const el of stack) {
      const r = el.getBoundingClientRect();
      if (!bigEnough(r) || !notFullScreen(r)) continue;
      if (el instanceof HTMLVideoElement && el.poster) return { el, url: el.poster };
      const bg = bgImageUrl(el);
      if (bg) return { el, url: bg };
    }
  } catch (_) {}
  try {
    let node = hoverTarget;
    for (let depth = 0; node && node.querySelectorAll && depth < 4; depth++, node = node.parentElement) {
      const imgs = node.querySelectorAll('img');
      if (imgs.length > 60) break; // 走到瀑布流大容器就放弃，避免全页扫描卡顿
      for (const im of imgs) {
        const r = im.getBoundingClientRect();
        if (bigEnough(r) && rectHasPoint(r, x, y)
          && getComputedStyle(im).visibility !== 'hidden' && pickBestUrl(im)) {
          return { el: im, url: null };
        }
      }
    }
  } catch (_) {}
  return null;
}

let lastCheck = 0;
function onMove(e) {
  const now = Date.now();
  if (now - lastCheck < 80) return;
  lastCheck = now;

  const btn = ensureButton();
  if (e.target === btn || btn.contains(e.target)) return; // 悬停在按钮自己上

  const target = findImageAt(e.clientX, e.clientY, e.target);
  if (target) {
    const r = target.el.getBoundingClientRect();
    btn.__target = target;
    btn.style.left = Math.max(4, r.left + 8) + 'px';
    btn.style.top = Math.max(4, r.top + 8) + 'px';
    btn.style.display = 'block';
  } else {
    btn.style.display = 'none';
  }
}

function hideBtn() {
  const btn = document.getElementById('__refhub_capture_btn');
  if (btn) btn.style.display = 'none';
}

function boot() {
  ipcRenderer.send('webview-preload-ready', location.hostname);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('scroll', hideBtn, true);
  // 只在鼠标离开整个页面时隐藏。注意不能用 capture 挂 document：
  // mouseleave 不冒泡，capture 会替每个元素触发，鼠标一碰到按钮它就被藏起来（闪烁+点不中）
  document.documentElement.addEventListener('mouseleave', hideBtn, false);
}

// 注入时机加固：DOMContentLoaded 已经过了也照常挂监听
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

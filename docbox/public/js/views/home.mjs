import { $, esc, iconSvg, fmtBytes } from '../core/dom.mjs';
import { store, clearRecent } from '../core/store.mjs';
import { CATS, MODULE_ART } from '../tools/catalog.mjs';

const HERO_COPY = {
  home: { eyebrow: 'LOCAL-FIRST · 本地优先', title: '文档与图片，<em>一站处理</em>', desc: '图片、PDF、文档、表格、OCR、音视频、网络安全 7 大模块，全部在本机完成，任务自动入库 MySQL。' },
  image: { eyebrow: 'IMAGE · 图片工具', title: '水印、证件照与<em>批量处理</em>', desc: '7 套现场工作水印、证件照 A4 排版、压缩 / 转换 / 尺寸调整，全部本地用 Sharp 完成。' },
  pdf: { eyebrow: 'PDF · 文档能力', title: '从合并到<em>加密与渲染</em>', desc: '合并拆分、页面组织、AES 加密、PDF ⇄ 图片、文字提取，21 项原生能力不依赖 Java。' },
  doc: { eyebrow: 'DOC · 文档转换', title: 'Word / Markdown <em>转 PDF</em>', desc: 'docx、md、html、csv 转 PDF，或把 Word / HTML 转成干净的 Markdown。' },
  sheet: { eyebrow: 'SHEET · 表格处理', title: 'Excel、CSV 与 <em>JSON</em>', desc: '多工作表拆分、格式互转、按行输出对象数组，方便接口联调。' },
  ocr: { eyebrow: 'OCR · 离线识别', title: '中文识别，<em>无需联网</em>', desc: 'tesseract.js + chi_sim 模型，图片批量识别与整本 PDF 识别，可复制或导出 TXT。' },
  media: { eyebrow: 'MEDIA · 音视频', title: '转码、剪辑与<em>提取音轨</em>', desc: '18 项 ffmpeg 能力在本机进程内调用，无需另装服务，最长 20 分钟自动保护。' },
  net: { eyebrow: 'SECURITY · 网络安全', title: '连通性、端口与<em>安全体检</em>', desc: '16 项本地探测：端口扫描、DNS、证书、响应头评级、目录与指纹，仅限自有或授权资产。' },
  history: { eyebrow: 'HISTORY · 处理历史', title: '每一次处理都<em>留档</em>', desc: '任务、耗时、结果写入本地 MySQL，可按模块筛选、一键清空。' },
  accounts: { eyebrow: 'ACCOUNTS · 账户管理', title: '角色与<em>模块授权</em>', desc: '管理员创建账户、分配角色、按模块授权；普通用户越权访问会被接口层拦截。' },
};

export function renderHome(app, filter) {
  const art = MODULE_ART[filter || 'home'] || MODULE_ART.home;
  const copy = HERO_COPY[filter || 'home'] || HERO_COPY.home;
  const heroArt = document.querySelector('.hero-art');
  if (heroArt) {
    heroArt.innerHTML = art.map((c, i) =>
      '<div class="float-card fc' + (i + 1) + '"><span class="fc-ico">' + esc(c.ico) + '</span><div><b>' + esc(c.title) + '</b><small>' + esc(c.sub) + '</small></div></div>'
    ).join('') + '<div class="hero-ring"></div>';
  }
  const hero = document.querySelector('.hero');
  if (hero) hero.dataset.module = filter || 'home';
  const eyebrow = document.querySelector('.hero-copy .eyebrow');
  if (eyebrow) eyebrow.textContent = copy.eyebrow;
  const h1 = document.querySelector('.hero-copy h1');
  if (h1) h1.innerHTML = copy.title;
  const p = document.querySelector('.hero-copy > p');
  if (p) p.innerHTML = copy.desc;
  const actions = document.querySelector('.hero-actions');
  const first = app.tools.find((t) => t.cat === (filter || 'pdf'));
  if (actions) {
    actions.innerHTML = filter && first
      ? '<a class="btn btn-primary" href="' + (first.route || '#/tool/' + first.id) + '">开始使用 ' + esc(first.name) + '</a>' +
        '<a class="btn btn-ghost" href="#/">全部工具</a>'
      : '<a class="btn btn-primary" href="#/watermark">制作工作水印</a><a class="btn btn-ghost" href="#/ocr">试试离线 OCR</a>';
  }

  const cats = Object.keys(CATS).filter((c) => !filter || c === filter);
  const sections = cats.map((cat) => {
    const items = app.tools.filter((t) => t.cat === cat);
    if (!items.length) return '';
    return `<section class="tool-group" data-cat="${cat}">
      <h3>${esc(CATS[cat].name)} <span>${esc(CATS[cat].desc)}</span></h3>
      <div class="tool-grid">${items.map(card).join('')}</div>
    </section>`;
  }).join('');
  $('#toolSections').innerHTML = sections || '<div class="recent-empty">这个分类还没有工具。</div>';

  $('#statTools').textContent = String(app.tools.length);
  $('#statNative').textContent = String(app.tools.filter((t) => !t.suite).length);
  const dbEl = $('#statDb');
  if (dbEl) dbEl.textContent = app.db?.available ? 'MySQL' : '未连接';
  $('#toolCount').textContent = filter ? app.tools.filter((t) => t.cat === filter).length + ' 个工具' : app.tools.length + ' 个可用工具';

  const head = document.querySelector('#view-home .section-head');
  const old = document.getElementById('showAllTools');
  if (filter && head && !old) {
    const btn = document.createElement('a');
    btn.id = 'showAllTools';
    btn.className = 'btn btn-ghost btn-sm';
    btn.href = '#/';
    btn.textContent = '显示全部工具';
    head.append(btn);
  } else if (!filter) {
    old?.remove();
  }
  renderRecent();
}

function card(t) {
  const href = t.route || '#/tool/' + t.id;
  return `<a class="tool-card cat-${t.cat}" href="${href}" data-tool="${t.id}">
    ${t.badge ? '<span class="t-badge">' + esc(t.badge) + '</span>' : ''}
    <span class="t-ico cat-${t.cat}">${iconSvg(t.icon)}</span>
    <div class="t-body"><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></div>
    <span class="t-arrow">→</span>
  </a>`;
}

export function renderRecent() {
  const list = $('#recentList');
  if (!list) return;
  if (!store.recent.length) {
    list.innerHTML = '<div class="recent-empty">还没有处理记录。选择一个工具开始，结果会自动出现在这里。</div>';
    return;
  }
  list.innerHTML = store.recent.map((r) => `
    <div class="recent-item">
      <span class="r-ico">${esc((r.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>
      <span class="r-body"><b title="${esc(r.name)}">${esc(r.name)}</b><span>${esc(r.tool)} · ${fmtBytes(r.size)}</span></span>
      <a href="${esc(r.url)}" download="${esc(r.name)}">下载</a>
    </div>`).join('');
}

export function wireClearRecent() {
  const btn = $('#recentClear');
  if (!btn) return;
  btn.onclick = () => { clearRecent(); renderRecent(); };
}

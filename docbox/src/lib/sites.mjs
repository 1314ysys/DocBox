/**
 * 站点内置解析（不依赖 yt-dlp 也能跑）
 * 目前支持：哔哩哔哩（bvid / av / b23.tv 短链）——DASH 或 durl 直链
 */
import { UA } from './hls.mjs';

const BILI_HEADERS = {
  'user-agent': UA,
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com',
};
// 想解锁 1080P/大会员画质：把浏览器登录后的 Cookie 整段贴进环境变量 DOCBOX_BILI_COOKIE
if (process.env.DOCBOX_BILI_COOKIE) BILI_HEADERS.cookie = process.env.DOCBOX_BILI_COOKIE;

const QN_NAME = {
  127: '8K', 126: 'Dolby', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P',
  74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P',
};
const qn = (code) => QN_NAME[code] || (code ? 'Q' + code : 'MP4');

async function json(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url.slice(0, 80));
  return res.json();
}

export function matchSite(url) {
  if (/bilibili\.com|b23\.tv/i.test(url)) return 'bilibili';
  return '';
}

async function expandShort(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    const loc = res.headers.get('location');
    if (loc) return loc.startsWith('http') ? loc : new URL(loc, url).toString();
  } catch { /* ignore */ }
  return url;
}

function parseIds(url) {
  const out = {};
  const m = url.match(/BV[0-9A-Za-z]{10}/);
  if (m) out.bvid = m[0];
  const av = url.match(/\/av(\d+)/i);
  if (av) out.aid = av[1];
  const p = url.match(/[?&]p=(\d+)/);
  out.page = p ? Number(p[1]) : 1;
  return out;
}

/** 哔哩哔哩：返回统一 formats */
export async function resolveBilibili(url) {
  const real = /b23\.tv/i.test(url) ? await expandShort(url) : url;
  const ids = parseIds(real);
  if (!ids.bvid && !ids.aid) throw new Error('无法从链接里识别 BV / av 号');
  const q = ids.bvid ? 'bvid=' + ids.bvid : 'aid=' + ids.aid;
  const view = await json('https://api.bilibili.com/x/web-interface/view?' + q, BILI_HEADERS);
  if (view.code !== 0) throw new Error('B 站接口返回：' + (view.message || view.code));
  const v = view.data;
  const page = (v.pages || [])[Math.min(ids.page - 1, Math.max(0, (v.pages || []).length - 1))] || { cid: v.cid };
  const cid = page.cid || v.cid;

  const idq = ids.bvid ? 'bvid=' + ids.bvid : 'aid=' + ids.aid;
  let play = await json('https://api.bilibili.com/x/player/playurl?' + idq + '&cid=' + cid + '&qn=116&fnval=4048&fourk=1&high_quality=1', BILI_HEADERS);
  const hasDash = (p) => Array.isArray(p?.data?.dash?.video) && p.data.dash.video.length > 0;
  if (play.code !== 0 || !hasDash(play)) {
    // 退回 html5（免登录常见能拿到 720P 的 mp4 直链）
    const alt = await json('https://api.bilibili.com/x/player/playurl?' + idq + '&cid=' + cid + '&qn=116&fnval=4048&fourk=1&platform=html5&high_quality=1', BILI_HEADERS);
    if (alt.code === 0 && (hasDash(alt) || Array.isArray(alt.data?.durl))) play = alt;
  }
  if (play.code !== 0) throw new Error('B 站播放接口返回：' + (play.message || play.code) + '（可能需要登录/大会员）');
  const d = play.data || {};
  const formats = [];

  if (Array.isArray(d.dash?.video) && d.dash.video.length) {
    const audios = d.dash.audio || [];
    const bestAudio = audios.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0] || null;
    for (const vs of d.dash.video.sort((a, b) => (b.height || 0) - (a.height || 0))) {
      formats.push({
        id: 'dash-' + vs.id + '-' + (vs.codecid || 7),
        ext: 'mp4',
        height: vs.height || null,
        fps: vs.frameRate || null,
        note: (vs.height ? vs.height + 'P' : 'DASH') + ' · ' + Math.round((vs.bandwidth || 0) / 1000) + 'kbps' + (bestAudio ? ' · 含音轨' : ' · 无音轨'),
        type: 'dash',
        url: vs.baseUrl || vs.base_url,
        audioUrl: bestAudio ? (bestAudio.baseUrl || bestAudio.base_url) : '',
        headers: BILI_HEADERS,
        hasVideo: true,
        hasAudio: Boolean(bestAudio),
      });
    }
  } else if (Array.isArray(d.durl) && d.durl.length) {
    d.durl.forEach((seg, i) => {
      formats.push({
        id: 'durl-' + i,
        ext: 'mp4',
        height: null,
        note: qn(d.quality) + (d.durl.length > 1 ? ' · 分段 ' + (i + 1) + '/' + d.durl.length : ' · MP4 整段'),
        type: 'file',
        url: seg.url,
        headers: BILI_HEADERS,
        hasVideo: true,
        hasAudio: true,
      });
    });
  }

  return {
    kind: 'site',
    engine: 'bilibili-api',
    title: v.title || '',
    thumbnail: v.pic || '',
    duration: v.duration || null,
    uploader: (v.owner && v.owner.name) || '',
    site: '哔哩哔哩',
    manifest: '',
    formats,
    streams: formats.map((f) => ({ type: f.type, url: f.url, label: f.note })),
    headers: BILI_HEADERS,
    note: formats.length ? 'B 站接口解析成功（' + formats.length + ' 个清晰度）' : 'B 站接口没有返回可播放流（可能需要登录）',
  };
}

export async function resolveBySite(url) {
  const site = matchSite(url);
  if (site === 'bilibili') return resolveBilibili(url);
  return null;
}

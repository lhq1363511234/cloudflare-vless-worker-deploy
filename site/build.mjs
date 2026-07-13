// 零依赖：把 README.md 渲染成静态教程网站 docs/index.html
// 用法：node site/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const md = readFileSync(join(root, 'vpn.md'), 'utf8');
let lines = md.split(/\r?\n/);

// 预处理：清理linux.do专属语法，生成本站可用的干净内容
const IMG_CAPS = [
  '方案三 概览截图',
  'dnshe 免费域名获取截图',
  'Node.js 与脚本就绪截图',
  'Cloudflare Account ID 位置截图',
  'vses2 Cookie 位置截图',
  '部署报错示例截图',
];
let imgN = 0;
lines = lines.map((line) => {
  // 去掉 ![:emoji:](cdn...) 这类外链大表情（linux.do 专属，普通网页不渲染）
  let l = line.replace(/!\[:[a-z_]+:\]\(https?:\/\/[^)]+\)/g, '');
  // 本机 <img> 本地路径 -> 占位框（避免裂图）
  if (l.includes('<img')) {
    imgN += 1;
    const cap = IMG_CAPS[imgN - 1] || '截图' + imgN;
    return '📷 **[图' + imgN + ' · ' + cap + ']**';
  }
  return l;
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const slug = (s) =>
  'h-' + stripTags(s).replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

const out = [];
const nav = [];
let titleText = '免费高速访问方案教程';
let para = [];
let list = null;
let code = null;
let quote = [];

const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
const flushList = () => { if (list) { out.push('<' + list.type + '>' + list.items.join('') + '</' + list.type + '>'); list = null; } };
const flushCode = () => {
  if (code) {
    const lang = code.lang === 'lua' ? 'bash' : code.lang;
    out.push('<pre><code class="lang-' + (lang || '') + '">' + esc(code.lines.join('\n')) + '</code></pre>');
    code = null;
  }
};
const renderFig = (q) => {
  const m = q.match(/📷\s*\*\*\[(图\d+)\s*·\s*([^\]]+)\]\*\*\s*(.*)/);
  if (m) {
    const cap = esc(m[2]) + (m[3] ? ' — ' + esc(m[3].replace(/^[\s　]+/, '')) : '');
    return '<figure class="img-ph"><div class="img-ph-box">📷 ' + m[1] + '</div><figcaption>' + cap + '</figcaption></figure>';
  }
  return '<p>' + inline(q) + '</p>';
};
const flushQuote = () => {
  if (quote.length) {
    const raw = quote.join('\n');
    if (raw.includes('📷')) {
      out.push(quote.map(renderFig).join(''));
    } else {
      out.push('<blockquote>' + inline(raw) + '</blockquote>');
    }
    quote = [];
  }
};

for (const raw of lines) {
  if (raw.trim().startsWith('```')) {
    if (code) flushCode();
    else { flushPara(); flushList(); flushQuote(); code = { lang: raw.trim().slice(3).trim(), lines: [] }; }
    continue;
  }
  if (code) { code.lines.push(raw); continue; }
  if (raw.trim() === '') { flushPara(); flushList(); flushQuote(); continue; }

  if (raw.includes('📷') && raw.includes('[图')) {
    flushPara(); flushList(); flushQuote();
    out.push(renderFig(raw.replace(/^>\s?/, '')));
    continue;
  }
  if (raw.startsWith('>')) { quote.push(raw.replace(/^>\s?/, '')); continue; }

  const h = raw.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    flushPara(); flushList(); flushQuote();
    const lvl = h[1].length;
    const txt = inline(h[2]);
    const id = slug(h[2]);
    if (lvl === 1) titleText = stripTags(h[2]).replace(/\*\*/g, '');
    if (lvl <= 3) nav.push({ level: lvl, id, text: stripTags(h[2]) });
    out.push('<h' + lvl + ' id="' + id + '">' + txt + '</h' + lvl + '>');
    continue;
  }
  if (/^\s*-\s+/.test(raw)) {
    flushPara(); flushQuote();
    if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
    list.items.push('<li>' + inline(raw.replace(/^\s*-\s+/, '')) + '</li>');
    continue;
  }
  if (/^\d+\.\s+/.test(raw)) {
    flushPara(); flushQuote();
    if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
    list.items.push('<li>' + inline(raw.replace(/^\d+\.\s+/, '')) + '</li>');
    continue;
  }
  flushList(); flushQuote();
  para.push(raw);
}
flushPara(); flushList(); flushQuote(); flushCode();

const navHtml = nav
  .map((n) => '<a class="nav-' + n.level + '" href="#' + n.id + '">' + n.text + '</a>')
  .join('\n      ');

const CSS = `
:root{
  --bg:#f7f8fa; --card:#ffffff; --text:#1f2328; --muted:#57606a;
  --accent:#1f6feb; --accent2:#8957e5; --border:#e3e6ea; --code:#0d1117;
  --quote:#eef4ff; --ph:#eef1f5;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0d1117; --card:#161b22; --text:#e6edf3; --muted:#9da7b3;
    --accent:#58a6ff; --accent2:#bc8cff; --border:#30363d; --code:#010409;
    --quote:#15233b; --ph:#1b212b;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  line-height:1.75;font-size:16px}
header.hero{background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;padding:48px 20px 36px;text-align:center}
header.hero h1{margin:0 0 10px;font-size:clamp(22px,4vw,34px);line-height:1.3}
header.hero p{margin:0;opacity:.92;font-size:15px}
nav.toc{max-width:900px;margin:18px auto;padding:0 16px}
nav.toc a{display:block;padding:8px 12px;margin:4px 0;border-radius:8px;
  background:var(--card);border:1px solid var(--border);color:var(--text);text-decoration:none;font-size:15px;transition:.15s}
nav.toc a:hover{border-color:var(--accent);transform:translateX(3px)}
nav.toc a.nav-3{margin-left:18px;font-size:14px;color:var(--muted)}
main{max-width:900px;margin:0 auto;padding:8px 16px 60px}
h2,h3,h4{line-height:1.4;margin:34px 0 12px;scroll-margin-top:16px}
h2{border-left:5px solid var(--accent);padding-left:12px;font-size:23px}
h3{font-size:19px;color:var(--accent)}
h4{font-size:16px;color:var(--muted)}
p{margin:12px 0}
a{color:var(--accent)}
code{background:rgba(127,127,127,.16);padding:2px 6px;border-radius:5px;font-size:90%;
  font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
pre{background:var(--code);color:#e6edf3;padding:16px;border-radius:10px;overflow:auto;
  border:1px solid var(--border);font-size:14px;line-height:1.6}
pre code{background:none;padding:0;color:inherit;font-size:14px}
ul,ol{padding-left:24px;margin:12px 0}
li{margin:6px 0}
blockquote{background:var(--quote);border-left:4px solid var(--accent);
  margin:14px 0;padding:12px 16px;border-radius:0 8px 8px 0;color:var(--text)}
figure.img-ph{margin:18px 0;border:2px dashed var(--border);border-radius:12px;overflow:hidden;background:var(--ph)}
.img-ph-box{height:140px;display:flex;align-items:center;justify-content:center;
  font-size:20px;color:var(--muted);background:repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(127,127,127,.06) 12px,rgba(127,127,127,.06) 24px)}
.img-ph figcaption{padding:10px 14px;font-size:13px;color:var(--muted);text-align:center;border-top:1px solid var(--border)}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin:18px 0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
footer{max-width:900px;margin:0 auto;padding:24px 16px 50px;color:var(--muted);font-size:13px;text-align:center;border-top:1px solid var(--border)}
`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleText}</title>
<style>${CSS}</style>
</head>
<body>
<header class="hero">
  <h1>${titleText}</h1>
  <p>完全免费 · 从 VPS 到 Cloudflare 全自动脚本一键部署</p>
</header>
<nav class="toc">
  ${navHtml}
</nav>
<main>
${out.join('\n')}
</main>
<footer>
  本教程由社区整理，所有免费资源随时可能被厂商回收或调整策略，请自行评估风险。<br>
  部署脚本与本站源码见 GitHub 仓库。
</footer>
</body>
</html>
`;

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'index.html'), html, 'utf8');
console.log('generated docs/index.html  (' + html.length + ' bytes, ' + nav.length + ' nav items)');

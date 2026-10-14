// VERIFY.md의 [자동] 항목(A~F, G19)을 Playwright로 실행하고 결과를 VERIFY.md에 기록한다.
// 실행: node verify.mjs   (BASE_URL을 주면 그 주소를 검사, 없으면 로컬 서버를 직접 띄움)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let server;
let BASE = process.env.BASE_URL;
if (!BASE) {
  server = await startServer(5173);
  BASE = 'http://localhost:5173';
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const results = new Map(); // id -> { ok, note }
async function check(id, fn) {
  try {
    const note = await fn();
    results.set(id, { ok: true, note: typeof note === 'string' ? note : '' });
  } catch (e) {
    results.set(id, { ok: false, note: String(e.message || e).split('\n')[0].slice(0, 200) });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// 기본 검사(A~F)는 Firebase 설정이 없는 모드(자리 표시)로 실행한다. 로그인 필요 화면(글 쓰기·설정)을 로그인 없이 확인하기 위해
// script.js를 요청 단계에서만 치환하며 파일은 바뀌지 않는다. 로그인 검사(I)는 실제 설정으로 별도 실행한다.
await ctx.route('**/script.js*', async (route) => {
  const res = await route.fetch();
  const body = (await res.text()).replace(/apiKey:\s*"AIza[^"]*"/, 'apiKey: "YOUR_API_KEY"');
  await route.fulfill({ response: res, body });
});
const page = await ctx.newPage();

const consoleErrors = [];
const dialogs = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

const go = async (hash = '') => {
  await page.goto(`${BASE}/${hash}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(150);
};
const visiblePages = () => page.$$eval('section.page', (els) => els.filter((e) => !e.hidden).map((e) => e.id));
const ROUTES = { home: '#/', ai: '#/ai', posts: '#/posts', write: '#/write', settings: '#/settings' };
const TITLES = {
  '#/': 'AI 업무 학습 일지', '#/ai': 'AI 정보 · AI 업무 학습 일지', '#/posts': '글 목록 · AI 업무 학습 일지',
  '#/write': '글 쓰기 · AI 업무 학습 일지', '#/settings': '설정 · AI 업무 학습 일지',
  '#/abc': '페이지를 찾을 수 없습니다 · AI 업무 학습 일지',
};
const setEditor = (value) => page.evaluate((v) => document.querySelector('.CodeMirror').CodeMirror.setValue(v), value);
const errText = (sel) => page.$eval(sel, (e) => e.textContent.trim());

// ---------- A. 라우팅·메뉴 ----------
await check('A1', async () => {
  await go();
  assert((await visiblePages()).join() === 'page-home', '첫 화면이 소개가 아님: ' + (await visiblePages()));
  assert((await page.title()) === TITLES['#/'], '탭 제목: ' + (await page.title()));
});
await check('A2', async () => {
  const t = await page.$$eval('#main-nav .nav-link', (a) => a.filter((x) => !x.hidden).map((x) => x.textContent.trim()));
  assert(t.join('|') === '소개|AI 정보|글 목록|글 쓰기|설정', '메뉴: ' + t.join('|'));
});
await check('A3', async () => {
  await go();
  for (const [key, hash] of Object.entries(ROUTES)) {
    await page.click(`#main-nav a[data-route="${key}"]`);
    await page.waitForTimeout(120);
    const v = (await visiblePages()).join();
    assert(page.url().endsWith(hash === '#/' ? '#/' : hash) && v === `page-${key === 'write' ? 'form' : key}`, `${key}: url=${page.url()} visible=${v}`);
  }
});
await check('A4', async () => {
  for (const [key, hash] of Object.entries(ROUTES)) {
    await go(hash);
    const active = await page.$$eval('#main-nav a.nav-link', (a) => a.filter((x) => x.classList.contains('is-active') && x.getAttribute('aria-current') === 'page').map((x) => x.dataset.route));
    assert(active.join() === key, `${hash}: active=${active.join()}`);
  }
});
await check('A5', async () => {
  await go('#/ai');
  await page.click('#main-nav a[data-route="posts"]');
  await page.waitForTimeout(100);
  await page.goBack();
  await page.waitForTimeout(150);
  assert((await visiblePages()).join() === 'page-ai', '뒤로 가기 실패: ' + (await visiblePages()));
});
await check('A6', async () => {
  await go('#/ai');
  await page.reload();
  await page.waitForTimeout(150);
  assert((await visiblePages()).join() === 'page-ai', '새로고침 후: ' + (await visiblePages()));
});
await check('A7', async () => {
  await go('#/abc');
  assert((await visiblePages()).join() === 'page-notfound', '5가 아님');
  assert((await page.innerText('#page-notfound')).includes('페이지를 찾을 수 없습니다.'), '문구 없음');
});
await check('A8', async () => {
  for (const h of ['#/post/../x', '#/edit/<img>', '#/post/짧음']) {
    await go(h);
    assert((await visiblePages()).join() === 'page-notfound', `${h} → ${await visiblePages()}`);
    const body = await page.innerText('body');
    assert(!body.includes('<img') && !body.includes('../x') && !body.includes('짧음'), `${h} 입력값이 화면에 출력됨`);
  }
});
await check('A9', async () => {
  for (const [h, t] of Object.entries(TITLES)) {
    await go(h);
    assert((await page.title()) === t, `${h}: "${await page.title()}"`);
  }
});

// ---------- B. 고정 콘텐츠 ----------
const headingsOf = (sel) => page.$$eval(`${sel} h1, ${sel} h2, ${sel} h3`, (h) => h.map((x) => x.textContent.trim()));
await check('B1', async () => {
  await go('#/');
  const h = (await headingsOf('#page-home')).join(' / ');
  for (const w of ['나는 누구', '주로 다루는 기술', '왜 AI를 기록', '이 블로그에서 볼 수 있는 것', '최근 글', '연락']) assert(h.includes(w), `소개에 "${w}" 영역 없음: ${h}`);
});
await check('B2', async () => {
  await go('#/ai');
  const h = (await headingsOf('#page-ai')).join(' / ');
  for (const w of ['AI 정보', '내가 쓰는 AI 도구', '다루는 주제', '글을 쓰는 원칙', '참고 자료']) assert(h.includes(w), `AI 정보에 "${w}" 없음: ${h}`);
  const topics = await page.$$eval('#page-ai .topic-card', (e) => e.length);
  assert(topics === 4, `주제 카드 ${topics}개`);
});
await check('B3', async () => {
  for (const h of ['#/', '#/ai', '#/posts', '#/write', '#/settings']) {
    await go(h);
    assert((await page.$eval('footer', (f) => f.textContent.trim().length)) > 5, `${h} 푸터 없음`);
  }
});
await check('B4', async () => {
  assert((await page.getAttribute('html', 'lang')) === 'ko', 'lang=' + (await page.getAttribute('html', 'lang')));
});
await check('B5', async () => {
  await go('#/');
  const bad = await page.$$eval('a[target="_blank"]', (a) => a.filter((x) => !/noopener/.test(x.rel) || !/noreferrer/.test(x.rel)).map((x) => x.href));
  assert(bad.length === 0, 'rel 누락: ' + bad.join(','));
  const http = await page.$$eval('a[href^="http:"]', (a) => a.map((x) => x.href));
  assert(http.length === 0, 'http 링크: ' + http.join(','));
});
await check('B6', async () => {
  const allow = /^(AI|GitHub|Firebase|API|URL|SNS|Markdown|Easymde|GPT|SUIT|ChatGPT|Claude)$/i;
  const found = new Set();
  for (const h of ['#/', '#/ai', '#/posts', '#/write', '#/settings', '#/abc']) {
    await go(h);
    const texts = await page.$$eval('h1,h2,h3,button,label,#main-nav a,.btn,.btn-link,footer', (e) => e.filter((x) => x.offsetParent !== null).map((x) => x.innerText));
    for (const t of texts) for (const w of t.match(/[A-Za-z]{3,}/g) || []) if (!allow.test(w)) found.add(w);
  }
  assert(found.size === 0, '영어 단어: ' + [...found].join(','));
});
await check('B7', async () => {
  await go('#/ai');
  const hrefs = await page.$$eval('#page-ai .topic-card a', (a) => a.map((x) => x.getAttribute('href')));
  assert(hrefs.length === 4 && hrefs.every((h) => h === '#/posts'), 'hrefs: ' + hrefs.join(','));
  await page.click('#page-ai .topic-card a >> nth=0');
  await page.waitForTimeout(120);
  assert((await visiblePages()).join() === 'page-posts', '이동 실패');
});
await check('B8', async () => {
  const before = consoleErrors.length;
  await go('#/');
  const t = (await page.innerText('#page-home')).trim();
  assert(/최근 글/.test(t), '최근 글 영역 없음');
  assert(consoleErrors.length === before, '콘솔 오류: ' + consoleErrors.slice(before).join(' | '));
});

// ---------- C. 글 쓰기 폼 ----------
const openWrite = async () => {
  // 같은 주소로 goto하면 페이지가 새로 로드되지 않아 이전 테스트의 편집기 상태가 남으므로 빈 페이지를 거친다
  await page.goto('about:blank');
  await go('#/write');
  await page.waitForSelector('.CodeMirror', { timeout: 15000 });
};
await check('C1', async () => {
  await openWrite();
  for (const s of ['#field-title', '#field-date', '#field-category', '.CodeMirror', '#form-submit', '#form-cancel']) assert(await page.$(s), s + ' 없음');
  assert((await page.innerText('#form-submit')).trim() === '저장', '저장 버튼 문구');
  assert((await page.innerText('#form-cancel')).trim() === '취소', '취소 버튼 문구');
});
await check('C2', async () => {
  const today = await page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  assert((await page.inputValue('#field-date')) === today, '날짜 기본값: ' + (await page.inputValue('#field-date')));
});
await check('C3', async () => {
  await openWrite();
  await setEditor('본문');
  await page.click('#form-submit');
  assert((await errText('#err-title')) === '제목을 입력해 주세요.', '문구: ' + (await errText('#err-title')));
});
await check('C4', async () => {
  await openWrite();
  await page.fill('#field-title', 'a'.repeat(101));
  await setEditor('본문');
  await page.click('#form-submit');
  assert((await errText('#err-title')) === '제목은 100자 이내로 입력해 주세요.', '문구: ' + (await errText('#err-title')));
});
await check('C5', async () => {
  await openWrite();
  await page.fill('#field-title', '제목');
  await page.click('#form-submit');
  await page.waitForTimeout(250);
  assert((await errText('#err-content')) === '본문을 입력해 주세요.', '문구: ' + (await errText('#err-content')));
});
await check('C6', async () => {
  await openWrite();
  await page.fill('#field-title', '제목');
  await setEditor('가'.repeat(5001));
  await page.click('#form-submit');
  assert((await errText('#err-content')) === '본문은 5,000자 이내로 입력해 주세요.', '문구: ' + (await errText('#err-content')));
});
await check('C7', async () => {
  await openWrite();
  await page.fill('#field-title', '제목');
  await page.fill('#field-date', '');
  await setEditor('본문');
  await page.click('#form-submit');
  assert((await errText('#err-date')) === '날짜를 선택해 주세요.', '문구: ' + (await errText('#err-date')));
});
await check('C8', async () => {
  await openWrite();
  const titles = await page.$$eval('.editor-toolbar button', (b) => b.map((x) => (x.title || '') + '|' + x.className));
  for (const k of ['bold', 'italic', 'heading', 'unordered-list', 'ordered-list', 'quote', 'code', 'link', 'table', 'preview']) assert(titles.some((t) => t.includes(k)), `툴바 ${k} 없음`);
  await setEditor('## 제목\n\n**굵게**');
  await page.click('.editor-toolbar button.preview');
  await page.waitForSelector('.editor-preview-active h2', { timeout: 5000 });
  assert(await page.$('.editor-preview-active strong'), '미리보기 서식 미적용');
});
await check('C9', async () => {
  await openWrite();
  await page.fill('#field-title', '작성 중');
  dialogs.length = 0;
  await page.click('#manage-categories-link');
  await page.waitForTimeout(200);
  assert(page.url().endsWith('#/settings'), 'url=' + page.url());
  assert(dialogs.some((m) => m.includes('작성 중인 내용이 사라집니다')), '확인 창 문구: ' + dialogs.join('|'));
});
await check('C10', async () => {
  await openWrite();
  await page.click('#form-cancel');
  await page.waitForTimeout(150);
  assert(page.url().endsWith('#/posts'), 'url=' + page.url());
});

// ---------- D. 설정 ----------
const addCategory = async (name) => {
  await page.fill('#category-name', name);
  await page.click('#category-add-btn');
  await page.waitForTimeout(120);
};
await check('D1', async () => {
  await go('#/settings');
  assert((await page.innerText('#page-settings h1')).trim() === '설정', 'h1');
  assert(await page.$('#category-name') && (await page.$('#category-add-btn')), '입력칸/추가 버튼 없음');
});
await check('D2', async () => { await go('#/settings'); await addCategory('   '); assert((await errText('#err-category-name')) === '카테고리 이름을 입력해 주세요.', await errText('#err-category-name')); });
await check('D3', async () => { await go('#/settings'); await addCategory('가'.repeat(21)); assert((await errText('#err-category-name')) === '카테고리 이름은 20자 이내로 입력해 주세요.', await errText('#err-category-name')); });
await check('D4', async () => { await go('#/settings'); await addCategory('미분류'); assert((await errText('#err-category-name')) === '이미 사용 중인 이름입니다.', await errText('#err-category-name')); });
await check('D5', async () => {
  const t = await page.innerText('#page-settings');
  assert(t.includes('미분류') && t.includes('수정하거나 삭제할 수 없습니다'), '안내 문구 없음');
});

// ---------- E. 보안 ----------
const previewHtml = async (md) => {
  await openWrite();
  dialogs.length = 0;
  await setEditor(md);
  await page.click('.editor-toolbar button.preview');
  // 내용이 비어 보이는 미리보기(예: src 없는 img)도 있으므로 보이는지가 아니라 붙어 있는지로 기다린다
  await page.waitForSelector('.editor-preview-active', { state: 'attached', timeout: 5000 });
  await page.waitForTimeout(250);
  return page.$eval('.editor-preview-active', (e) => e.innerHTML);
};
await check('E1', async () => {
  const html = await previewHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.com"></iframe>');
  assert(!/<script/i.test(html) && !/onerror/i.test(html) && !/<iframe/i.test(html), '위험 요소 남음: ' + html.slice(0, 120));
  assert(!dialogs.some((m) => m === '1'), '경고창 실행됨');
});
await check('E2', async () => {
  const html = await previewHtml('[클릭](javascript:alert(1))\n\n[데이터](data:text/html,x)');
  assert(!/href="javascript:/i.test(html) && !/href="data:/i.test(html), '위험 링크 남음: ' + html.slice(0, 160));
});
await check('E3', async () => {
  const html = await previewHtml('![](http://example.com/a.png)\n\n![](https://example.com/ok.png)');
  assert(!/src="http:/i.test(html), 'http 이미지 남음');
});
await check('E4', async () => {
  const html = await previewHtml('[ok](https://example.com)');
  assert(/target="_blank"/.test(html) && /rel="noopener noreferrer"/.test(html), '링크 속성: ' + html.slice(0, 160));
});
await check('E5', async () => {
  const js = read('script.js');
  const hits = (re) => (js.match(re) || []).length;
  for (const [name, re] of [['insertAdjacentHTML', /insertAdjacentHTML/g], ['outerHTML', /outerHTML\s*=/g], ['eval', /\beval\s*\(/g], ['document.write', /document\.write/g], ['new Function', /new\s+Function\s*\(/g]]) assert(hits(re) === 0, `${name} 사용`);
  const lines = js.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /innerHTML/.test(l));
  assert(lines.length <= 2, 'innerHTML 사용 줄: ' + lines.map(([n]) => n).join(','));
  return `innerHTML ${lines.length}곳(줄 ${lines.map(([n]) => n).join(',')})`;
});
await check('E6', async () => {
  const html = read('index.html');
  assert(!/\son[a-z]+\s*=/i.test(html), '인라인 이벤트 핸들러');
  assert(!/\sstyle\s*=/i.test(html), '인라인 style');
  assert(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html), '인라인 스크립트');
});
await check('E7', async () => {
  const viol = [];
  const p2 = await ctx.newPage();
  p2.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) viol.push(m.text().slice(0, 140)); });
  p2.on('pageerror', (e) => viol.push('pageerror: ' + e.message));
  for (const h of ['#/', '#/ai', '#/posts', '#/write', '#/settings', '#/abc']) {
    await p2.goto(`${BASE}/${h}`);
    await p2.waitForTimeout(500);
  }
  await p2.close();
  assert(viol.length === 0, viol.join(' | '));
  assert(fs.existsSync(path.join(ROOT, 'vercel.json')), 'vercel.json 없음(헤더 미적용)');
});
await check('E8', async () => {
  const csp = JSON.parse(read('vercel.json')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const src = read('index.html') + read('script.js');
  const urls = [...new Set(src.match(/https:\/\/[a-z0-9.-]+\/[^\s"'`)]*/gi) || [])];
  // example.com·github.com·w3.org: 예시/자리 표시, markdownguide.org: 새 탭으로 여는 안내 링크(자원 로드가 아니라 CSP 대상 아님)
  const external = urls.filter((u) => !/(example\.com|github\.com|w3\.org|markdownguide\.org)/.test(u));
  const hosts = [...new Set(external.map((u) => new URL(u).origin))];
  const missing = hosts.filter((h) => !csp.includes(h) && !csp.includes(h.replace(/^https:\/\/[^.]+\./, 'https://*.')));
  assert(missing.length === 0, 'CSP 미허용 출처: ' + missing.join(','));
  const unpinned = external.filter((u) => /cdn\.jsdelivr\.net\/npm\/[^@/]+\//.test(u));
  assert(unpinned.length === 0, '버전 미고정: ' + unpinned.join(','));
  return '출처: ' + hosts.join(', ');
});
await check('E9', async () => {
  const files = ['index.html', 'style.css', 'script.js', 'vercel.json', 'firestore.rules'];
  for (const f of files) {
    let s = read(f);
    // Firebase 웹 apiKey(AIza…)는 공개되어도 되는 값이라 script.js의 firebaseConfig 안에서만 허용
    if (f === 'script.js') s = s.replace(/apiKey:\s*"AIza[0-9A-Za-z_-]+"/, 'apiKey: "(공개 웹 키)"');
    assert(!/private_key|BEGIN PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}/.test(s), `${f}에 비밀값 의심 문자열`);
  }
});
await check('E10', async () => {
  const r = read('firestore.rules');
  for (const w of ['posts', 'categories', 'hasOnly', 'createdAt', 'request.time', 'allow read', 'if false']) assert(r.includes(w), `규칙에 "${w}" 없음`);
  assert(!/if\s+true\s*;/.test(r.replace(/allow (get|list|read|delete)[^;]*if true;/g, '')), '허용(if true) 규칙 의심');
});

// ---------- F. 반응형·디자인 ----------
const ALLROUTES = ['#/', '#/ai', '#/posts', '#/write', '#/settings', '#/abc'];
for (const [w, h] of [[375, 800], [768, 900], [1280, 900]]) {
  await check(`F1@${w}`, async () => {
    await page.setViewportSize({ width: w, height: h });
    for (const r of ALLROUTES) {
      await go(r);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert(o.sw <= o.iw, `${r} ${w}px 가로 스크롤 (${o.sw} > ${o.iw})`);
    }
  });
}
await check('F2', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await go('#/');
  const tops = await page.$$eval('#main-nav .nav-link', (a) => [...new Set(a.filter((x) => !x.hidden).map((x) => Math.round(x.getBoundingClientRect().top)))]);
  assert(tops.length === 1, '메뉴가 여러 줄: ' + tops.join(','));
  const ox = await page.$eval('#main-nav', (n) => getComputedStyle(n).overflowX);
  assert(['auto', 'scroll'].includes(ox), 'nav overflow-x=' + ox);
});
await check('F3', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWrite();
  const hs = await page.$$eval('.btn:not(.btn-sm):not(.btn-link)', (b) => b.filter((x) => x.offsetParent !== null).map((x) => Math.round(x.getBoundingClientRect().height)));
  assert(hs.length > 0 && hs.every((x) => x >= 44), '버튼 높이: ' + hs.join(','));
});
await check('F4', async () => {
  await go('#/');
  await page.keyboard.press('Tab');
  const s = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { tag: e.tagName, ow: c.outlineWidth, os: c.outlineStyle, bs: c.boxShadow }; });
  assert(s.os !== 'none' && parseFloat(s.ow) >= 2 || s.bs !== 'none', '포커스 표시 없음: ' + JSON.stringify(s));
});
await check('F5', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await go('#/posts');
  const w1 = await page.$eval('#page-posts', (e) => e.getBoundingClientRect().width);
  await go('#/');
  const w2 = await page.$eval('#page-home', (e) => e.getBoundingClientRect().width);
  assert(w1 <= 730, '글 영역 폭 ' + w1);
  assert(w2 <= 970, '소개 영역 폭 ' + w2);
  return `글 ${Math.round(w1)}px, 소개 ${Math.round(w2)}px`;
});
await check('F6', async () => {
  await go('#/');
  await page.waitForTimeout(800);
  const ok = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "SUIT Variable"'); });
  assert(ok, 'SUIT Variable 로드 안 됨(네트워크/CSP 확인)');
});
await check('F7', async () => {
  for (const [w, h] of [[375, 800], [768, 900], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, r] of [['home', '#/'], ['ai', '#/ai'], ['posts', '#/posts'], ['write', '#/write'], ['settings', '#/settings']]) {
      await go(r);
      if (name === 'write') await page.waitForSelector('.CodeMirror', { timeout: 15000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: true });
    }
  }
  return 'tests/screenshots/ 에 15장 저장';
});

// ---------- I. 로그인 (실제 Firebase 설정으로 실행, 로그아웃 상태 기준) ----------
const realCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const rp = await realCtx.newPage();
const rgo = async (hash) => { await rp.goto(`${BASE}/${hash}`); await rp.waitForTimeout(2500); };
const realConfigured = !/apiKey:\s*"YOUR_/.test(read('script.js'));
const authCheck = (id, fn) => check(id, async () => { if (!realConfigured) return '설정값 없음, 건너뜀'; return fn(); });
await authCheck('I1', async () => {
  await rgo('');
  const t = await rp.$$eval('#main-nav .nav-link', (a) => a.filter((x) => !x.hidden).map((x) => x.textContent.trim()));
  assert(t.join('|') === '소개|AI 정보|글 목록|로그인', '로그아웃 상태 메뉴: ' + t.join('|'));
  assert(await rp.$eval('#logout-btn', (b) => b.hidden), '로그아웃 버튼이 보임');
});
await authCheck('I2', async () => {
  for (const h of ['#/write', '#/settings']) {
    await rgo(h);
    assert(rp.url().endsWith('#/login'), `${h} → ${rp.url()}`);
    assert(await rp.$eval('#page-login', (e) => !e.hidden), '로그인 화면이 아님');
  }
});
await authCheck('I3', async () => {
  await rgo('#/login');
  const btn = (await rp.innerText('#google-login-btn')).trim();
  assert(btn === 'Google로 로그인', '버튼 문구: ' + btn);
  assert(!(await rp.$('#login-email')) && !(await rp.$('#login-password')), '이메일/비밀번호 입력칸이 남아 있음');
});
await authCheck('I4', async () => {
  // 로그인 팝업 URL이 Google 인증 주소로 열리는지(실제 로그인은 하지 않고 팝업만 확인)
  await rgo('#/login');
  const [popup] = await Promise.all([rp.waitForEvent('popup', { timeout: 15000 }), rp.click('#google-login-btn')]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const u = popup.url();
  await popup.close();
  assert(/accounts\.google\.com|firebaseapp\.com\/__\/auth/.test(u), '팝업 주소: ' + u);
});
await authCheck('I5', async () => {
  const bad = [];
  const rp2 = await realCtx.newPage();
  rp2.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) bad.push(m.text().slice(0, 140)); });
  for (const h of ['#/', '#/login', '#/posts']) { await rp2.goto(`${BASE}/${h}`); await rp2.waitForTimeout(2000); }
  await rp2.close();
  assert(bad.length === 0, 'CSP 위반: ' + bad.join(' | '));
});
// 글쓴이로 로그인한 화면: 인증 상태 콜백을 가짜 글쓴이로 즉시 호출하도록 요청 단계에서만 치환(파일은 그대로)
await authCheck('I6', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await c.route('**/script.js*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('authMod.onAuthStateChanged(auth, (u) => {', '((cb) => cb({ uid: "kxTRg9pTThdPBZ2wgDYSebyP0z33" }))((u) => {');
    await route.fulfill({ response: res, body });
  });
  const p = await c.newPage();
  await p.goto(`${BASE}/`);
  await p.waitForTimeout(2500);
  const t = await p.$$eval('#main-nav .nav-link', (a) => a.filter((x) => !x.hidden).map((x) => x.textContent.trim()));
  assert(t.join('|') === '소개|AI 정보|글 목록|글 쓰기|설정|로그아웃', '로그인 상태 메뉴: ' + t.join('|'));
  const box = await p.$eval('#logout-btn', (b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { w: r.width, h: r.height, border: cs.borderTopWidth }; });
  assert(box.w > 40 && box.h >= 40 && box.border !== '0px', '로그아웃 버튼 모양: ' + JSON.stringify(box));
  await p.goto(`${BASE}/#/write`);
  await p.waitForTimeout(800);
  assert(await p.$eval('#page-form', (e) => !e.hidden), '로그인 상태에서 글 쓰기가 열리지 않음');
  await p.screenshot({ path: path.join(SHOTS, 'loggedin-write-1280.png') });
  await c.close();
});
await realCtx.close();

// ---------- G19 (설정값 없을 때) ----------
await check('G19', async () => {
  if (!/apiKey:\s*"YOUR_/.test(read('script.js'))) return 'firebaseConfig가 설정되어 있어 건너뜀(자리 표시 모드 검사 불가)';
  await page.setViewportSize({ width: 1280, height: 900 });
  const before = consoleErrors.length;
  await go('#/posts');
  await page.waitForTimeout(500);
  const t = await page.innerText('#page-posts');
  assert(/Firebase 설정이 필요합니다/.test(t), '안내 문구 없음: ' + t.slice(0, 100));
  await go('#/settings');
  assert(/Firebase 설정이 필요합니다/.test(await page.innerText('#page-settings')), '설정 페이지 안내 문구 없음');
  const errs = consoleErrors.slice(before).filter((e) => !/Failed to load resource/.test(e));
  assert(errs.length === 0, '콘솔 오류: ' + errs.join(' | '));
});

await browser.close();
if (server) server.close();

// ---------- 결과 출력·VERIFY.md 기록 ----------
const rows = [...results.entries()];
const pass = rows.filter(([, r]) => r.ok).length;
console.log('\nID      결과  메모');
for (const [id, r] of rows) console.log(`${id.padEnd(7)} ${r.ok ? 'PASS' : 'FAIL'}  ${r.note}`);
console.log(`\n통과 ${pass} / ${rows.length}`);

const vpath = path.join(ROOT, 'VERIFY.md');
let md = fs.readFileSync(vpath, 'utf8');
const merged = new Map();
for (const [id, r] of rows) {
  const base = id.split('@')[0];
  const prev = merged.get(base);
  merged.set(base, { ok: (prev ? prev.ok : true) && r.ok, note: [prev?.note, r.ok ? r.note : `${id}: ${r.note}`].filter(Boolean).join(' ; ') });
}
for (const [id, r] of merged) {
  const re = new RegExp(`^- \\[[ x!~]\\] ${id} (.*?)(?: ⟵ .*)?$`, 'm');
  md = md.replace(re, (_, body) => `- [${r.ok ? 'x' : '!'}] ${id} ${body}${r.note ? ` ⟵ ${r.ok ? '' : '실패: '}${r.note}` : ''}`);
}
fs.writeFileSync(vpath, md);
process.exit(pass === rows.length ? 0 : 1);

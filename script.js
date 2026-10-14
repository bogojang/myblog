// AI 업무 학습 일지 - script.js (ES 모듈)
// 구성: 설정 / 유틸 / 마크다운 / 데이터 / 라우터 / 페이지 렌더 / 이벤트 / 초기화

// ===================================================================
// 1. 설정
// ===================================================================
const firebaseConfig = {
  apiKey: "AIzaSyCkLp_SxZeXg6OzJ3lTZ_iIDvqRPi_eJmE",
  authDomain: "ai-study-blog.firebaseapp.com",
  projectId: "ai-study-blog",
  storageBucket: "ai-study-blog.firebasestorage.app",
  messagingSenderId: "101055321118",
  appId: "1:101055321118:web:61b0fc17611c01adb04a0f",
};
const FIREBASE_ENABLED = !String(firebaseConfig.apiKey).startsWith("YOUR_");
const FB_VER = "10.12.2";

const SITE = "AI 업무 학습 일지";
const MSG = {
  noConfig: "Firebase 설정이 필요합니다. script.js의 firebaseConfig를 입력해 주세요.",
  generic: "처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  loadFail: "내용을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  saved: "저장했습니다.",
  edited: "수정했습니다.",
  deleted: "삭제했습니다.",
  saving: "저장하는 중...",
  confirmDelete: "정말 삭제할까요?",
  confirmLeave: "작성 중인 내용이 사라집니다. 이동할까요?",
  confirmCancelEdit: "수정한 내용이 사라집니다. 취소할까요?",
  noCategory: "미분류",
  noPreview: "미리볼 내용이 없습니다.",
};
const ID_RE = /^[A-Za-z0-9]{20}$/;
const PAGES = ["home", "ai", "posts", "post", "form", "settings", "login", "notfound"];
MSG.loginFail = "로그인하지 못했습니다. 다시 시도해 주세요.";
MSG.notOwner = "글쓴이 계정이 아닙니다.";
MSG.loggedIn = "로그인했습니다.";
MSG.loggedOut = "로그아웃했습니다.";

// ===================================================================
// 2. 유틸
// ===================================================================
const $ = (id) => document.getElementById(id);

function clear(el) {
  if (el) el.replaceChildren();
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// 안내 문구를 넣었다가 원래 내용(링크 등)으로 되돌리는 도우미
function setNotice(el, text) {
  if (!el) return;
  if (!el._orig) el._orig = Array.from(el.childNodes);
  el.textContent = text;
}
function resetNotice(el) {
  if (el && el._orig) el.replaceChildren(...el._orig);
}

// 본문 앞부분(마크다운 기호 제거한 일반 글자)
function plainExcerpt(md, max = 100) {
  let t = String(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/[|`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join("") + "…" : t;
}

// ===================================================================
// 3. 마크다운 (프로젝트 유일의 HTML 입력 경로)
// ===================================================================
const PURIFY_CFG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "link", "meta", "base", "script"],
  FORBID_ATTR: ["style", "srcset"],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};
let hookInstalled = false;

function installHook() {
  if (hookInstalled || typeof DOMPurify === "undefined") return;
  hookInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^https:\/\//i.test(src)) node.removeAttribute("src"); // 이미지는 https만
    }
  });
}

function renderMarkdown(src) {
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") return "";
  installHook();
  return DOMPurify.sanitize(marked.parse(String(src)), PURIFY_CFG);
}

// 정화된 결과를 DOM에 넣는 유일한 곳
function setSafeHtml(el, md) {
  el.innerHTML = renderMarkdown(md);
}

// ===================================================================
// 4. 데이터 (Firebase)
// ===================================================================
let fb = null; // 불러온 Firebase 함수 모음
let posts = []; // 날짜 내림차순
let categories = [];
const loaded = { posts: false, cats: false };
let loadError = false;
let busy = false; // 처리 중(중복 클릭 방지)

// ---- 로그인 상태 (글쓴이 전용 기능 제한) ----
// Firebase 설정이 없을 때(자리 표시 모드)는 화면 확인을 위해 제한하지 않는다.
// 글쓴이 계정의 UID(공개되어도 되는 값). 규칙(firestore.rules)의 isOwner()와 같은 목록을 유지해야 한다.
const OWNER_UIDS = ["kxTRg9pTThdPBZ2wgDYSebyP0z33"];
let user = null;
let authReady = !FIREBASE_ENABLED;
let afterLogin = "#/posts";
let loginError = "";
const isOwnerUser = (u) => !!u && OWNER_UIDS.includes(u.uid);
const canEdit = () => !FIREBASE_ENABLED || isOwnerUser(user);

const dataNotice = () => (!FIREBASE_ENABLED ? MSG.noConfig : loadError ? MSG.loadFail : "");
const dataReady = () => loaded.posts && loaded.cats;
const catName = (id) => (categories.find((c) => c.id === id) || {}).name || MSG.noCategory;
const sortedCats = () => categories.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));

async function initFirebase() {
  if (!FIREBASE_ENABLED) return;
  try {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
    const [appMod, fs, authMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`),
      import(`${base}/firebase-auth.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const db = fs.getFirestore(app);
    const auth = authMod.getAuth(app);
    fb = {
      db,
      auth,
      signInGoogle: () => authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider()),
      signOut: authMod.signOut,
      ...fs,
    };
    authMod.onAuthStateChanged(auth, (u) => {
      if (u && !isOwnerUser(u)) {
        // 글쓴이가 아닌 Google 계정은 바로 로그아웃시킨다
        loginError = MSG.notOwner;
        authMod.signOut(auth);
        location.hash = "#/login";
        return;
      }
      user = u;
      authReady = true;
      render();
    });

    const onErr = () => {
      console.error("데이터 구독에 실패했습니다.");
      loadError = true;
      render();
    };
    fs.onSnapshot(
      fs.query(fs.collection(db, "posts"), fs.orderBy("date", "desc")),
      (snap) => {
        posts = snap.docs.map((d) => {
          const v = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            title: String(v.title ?? ""),
            date: String(v.date ?? ""),
            content: String(v.content ?? ""),
            categoryId: String(v.categoryId ?? ""),
            createdMs: v.createdAt && v.createdAt.toMillis ? v.createdAt.toMillis() : 0,
          };
        });
        // 날짜 내림차순, 같으면 작성 시각이 늦은 글이 위
        posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdMs - a.createdMs));
        loaded.posts = true;
        render();
      },
      onErr
    );
    fs.onSnapshot(
      fs.collection(db, "categories"),
      (snap) => {
        categories = snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? "") }));
        loaded.cats = true;
        render();
      },
      onErr
    );
  } catch (e) {
    console.error("Firebase 초기화에 실패했습니다.");
    loadError = true;
    authReady = true; // 로그인 상태를 알 수 없어도 화면이 멈추지 않게 함
    render();
  }
}

// 처리 중 상태로 실행. 실패하면 onFail 호출(오류 상세는 출력하지 않음)
async function runBusy(fn, onFail) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    console.error("요청 처리에 실패했습니다.");
    if (onFail) onFail();
  } finally {
    busy = false;
    render();
  }
}

// ===================================================================
// 5. 라우터
// ===================================================================
function parseRoute() {
  const h = location.hash.replace(/^#/, "");
  if (h === "" || h === "/") return { name: "home" };
  if (h === "/ai") return { name: "ai" };
  if (h === "/posts") return { name: "posts" };
  if (h === "/write") return { name: "form", mode: "write" };
  if (h === "/settings") return { name: "settings" };
  if (h === "/login") return { name: "login" };
  let m = /^\/post\/([^/]+)$/.exec(h);
  if (m) return ID_RE.test(m[1]) ? { name: "post", id: m[1] } : { name: "notfound" };
  m = /^\/edit\/([^/]+)$/.exec(h);
  if (m) return ID_RE.test(m[1]) ? { name: "form", mode: "edit", id: m[1] } : { name: "notfound" };
  return { name: "notfound" };
}

const TITLES = {
  home: SITE,
  ai: `AI 정보 · ${SITE}`,
  posts: `글 목록 · ${SITE}`,
  settings: `설정 · ${SITE}`,
  login: `로그인 · ${SITE}`,
  notfound: `페이지를 찾을 수 없습니다 · ${SITE}`,
};
const NAV_OF = { home: "home", ai: "ai", posts: "posts", post: "posts", settings: "settings", login: "login" };

// 로그인 상태에 맞게 메뉴 표시를 바꾼다(글쓴이 전용 메뉴는 로그인해야 보임)
function updateAuthUI() {
  const show = (sel, on) => { const el = document.querySelector(sel); if (el) el.hidden = !on; };
  const edit = canEdit();
  show('#main-nav [data-route="write"]', edit);
  show('#main-nav [data-route="settings"]', edit);
  show('#main-nav [data-route="login"]', FIREBASE_ENABLED && authReady && !user);
  show("#logout-btn", FIREBASE_ENABLED && !!user);
}

function showPage(name, navKey) {
  PAGES.forEach((p) => {
    const el = $(`page-${p}`);
    if (el) el.hidden = p !== name;
  });
  document.querySelectorAll("#main-nav a.nav-link").forEach((a) => {
    const on = a.dataset.route === navKey;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

let formKey = null; // 폼을 초기화한 대상('write' 또는 'edit:ID')

function render() {
  const r = parseRoute();
  let name = r.name;
  let post = null;
  updateAuthUI();

  // 글 쓰기·수정·설정은 로그인한 글쓴이만 (로그인 상태 확인 전에는 화면을 비워 둠)
  if (FIREBASE_ENABLED && (name === "form" || name === "settings")) {
    if (!authReady) { showPage(null, null); return; }
    if (!user) { afterLogin = location.hash || "#/posts"; location.hash = "#/login"; return; }
  }
  if (name === "login" && user) { location.hash = "#/posts"; return; }

  if (name === "post" || (name === "form" && r.mode === "edit")) {
    post = posts.find((p) => p.id === r.id) || null;
    if (!post && dataReady() && !dataNotice()) {
      if (busy) return; // 삭제 직후 깜빡임 방지
      name = "notfound";
    }
  }
  let navKey = r.name === "form" ? (r.mode === "write" ? "write" : "posts") : NAV_OF[name];
  if (name === "notfound") navKey = null;
  showPage(name, navKey);

  switch (name) {
    case "home": renderHome(); document.title = TITLES.home; break;
    case "ai": document.title = TITLES.ai; break;
    case "posts": renderPosts(); document.title = TITLES.posts; break;
    case "post": renderPost(r.id, post); break;
    case "form": renderForm(r, post); break;
    case "settings": renderSettings(); document.title = TITLES.settings; break;
    case "login": renderLogin(); document.title = TITLES.login; break;
    default: document.title = TITLES.notfound;
  }
}

function onRouteChange() {
  formKey = null;
  window.scrollTo(0, 0);
  render();
}

// ===================================================================
// 6. 페이지 렌더
// ===================================================================
// ---- 글 카드 ----
function makeCard(p, withDetail) {
  const li = make("li", "post-card");
  li.append(make("span", "badge", catName(p.categoryId)));
  const h = make("h3", "post-card-title");
  const a = make("a", "", p.title);
  a.href = `#/post/${p.id}`;
  h.append(a);
  li.append(h);
  const t = make("time", "post-card-date", p.date);
  if (isRealDate(p.date)) t.setAttribute("datetime", p.date);
  li.append(t);
  if (withDetail) {
    li.append(make("p", "post-card-excerpt", plainExcerpt(p.content)));
    if (canEdit()) {
      const actions = make("div", "post-card-actions");
      const edit = make("a", "btn btn-secondary btn-sm", "수정");
      edit.href = `#/edit/${p.id}`;
      const del = make("button", "btn btn-danger btn-sm", "삭제");
      del.type = "button";
      del.disabled = busy;
      del.addEventListener("click", () => deletePost(p.id, false));
      actions.append(edit, del);
      li.append(actions);
    }
  }
  return li;
}

async function deletePost(id, goList) {
  if (busy) return;
  if (!fb) { toast(dataNotice() || MSG.generic); return; }
  if (!confirm(MSG.confirmDelete)) return;
  await runBusy(
    async () => {
      await fb.deleteDoc(fb.doc(fb.db, "posts", id));
      toast(MSG.deleted);
      if (goList) location.hash = "#/posts";
    },
    () => toast(MSG.generic)
  );
}

// ---- 소개: 최근 글 ----
function renderHome() {
  const list = $("home-recent-list");
  const empty = $("home-recent-empty");
  clear(list);
  empty.hidden = true;
  const notice = dataNotice();
  if (notice) { setNotice(empty, notice); empty.hidden = false; return; }
  resetNotice(empty);
  if (!dataReady()) return;
  if (!posts.length) { empty.hidden = false; return; }
  posts.slice(0, 3).forEach((p) => list.append(makeCard(p, false)));
}

// ---- 글 목록 ----
let selectedFilter = "__all"; // 메모리에만 보관

function renderPosts() {
  const notice = dataNotice();
  const ready = dataReady();
  const list = $("post-list");
  const chips = $("category-filter");
  const empty = $("posts-empty");
  const fEmpty = $("posts-filter-empty");
  clear(list);
  clear(chips);
  $("posts-loading").hidden = !!notice || ready;
  empty.hidden = true;
  fEmpty.hidden = true;

  if (notice) { setNotice(empty, notice); empty.hidden = false; return; }
  resetNotice(empty);
  if (!ready) return;
  if (!posts.length) { empty.hidden = false; return; }

  if (selectedFilter !== "__all" && selectedFilter !== "__none" && !categories.some((c) => c.id === selectedFilter)) {
    selectedFilter = "__all";
  }
  const addChip = (value, label) => {
    const b = make("button", "chip", label);
    b.type = "button";
    const on = selectedFilter === value;
    b.classList.toggle("is-selected", on);
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => { selectedFilter = value; renderPosts(); });
    chips.append(b);
  };
  addChip("__all", "전체");
  sortedCats().forEach((c) => addChip(c.id, c.name));
  addChip("__none", MSG.noCategory);

  const known = new Set(categories.map((c) => c.id));
  const shown = posts.filter((p) =>
    selectedFilter === "__all" ? true
      : selectedFilter === "__none" ? !known.has(p.categoryId)
      : p.categoryId === selectedFilter
  );
  if (!shown.length) { fEmpty.hidden = false; return; }
  shown.forEach((p) => list.append(makeCard(p, true)));
}

// ---- 글 보기 ----
function renderPost(id, post) {
  const notice = dataNotice();
  $("post-edit-btn").href = `#/edit/${id}`;
  $("post-delete-btn").disabled = busy;
  $("post-edit-btn").hidden = !canEdit();
  $("post-delete-btn").hidden = !canEdit();
  if (!post) {
    $("post-category").textContent = "";
    $("post-title").textContent = "";
    $("post-date").textContent = "";
    clear($("post-body"));
    $("post-body").textContent = notice || "불러오는 중...";
    document.title = SITE;
    return;
  }
  $("post-category").textContent = catName(post.categoryId);
  $("post-title").textContent = post.title;
  $("post-date").textContent = post.date;
  setSafeHtml($("post-body"), post.content);
  document.title = `${post.title} · ${SITE}`;
}

// ---- 글 쓰기 / 수정 ----
let editor = null;
let formInitial = null;

function getContent() {
  return editor ? editor.value() : $("field-content").value;
}
function setContent(v) {
  if (editor) editor.value(v);
  else $("field-content").value = v;
}

function ensureEditor() {
  if (editor || typeof EasyMDE === "undefined") return;
  const E = EasyMDE;
  editor = new E({
    element: $("field-content"),
    spellChecker: false,
    autoDownloadFontAwesome: false, // index.html에서 jsdelivr로 직접 불러옴(CSP에 맞춤)
    status: false,
    forceSync: true,
    placeholder: "마크다운으로 작성할 수 있습니다 (5,000자 이내)",
    toolbar: [
      { name: "bold", action: E.toggleBold, className: "fa fa-bold", title: "굵게" },
      { name: "italic", action: E.toggleItalic, className: "fa fa-italic", title: "기울임" },
      { name: "heading", action: E.toggleHeadingSmaller, className: "fa fa-header", title: "제목" },
      "|",
      { name: "unordered-list", action: E.toggleUnorderedList, className: "fa fa-list-ul", title: "글머리 목록" },
      { name: "ordered-list", action: E.toggleOrderedList, className: "fa fa-list-ol", title: "번호 목록" },
      { name: "quote", action: E.toggleBlockquote, className: "fa fa-quote-left", title: "인용" },
      { name: "code", action: E.toggleCodeBlock, className: "fa fa-code", title: "코드" },
      "|",
      { name: "link", action: E.drawLink, className: "fa fa-link", title: "링크" },
      { name: "table", action: E.drawTable, className: "fa fa-table", title: "표" },
      "|",
      { name: "preview", action: E.togglePreview, className: "fa fa-eye no-disable", title: "미리보기" },
      { name: "guide", action: "https://www.markdownguide.org/basic-syntax/", className: "fa fa-question-circle", title: "마크다운 안내" },
    ],
    previewRender: (src) => renderMarkdown(String(src).trim() ? src : MSG.noPreview),
  });
}

function fillCategorySelect(selected) {
  const sel = $("field-category");
  clear(sel);
  const first = make("option", "", MSG.noCategory);
  first.value = "";
  sel.append(first);
  sortedCats().forEach((c) => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    sel.append(o);
  });
  sel.value = categories.some((c) => c.id === selected) ? selected : "";
}

function renderForm(r, post) {
  const isEdit = r.mode === "edit";
  const key = isEdit ? `edit:${r.id}` : "write";
  const notice = dataNotice();
  document.title = `${isEdit ? "글 수정" : "글 쓰기"} · ${SITE}`;
  $("form-heading").textContent = isEdit ? "글 수정" : "글 쓰기";
  ensureEditor();

  if (formKey !== key) {
    if (isEdit && (notice || !post || !dataReady())) {
      // 수정할 글이 아직 없음: 데이터가 올 때까지 대기(안내만 표시)
      $("form-error").textContent = notice;
      $("form-submit").disabled = true;
      return;
    }
    formKey = key;
    ["err-title", "err-date", "err-category", "err-content", "form-error"].forEach((id) => { $(id).textContent = ""; });
    const v = isEdit
      ? { title: post.title, date: post.date, categoryId: post.categoryId, content: post.content }
      : { title: "", date: todayLocal(), categoryId: "", content: "" };
    $("field-title").value = v.title;
    $("field-date").value = v.date;
    fillCategorySelect(v.categoryId);
    setContent(v.content);
    formInitial = { title: v.title, date: v.date, categoryId: $("field-category").value, content: v.content };
    if (editor) setTimeout(() => editor.codemirror.refresh(), 0);
  } else {
    fillCategorySelect($("field-category").value); // 카테고리 변경 반영, 입력은 유지
  }
  $("form-submit").disabled = busy;
  $("form-submit").textContent = busy ? MSG.saving : isEdit ? "수정 저장" : "저장";
}

function readForm() {
  return {
    title: $("field-title").value,
    date: $("field-date").value,
    categoryId: $("field-category").value,
    content: getContent(),
  };
}

function validatePost(v) {
  const errs = {};
  const title = v.title.trim();
  if (!title) errs["err-title"] = "제목을 입력해 주세요.";
  else if (Array.from(title).length > 100) errs["err-title"] = "제목은 100자 이내로 입력해 주세요.";
  if (!isRealDate(v.date)) errs["err-date"] = "날짜를 선택해 주세요.";
  if (!v.content.trim()) errs["err-content"] = "본문을 입력해 주세요.";
  else if (v.content.length > 5000) errs["err-content"] = "본문은 5,000자 이내로 입력해 주세요.";
  if (v.categoryId !== "" && !categories.some((c) => c.id === v.categoryId)) {
    errs["err-category"] = "카테고리를 다시 선택해 주세요.";
  }
  return errs;
}

async function onFormSubmit(e) {
  e.preventDefault();
  if (busy) return;
  const r = parseRoute();
  if (r.name !== "form") return;
  const ids = ["err-title", "err-date", "err-category", "err-content", "form-error"];
  ids.forEach((id) => { $(id).textContent = ""; });

  const v = readForm();
  const errs = validatePost(v);
  const bad = ids.filter((id) => errs[id]);
  if (bad.length) {
    bad.forEach((id) => { $(id).textContent = errs[id]; });
    const focusMap = { "err-title": "field-title", "err-date": "field-date", "err-category": "field-category" };
    if (focusMap[bad[0]]) $(focusMap[bad[0]]).focus();
    return;
  }
  if (!fb) { toast(dataNotice() || MSG.generic); return; }

  const data = { title: v.title.trim(), date: v.date, content: v.content, categoryId: v.categoryId };
  const isEdit = r.mode === "edit";
  await runBusy(
    async () => {
      if (isEdit) {
        await fb.updateDoc(fb.doc(fb.db, "posts", r.id), { ...data, updatedAt: fb.serverTimestamp() });
        toast(MSG.edited);
        location.hash = `#/post/${r.id}`;
      } else {
        await fb.addDoc(fb.collection(fb.db, "posts"), {
          ...data,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
        });
        toast(MSG.saved);
        location.hash = "#/posts";
      }
    },
    () => { $("form-error").textContent = MSG.generic; }
  );
}

function isDirty() {
  const v = readForm();
  return !!formInitial && (v.title !== formInitial.title || v.date !== formInitial.date ||
    v.categoryId !== formInitial.categoryId || v.content !== formInitial.content);
}

function onFormCancel(e) {
  e.preventDefault();
  const r = parseRoute();
  if (r.mode === "edit") {
    if (isDirty() && !confirm(MSG.confirmCancelEdit)) return;
    location.hash = `#/post/${r.id}`;
  } else {
    location.hash = "#/posts";
  }
}

function onManageLink(e) {
  const v = readForm();
  const hasContent = v.title.trim() !== "" || v.content.trim() !== "";
  if (hasContent && !confirm(MSG.confirmLeave)) e.preventDefault();
}

// ---- 설정 ----
let editingId = null;
let editingValue = "";
let renameError = "";
let settingsError = "";
let focusRename = false;

function validateCategoryName(raw, excludeId) {
  const name = raw.trim();
  if (!name) return "카테고리 이름을 입력해 주세요.";
  if (Array.from(name).length > 20) return "카테고리 이름은 20자 이내로 입력해 주세요.";
  const norm = name.toLowerCase();
  if (norm === MSG.noCategory || categories.some((c) => c.id !== excludeId && c.name.trim().toLowerCase() === norm)) {
    return "이미 사용 중인 이름입니다.";
  }
  if (!excludeId && categories.length >= 20) return "카테고리는 최대 20개까지 만들 수 있습니다.";
  return "";
}

function renderSettings() {
  const notice = dataNotice();
  const ready = dataReady();
  const list = $("category-list");
  const empty = $("category-empty");
  clear(list);
  empty.hidden = true;
  $("settings-error").textContent = notice || settingsError;
  $("category-add-btn").disabled = busy;

  if (notice) { setNotice(empty, notice); empty.hidden = false; return; }
  resetNotice(empty);
  if (!ready) return;
  empty.hidden = categories.length > 0;
  sortedCats().forEach((c) => list.append(makeCategoryItem(c)));
  if (focusRename) {
    focusRename = false;
    const inp = list.querySelector("input");
    if (inp) inp.focus();
  }
}

function makeBtn(label, danger, onClick) {
  const b = make("button", `btn ${danger ? "btn-danger" : "btn-secondary"} btn-sm`, label);
  b.type = "button";
  b.disabled = busy;
  b.addEventListener("click", onClick);
  return b;
}

function makeCategoryItem(c) {
  const li = make("li", "category-item");
  const actions = make("div", "category-actions");
  if (editingId === c.id) {
    const inp = make("input", "input");
    inp.type = "text";
    inp.value = editingValue;
    inp.setAttribute("aria-label", "카테고리 이름");
    inp.addEventListener("input", () => { editingValue = inp.value; });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveRename(c.id); }
      else if (e.key === "Escape") { editingId = null; renameError = ""; renderSettings(); }
    });
    li.append(inp);
    actions.append(
      makeBtn("저장", false, () => saveRename(c.id)),
      makeBtn("취소", false, () => { editingId = null; renameError = ""; renderSettings(); })
    );
    li.append(actions);
    if (renameError) li.append(make("span", "field-error", renameError));
    return li;
  }
  const count = posts.filter((p) => p.categoryId === c.id).length;
  li.append(make("span", "category-name", c.name), make("span", "category-count", `(${count}개)`));
  actions.append(
    makeBtn("이름 변경", false, () => {
      editingId = c.id; editingValue = c.name; renameError = ""; focusRename = true; renderSettings();
    }),
    makeBtn("삭제", true, () => deleteCategory(c, count))
  );
  li.append(actions);
  return li;
}

async function onAddCategory(e) {
  e.preventDefault();
  if (busy) return;
  $("err-category-name").textContent = "";
  settingsError = "";
  const raw = $("category-name").value;
  const msg = validateCategoryName(raw, null);
  if (msg) { $("err-category-name").textContent = msg; return; }
  if (!fb) { toast(dataNotice() || MSG.generic); return; }
  const name = raw.trim();
  await runBusy(
    async () => {
      await fb.addDoc(fb.collection(fb.db, "categories"), {
        name, createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp(),
      });
      $("category-name").value = "";
    },
    () => { settingsError = MSG.generic; }
  );
}

async function saveRename(id) {
  if (busy) return;
  settingsError = "";
  const msg = validateCategoryName(editingValue, id);
  if (msg) { renameError = msg; renderSettings(); return; }
  if (!fb) { toast(dataNotice() || MSG.generic); return; }
  const name = editingValue.trim();
  await runBusy(
    async () => {
      await fb.updateDoc(fb.doc(fb.db, "categories", id), { name, updatedAt: fb.serverTimestamp() });
      editingId = null;
      renameError = "";
    },
    () => { settingsError = MSG.generic; }
  );
}

async function deleteCategory(c, count) {
  if (busy) return;
  settingsError = "";
  if (!fb) { toast(dataNotice() || MSG.generic); return; }
  if (!confirm(`'${c.name}' 카테고리를 삭제할까요? 이 카테고리의 글 ${count}개는 '미분류'로 바뀝니다.`)) return;
  const affected = posts.filter((p) => p.categoryId === c.id).map((p) => p.id);
  await runBusy(
    async () => {
      const CHUNK = 450;
      for (let i = 0; i < affected.length; i += CHUNK) {
        const batch = fb.writeBatch(fb.db);
        affected.slice(i, i + CHUNK).forEach((pid) => {
          batch.update(fb.doc(fb.db, "posts", pid), { categoryId: "", updatedAt: fb.serverTimestamp() });
        });
        await batch.commit();
      }
      await fb.deleteDoc(fb.doc(fb.db, "categories", c.id));
    },
    () => { settingsError = MSG.generic; }
  );
}

// ---- 로그인 / 로그아웃 ----
function renderLogin() {
  $("err-login").textContent = loginError;
  $("google-login-btn").disabled = busy;
  $("google-login-btn").textContent = busy ? "로그인하는 중..." : "Google로 로그인";
}

async function onGoogleLogin() {
  if (busy) return;
  loginError = "";
  if (!fb) { loginError = dataNotice() || MSG.generic; renderLogin(); return; }
  await runBusy(
    async () => {
      await fb.signInGoogle();
      toast(MSG.loggedIn);
      const to = afterLogin;
      afterLogin = "#/posts";
      location.hash = to === "#/login" ? "#/posts" : to;
    },
    () => { loginError = MSG.loginFail; }
  );
}

async function onLogout() {
  if (!fb || busy) return;
  await runBusy(
    async () => {
      await fb.signOut(fb.auth);
      toast(MSG.loggedOut);
      const r = parseRoute();
      if (r.name === "form" || r.name === "settings") location.hash = "#/";
    },
    () => toast(MSG.generic)
  );
}

// ===================================================================
// 7. 초기화
// ===================================================================
function init() {
  $("google-login-btn").addEventListener("click", onGoogleLogin);
  $("logout-btn").addEventListener("click", onLogout);

  const year = $("footer-year");
  if (year) year.textContent = String(new Date().getFullYear());

  $("post-delete-btn").addEventListener("click", () => {
    const r = parseRoute();
    if (r.name === "post") deletePost(r.id, true);
  });
  $("post-back-btn").addEventListener("click", (e) => { e.preventDefault(); location.hash = "#/posts"; });

  const form = $("post-form");
  form.noValidate = true;
  form.addEventListener("submit", onFormSubmit);
  $("form-cancel").addEventListener("click", onFormCancel);
  $("manage-categories-link").addEventListener("click", onManageLink);

  $("category-form").addEventListener("submit", onAddCategory);

  window.addEventListener("hashchange", onRouteChange);
  onRouteChange();
  initFirebase();
}

init();

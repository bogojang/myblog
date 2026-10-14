# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어 규칙

- 사용자에게 하는 모든 답변은 한글로 작성한다.
- 화면에 보이는 모든 글자(UI 텍스트)도 한국어로 작성한다.

## 프로젝트

"AI 업무 학습 일지" 블로그. 빌드 단계가 없는 정적 사이트이며 Firebase(Firestore)에 저장하고 GitHub → Vercel로 배포한다. PRD는 `PRD.md`.
git 저장소 루트는 이 폴더가 아니라 상위 `D:\CHA AI`이다(소유자 문제로 git이 "dubious ownership" 오류를 낼 수 있음).

## 문서가 곧 명세 (수정 전에 해당 문서 확인)

| 문서 | 역할 |
|---|---|
| `Sitemap.md` | 페이지(P1~P8)·공통 기능(F1~F7)·**보안 기준(S1~S7)**·데이터 정의 — 기능과 보안의 기준 |
| `Contents.md` | 모든 화면 문구(검증 메시지, 확인 창, 버튼 등)와 `[작성 필요]` 항목 |
| `DESIGN.md` | 색·글꼴·간격·구성 요소 스타일 기준(`style.css`의 `:root` 변수) |
| `Plan.md` | 구조·작업 순서 |
| `VERIFY.md` | 검증 체크리스트와 결과 기록 |

기능이나 문구를 바꿀 때는 코드와 함께 해당 문서도 갱신한다.

## 구조

- 화면 코드는 `index.html`, `style.css`, `script.js` **3개 파일**(PRD 조건). 배포 설정 파일(`vercel.json`, `firestore.rules`)은 예외.
- **한 파일 안의 페이지 전환**: `index.html`에 `section.page`(`page-home`, `page-ai`, `page-posts`, `page-post`, `page-form`, `page-settings`, `page-notfound`)가 모두 있고, `script.js`의 해시 라우터(`#/`, `#/ai`, `#/posts`, `#/write`, `#/edit/ID`, `#/post/ID`, `#/settings`)가 `hidden`을 토글한다. 글 쓰기와 수정은 같은 폼·같은 마크다운 편집기(EasyMDE)를 공유한다.
- `script.js`는 ES 모듈이며 Firebase SDK(10.12.2)를 gstatic에서 **동적 import**한다. `firebaseConfig`가 `YOUR_`로 시작하는 자리 표시이면 Firebase 비활성 모드로 동작한다(고정 페이지·라우팅·폼 검증은 동작, 데이터 영역에는 "Firebase 설정이 필요합니다" 안내).
- **로그인**: 글쓴이 전용 Google 로그인(Firebase Authentication 팝업, `#/login`). 읽기는 누구나, 글 쓰기·수정·삭제·설정은 글쓴이 UID만(`script.js`의 `OWNER_UIDS`와 `firestore.rules`의 `isOwner()`에 **같은 UID 목록**을 유지). 글쓴이가 아닌 계정은 로그인 직후 자동 로그아웃. Firebase 설정이 없는 모드에서는 제한하지 않는다. `verify.mjs`는 기본 검사(A~F)를 위해 요청 단계에서 `script.js`의 apiKey를 자리 표시로 바꿔 실행하고, 로그인 검사(I)만 실제 설정으로 실행한다.
- 데이터: `posts`(`title, date, content(마크다운 원문), categoryId, createdAt, updatedAt`), `categories`(`name, createdAt, updatedAt`). 글에는 카테고리 **이름이 아닌 ID**를 저장하고, `""`는 `미분류`. 카테고리 삭제 시 `writeBatch`로 글의 `categoryId`를 `""`로 바꾼다.
- 외부 라이브러리는 CDN으로 버전 고정(SRI 포함): EasyMDE 2.18.0, marked 4.3.0, DOMPurify 3.0.6, Font Awesome 4.7.0, SUIT/Bricolage 글꼴. **새 외부 출처를 추가하면 `vercel.json`의 CSP도 함께 수정**해야 한다.

## 보안 규칙 (깨뜨리기 쉬운 것)

- **`innerHTML`은 `script.js`의 `setSafeHtml()` 한 곳에서만** 쓴다(마크다운 → `marked` → `DOMPurify` 결과). 그 밖의 모든 사용자 입력 출력은 `textContent`/`createElement`. `eval`, `insertAdjacentHTML`, `document.write` 금지.
- `index.html`에 인라인 `style=`, `on…=` 핸들러, 인라인 스크립트를 넣지 않는다(CSP).
- 링크는 `https`(+ `mailto`)만, 외부 링크는 `target="_blank" rel="noopener noreferrer"`.
- `firestore.rules`는 필드·길이·형식 검증용이며 쓰기는 글쓴이 UID만 가능. 가입 허용(Enable create)도 꺼 둔다. 콘솔에 직접 적용해야 한다(`.vercelignore`로 배포에서 제외됨).

## 명령어

```bash
# 로컬 실행 (vercel.json의 CSP 헤더를 그대로 적용하는 정적 서버, 포트 5173)
node tests/serve.mjs

# 자동 검증 (Playwright, 서버를 직접 띄움). 처음 한 번: cd tests && npm install && npx playwright install chromium
cd tests && node verify.mjs
BASE_URL=https://배포주소 node verify.mjs   # 배포된 주소를 검사

# script.js 문법 검사 (모듈이라 .mjs 사본으로)
cp script.js "$TEMP/s.mjs" && node --check "$TEMP/s.mjs"
```

`verify.mjs`는 `VERIFY.md`의 `[자동]` 항목(A~F, G19) 52개를 ID별로 실행하고 결과를 `VERIFY.md`의 체크박스에 기록한다. 단일 항목만 실행하는 옵션은 없다(스크립트에서 해당 `check('ID', …)` 블록을 확인). Firebase가 필요한 항목(G1~G18)은 설정값 입력 전까지 `보류`이며 아직 자동화되어 있지 않다.

## 남은 작업 (사용자)

Firebase 프로젝트 생성 후 `script.js` 맨 위 `firebaseConfig` 교체, `firestore.rules` 콘솔 적용, API 키 HTTP 리퍼러 제한, `[작성 필요]`(이름·경력·도구·연락처) 채우기, GitHub → Vercel 배포. 상세는 `VERIFY.md` G·H 항목.

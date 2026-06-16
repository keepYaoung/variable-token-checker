# Variable Checker

라이트/다크처럼 **모드(mode)만 다르고 토큰은 같아야 하는 두 프레임**을 골라
실행하면, 대응되는 레이어들이 같은 변수(토큰)에 바인딩됐는지 비교하고,
각 모드의 실제 값을 보여주며, **하드코딩된(변수 미사용) 값**을 잡아내는 Figma 플러그인.

## 무엇을 검사하나

- **같은 변수 바인딩 여부** — A/B 양쪽 레이어가 같은 토큰을 가리키는지.
- **모드 값 표시** — 한 변수가 Light/Dark 등 모드별로 갖는 실제 값.
- **하드코딩 검출** — 변수 대신 raw 값(예: `#1A1A1A`)을 박은 곳.

### 판정(Verdict) 매트릭스

| A 상태 | B 상태 | 결과 |
|---|---|---|
| variable X | variable X | **OK** (모드값 표 함께) |
| variable X | variable Y | **diff-token** |
| variable | hardcoded | **one-hardcoded** |
| hardcoded | variable | **one-hardcoded** |
| hardcoded | hardcoded | **both-hardcoded** (warn) |
| variable | absent / mixed | **structure-prop** |

## v0 비교 범위

| 범위 | 항목 |
|---|---|
| 색상 | `fills[i].color`, `strokes[i].color` (SOLID 페인트만; gradient/image는 감지만) |
| 스칼라 | `cornerRadius` (+ 네 모서리), `opacity`, `paddingLeft/Right/Top/Bottom`, `itemSpacing` |
| 텍스트 | `fontSize`, `lineHeight`, `letterSpacing`, `fontWeight` |

레이어 페어링은 **경로 키(pathKey)** 기준 — 동명 형제는 `[0]`, `[1]` 인덱스로 구분.

## 설치 (개발 모드)

1. `npm install`
2. `npm run build` → `dist/code.js`, `dist/ui.html` 생성.
3. Figma 데스크톱 → **Plugins → Development → Import plugin from manifest…**
   → 이 폴더의 `manifest.json` 선택.

## 사용

1. 같은 디자인의 두 프레임(예: `Light` / `Dark`)을 선택.
2. **Plugins → Development → Variable Checker** 실행.
3. 리포트 탭 확인:
   - **Mismatches** — 모든 불일치 (diff-token / one-hardcoded / structure-prop / both-hardcoded).
   - **Structure** — 한쪽에만 있는 레이어.
   - **Hardcoded** — A/B 각각의 변수 미사용 값 목록.
   - **OK** — 같은 변수에 바인딩된 항목 (모드값 표 펼침).
4. 항목 클릭 → 캔버스에서 해당 레이어로 점프.
5. 선택을 바꾼 뒤 **Re-run** 버튼.

## 개발

```bash
npm run watch       # esbuild watch (재빌드 + ui.html 복사)
npm run typecheck   # tsc --noEmit
npm test            # compare.ts 순수 로직 단위 테스트 (node --test)
```

### 프로젝트 구조

```
variable-checker/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ build.mjs              # esbuild + ui.html copy
├─ src/
│  ├─ code.ts             # Figma 메인 스레드 (snapshot + 변수 해석)
│  ├─ compare.ts          # 순수 비교 로직 (Figma API 무관, 테스트 가능)
│  ├─ types.ts            # 공유 스키마 + 메시지 타입
│  └─ ui.html             # UI 스레드 (리포트 렌더)
├─ test/
│  └─ compare.test.mjs    # 8 케이스
└─ dist/                  # 빌드 산출물 (커밋됨, 매니페스트가 참조)
```

### 변경 흐름

`src/*` 수정 → `npm run build` → Figma에서 플러그인 재실행.
타입 변경 시 `npm run typecheck` 으로 검증, 비교 로직 변경 시 `npm test`.

## 매니페스트 메모

- `documentAccess: "dynamic-page"` 사용. 따라서 변수 조회는 **반드시 async**
  (`getVariableByIdAsync`, `getVariableCollectionByIdAsync`).
- `networkAccess: { allowedDomains: ["none"] }` — 외부 통신 없음.

## 알려진 한계 (v0 후속)

- effects / gradient / image 페인트는 **감지만** 하고 토큰 상세 비교 안 함.
- 레이어 페어링은 **이름+동명 인덱스** — 이름 다르게 리네임하면 구조 차이로 잡힘.
- 스타일(Style) 기반 토큰(변수 외) 비교 미지원.
- 3개 이상 모드 / 다중 컬렉션 교차검증 미지원.

# Continuous Vertical Guide Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logseqのようにhover縦線を1本の連続形として見せ、通常線をtheme追従の20%色へ強める。

**Architecture:** Obsidianのnative `.cm-indent::before`と既存outer widgetを描画源として維持する。`GuideFoldingPluginValue`が論理groupの先頭と末尾へendpoint markerを同期し、CSSは先頭の上端と末尾の下端だけを丸める。

**Tech Stack:** TypeScript、CodeMirror 6 ViewPlugin、CSS logical border radius、Jest、Obsidian 1.13.2。

## Global Constraints

- Accepted design: `docs/superpowers/specs/2026-07-21-continuous-vertical-guide-hover-design.md`。
- 保存key `enhanceVerticalLineHover`と既定値`true`は変更しない。
- 通常色は`color-mix(in oklch, var(--text-normal) 20%, transparent)`とする。
- hover幅は3px、active色は`--indentation-guide-color-active`、radiusは2pxを維持する。
- 中間segmentへradiusを付けない。
- 独立overlay、screen座標cache、追加DOM、gradient、box-shadow、transitionを追加しない。
- Git書き込みはGitButlerの`but`だけを使う。
- local testはNode.js 22.23.1以上で実行する。

---

### Task 1: Hover groupのendpoint marker

**Files:**

- Modify: `src/features/GuideFolding.ts`
- Test: `src/features/__tests__/GuideFolding.test.ts`

**Interfaces:**

- Consumes: `synchronizeHoveredIndentGuides(contentDOM, highlightedGuides)`と`synchronizeHoveredOuterListGuides(contentDOM, guides)`が受け取るDOM順の論理group。
- Produces: innerとouterのstart markerおよびend marker。

- [ ] **Step 1: inner guideの失敗testを追加する**

既存の3 segment hover fixtureを使い、write後のclassを次の形で検証する。

```ts
expect(first.classList.contains("bullet-plugin-hovered-indent-guide-start")).toBe(true);
expect(first.classList.contains("bullet-plugin-hovered-indent-guide-end")).toBe(false);
expect(middle.classList.contains("bullet-plugin-hovered-indent-guide-start")).toBe(false);
expect(middle.classList.contains("bullet-plugin-hovered-indent-guide-end")).toBe(false);
expect(last.classList.contains("bullet-plugin-hovered-indent-guide-start")).toBe(false);
expect(last.classList.contains("bullet-plugin-hovered-indent-guide-end")).toBe(true);
```

1 segment fixtureでは同じelementがstartとendを両方持つことを検証する。
group置換後は前groupのendpoint markerが消え、pointer leaveとdestroy後は全endpoint markerが消えることも同じtestへ加える。

- [ ] **Step 2: focused testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: endpoint markerがまだ存在しないためFAILする。

- [ ] **Step 3: endpoint marker同期を実装する**

`GuideFolding.ts`へ次の定数を追加する。

```ts
const HOVERED_GUIDE_START_MARKER =
  "bullet-plugin-hovered-indent-guide-start";
const HOVERED_GUIDE_END_MARKER = "bullet-plugin-hovered-indent-guide-end";
const HOVERED_GUIDE_START_SELECTOR = `.${HOVERED_GUIDE_START_MARKER}`;
const HOVERED_GUIDE_END_SELECTOR = `.${HOVERED_GUIDE_END_MARKER}`;

const HOVERED_OUTER_LIST_GUIDE_START_CLASS =
  "bullet-plugin-hovered-outer-list-guide-start";
const HOVERED_OUTER_LIST_GUIDE_END_CLASS =
  "bullet-plugin-hovered-outer-list-guide-end";
const HOVERED_OUTER_LIST_GUIDE_START_SELECTOR =
  `.${HOVERED_OUTER_LIST_GUIDE_START_CLASS}`;
const HOVERED_OUTER_LIST_GUIDE_END_SELECTOR =
  `.${HOVERED_OUTER_LIST_GUIDE_END_CLASS}`;
```

marker同期は、古いstartとendを先に全除去し、hover markerを同期したあと、配列の先頭と末尾へ付け直す。

```ts
function synchronizeHoverMarkers(
  contentDOM: ParentNode,
  guides: Iterable<Element>,
  marker: string,
  markerSelector: string,
  startMarker: string,
  startSelector: string,
  endMarker: string,
  endSelector: string,
) {
  const ordered = Array.from(guides);
  const next = new Set(ordered);

  for (const element of Array.from(contentDOM.querySelectorAll(startSelector))) {
    element.classList.remove(startMarker);
  }
  for (const element of Array.from(contentDOM.querySelectorAll(endSelector))) {
    element.classList.remove(endMarker);
  }
  for (const element of Array.from(contentDOM.querySelectorAll(markerSelector))) {
    if (!next.has(element)) element.classList.remove(marker);
  }
  ordered.forEach((element) => element.classList.add(marker));
  ordered[0]?.classList.add(startMarker);
  ordered[ordered.length - 1]?.classList.add(endMarker);
}
```

innerとouterの既存同期関数はこのhelperへそれぞれのmarkerを渡す。
既存のclear呼び出しは空配列を渡すだけでhoverとendpointをすべて除去できる形を維持する。

- [ ] **Step 4: outer chunkのendpoint testを追加する**

同じchunk IDの2 widgetに対して、最初のwidgetがstartだけ、最後のwidgetがendだけを持つことを検証する。
DOM replacement後の新widgetへendpointが移り、pointer leave、設定無効化、destroyで両markerが消えることも検証する。

- [ ] **Step 5: focused testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: PASS。

### Task 2: 連続角丸と通常guide色

**Files:**

- Modify: `styles.css`
- Modify: `src/features/SettingsTab.ts`
- Test: `src/features/__tests__/GuideFolding.test.ts`
- Test: `src/features/__tests__/SettingsTab.test.ts`

**Interfaces:**

- Consumes: Task 1が付ける4つのendpoint markerと既存body class `bullet-plugin-enhanced-vertical-line-hover`。
- Produces: 通常色20%、3pxの連続hover、設定画面の正確なlabelと説明文。

- [ ] **Step 1: CSS contractの失敗testを書く**

既存のenhanced inner ruleとouter ruleから`border-radius: 2px;`が消えることを期待する。
start ruleは次の宣言を持ち、end ruleは下側2角だけを持つことを期待する。

```ts
expect(startDeclarations?.replace(/\s+/g, " ").trim()).toBe(
  "border-start-start-radius: 2px; border-start-end-radius: 2px;",
);
expect(endDeclarations?.replace(/\s+/g, " ").trim()).toBe(
  "border-end-start-radius: 2px; border-end-end-radius: 2px;",
);
```

enhanced view ruleは次のcustom propertyだけを持つことを期待する。

```ts
expect(normalColorDeclarations?.replace(/\s+/g, " ").trim()).toBe(
  "--indentation-guide-color: color-mix(in oklch, var(--text-normal) 20%, transparent);",
);
```

- [ ] **Step 2: Settings labelの失敗testを書く**

設定groupの期待値を`Enhance vertical lines`へ変え、定義を次の値で検証する。

```ts
expect(enhancedLinesSetting).toMatchObject({
  name: "Enhance vertical lines",
  desc: "Strengthen indentation lines and use a continuous rounded hover.",
  control: { type: "toggle", key: "enhancedVerticalLineHover" },
});
```

- [ ] **Step 3: focused testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: 現在の全segment角丸、12%のnative通常色、旧labelによりFAILする。

- [ ] **Step 4: CSSとsetting copyを実装する**

`styles.css`のlines sectionへ次の通常色ruleを追加する。

```css
.bullet-plugin-enhanced-vertical-line-hover
  .markdown-source-view.mod-cm6 {
  --indentation-guide-color: color-mix(
    in oklch,
    var(--text-normal) 20%,
    transparent
  );
}
```

innerとouterの全segment用enhanced ruleから`border-radius`を削除する。
それぞれのstart markerとend markerに対して、次のlogical radiusだけを適用する。

```css
border-start-start-radius: 2px;
border-start-end-radius: 2px;
```

```css
border-end-start-radius: 2px;
border-end-end-radius: 2px;
```

`SettingsTab.ts`の保存keyとgetter/setterは変えず、表示だけを次へ改める。

```ts
name: "Enhance vertical lines",
desc: "Strengthen indentation lines and use a continuous rounded hover.",
```

- [ ] **Step 5: focused testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: PASS。

### Task 3: Durable instructionと回帰検証

**Files:**

- Modify: `AGENTS.md`
- Verify: `src/features/__tests__/GuideFolding.test.ts`
- Verify: `src/features/__tests__/SettingsTab.test.ts`
- Verify: `vault/scroll-fold-regression-test.md`

**Interfaces:**

- Consumes: Task 1とTask 2のmarker、CSS、setting copy。
- Produces: 今後の変更が中間segment角丸や12%色へ戻らないための運用規則と検証記録。

- [ ] **Step 1: AGENTS.mdの縦線規則を更新する**

既存の「通常時の見た目を変更しない」という規則を、現行のユーザー要件へ合わせる。
enhanced設定が有効な間だけ通常色をtext-normal 20%へ上げ、幅と位置は変えないことを明記する。
hover groupは中間segmentを角丸にせず、先頭の上端と末尾の下端だけを丸め、endpoint markerをすべてのcleanup pathで除去すると記録する。

- [ ] **Step 2: lintとunit testを実行する**

Run:

```bash
n exec 22.23.1 npm run lint
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: すべてPASS。

- [ ] **Step 3: test buildとfull testを実行する**

`vault/test.md`をvault外へbackupし、LevelDB lock ownerを確認したうえで実行する。

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test
```

Expected: 全test suiteがPASS。
renderer終了後に`vault/test.md`をrestoreし、backupとのSHA-256一致を時間差で再確認する。

- [ ] **Step 4: 実Obsidianでcomputed styleを確認する**

repositoryの`vault`を使い、`scroll-fold-regression-test.md`を開く。
各UI action直前にtest vaultをfocusし、titleへ`vault`が含まれ`base`が含まれないことを確認する。

長いchild listのguideへpointerを置き、次を確認する。

- 通常時の`--indentation-guide-color`がtext-normal 20%である。
- hover中の全segmentが3pxとactive色を持つ。
- 最初のsegmentは上側2角だけ2pxである。
- 中間segmentの4角は0pxである。
- 最後のsegmentは下側2角だけ2pxである。
- 線のX中心がhover前後で変わらない。
- clickでfoldとunfoldがそれぞれ一度だけ反転する。
- pointer leave後にhover、start、end markerが0個になる。

darkとlightの両themeで通常線が背景から判別でき、hover線との差が残ることをscreenでも確認する。

- [ ] **Step 5: production buildを実行する**

Run:

```bash
n exec 22.23.1 npm run build
```

Expected: `dist/main.js`が生成され、commandが0で終了する。

- [ ] **Step 6: GitButler branchへcommitする**

`but diff`から今回のfileとhunk IDだけを選び、`codex/continuous-guide-hover`へConventional Commitでcommitする。

```text
fix(styles): render continuous guide hover

Why:
- Rounded corners on every native guide segment make long hovered lines look wavy.
- The default Obsidian guide color remains too faint against editor backgrounds.

What:
- Round only the visible logical group's outer endpoints.
- Strengthen normal guide color while preserving theme and active-state contrast.
```

# Symmetric Vertical Guide Stroke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** test vaultをtab文字と4 column幅へ固定し、3px hover縦線を通常の1px中心から左右へ1pxずつ広がる塗り面として描く。

**Architecture:** `jest/test-config.js`をtest vault app configのtrackedなsource of truthにし、global setupがfull test前に適用する。描画は既存のinnerとouter pseudo-elementを維持し、片側borderから3px background boxへ切り替える。

**Tech Stack:** JavaScript、TypeScript、CSS logical properties、Jest、Obsidian 1.13.2、ImageMagick。

## Global Constraints

- Accepted design: `docs/superpowers/specs/2026-07-21-symmetric-vertical-guide-stroke-design.md`。
- test vaultは`useTab: true`、`tabSize: 4`を使う。
- hover幅は3px、通常線中心から左右1pxずつ広げる。
- 通常線の1px幅と20%色、hoverのactive色、2px endpoint radiusを維持する。
- 追加DOM、独立overlay、座標cache、transition、box-shadow、outlineを追加しない。
- Git書き込みはGitButlerの`but`だけを使う。
- local verificationはNode.js 22.23.1以上を使う。

---

### Task 1: test vaultのtab設定

**Files:**

- Modify: `jest/test-config.js`
- Modify: `jest/global-setup.js`
- Modify: `src/__tests__/jestTestConfig.test.ts`
- Modify: `specs/features/EnterBehaviourOverride.spec.md`
- Modify: `specs/features/ListsMovementCommands.spec.md`
- Modify: `specs/features/DragAndDrop.spec.md`
- Modify: `specs/features/TabBehaviourOverride.spec.md`
- Modify locally: `vault/.obsidian/app.json`

**Interfaces:**

- Produces: `TEST_VAULT_APP_CONFIG` with `useTab: true` and `tabSize: 4`。
- Consumes: `prepareVault()`が既存vault configへこのobjectをspreadする。

- [ ] **Step 1: config contractの失敗testを書く**

`src/__tests__/jestTestConfig.test.ts`のimportへ`TEST_VAULT_APP_CONFIG`を追加し、次を検証する。

```ts
test("uses tabs with a four-column width in the test vault", () => {
  expect(TEST_VAULT_APP_CONFIG).toMatchObject({
    useTab: true,
    tabSize: 4,
  });
});
```

- [ ] **Step 2: focused testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/__tests__/jestTestConfig.test.ts --runInBand
```

Expected: `TEST_VAULT_APP_CONFIG`がexportされていないためFAILする。

- [ ] **Step 3: tracked configを実装する**

`jest/test-config.js`へ次を追加してexportする。

```js
const TEST_VAULT_APP_CONFIG = Object.freeze({
  foldHeading: true,
  foldIndent: true,
  useTab: true,
  tabSize: 4,
  legacyEditor: false,
});
```

`jest/global-setup.js`はこのconstantをimportし、`newVaultConfig`を次の形にする。

```js
const newVaultConfig = {
  ...vaultConfig,
  ...TEST_VAULT_APP_CONFIG,
};
```

ignoredの`vault/.obsidian/app.json`も`useTab: true`と`tabSize: 4`へ揃える。
indent操作後のintegration specは、test vaultが実際に生成するtab文字を期待し、spaceへ正規化しない。

- [ ] **Step 4: focused testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/__tests__/jestTestConfig.test.ts --runInBand
```

Expected: PASS。

### Task 2: 左右対称な3px塗り面

**Files:**

- Modify: `styles.css`
- Modify: `src/features/__tests__/GuideFolding.test.ts`

**Interfaces:**

- Consumes: innerの`.bullet-plugin-hovered-indent-guide::before`とouterの`.bullet-plugin-hovered-outer-list-guide::before`。
- Produces: native 1px中心と同じ中央columnを持つ3px background box。

- [ ] **Step 1: CSS contractの失敗testを書く**

inner enhanced ruleの期待値を次へ変更する。

```ts
expect(normalized).toBe(
  "inline-size: 3px; border-inline-end: 0; background-color: var(--indentation-guide-color-active);",
);
expect(livePreviewOffset?.replace(/\s+/g, " ").trim()).toBe(
  "margin-inline-start: var(--indentation-guide-editing-indent);",
);
expect(sourceModeOffset?.replace(/\s+/g, " ").trim()).toBe(
  "margin-inline-start: var(--indentation-guide-source-indent);",
);
```

outer enhanced ruleは次を期待する。

```ts
expect(normalizedEnhancedHovered).toBe(
  "inset-inline-end: -1px; inline-size: 3px; border-inline-end: 0; background-color: var(--indentation-guide-color-active);",
);
```

両ruleへ`box-shadow`、`outline`、`transition`がないことも検証する。

- [ ] **Step 2: focused testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: 現在は3px borderと`- 1px` marginを使うためFAILする。

- [ ] **Step 3: innerとouterのpaintを変更する**

innerとouterのenhanced hover ruleへ次を適用する。

```css
inline-size: 3px;
border-inline-end: 0;
background-color: var(--indentation-guide-color-active);
```

innerのmode別marginはnative variableだけへ戻す。

```css
margin-inline-start: var(--indentation-guide-editing-indent);
```

```css
margin-inline-start: var(--indentation-guide-source-indent);
```

outerのmobile基準`inset-inline-end: -1px`とdesktop `inset-inline-start: -1px`は維持する。

- [ ] **Step 4: focused testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: PASS。

### Task 3: durable instructionと実Obsidian検証

**Files:**

- Modify: `AGENTS.md`
- Verify: `vault/.obsidian/app.json`
- Verify: `styles.css`

**Interfaces:**

- Consumes: Task 1のtest configとTask 2の3px background box。
- Produces: 今後のtest agentがtab設定とpixel対称性を維持する運用契約。

- [ ] **Step 1: AGENTS.mdを更新する**

test vaultの`useTab: true`と`tabSize: 4`をfull testとmanual testの前提として記録する。
enhanced hoverは片側borderで太くせず、native中心へ3px background boxを置き、start capが中央1pxから始まることを縦線規則へ記録する。

- [ ] **Step 2: lintとunit testを実行する**

Run:

```bash
n exec 22.23.1 npm run lint
SKIP_OBSIDIAN=1 n exec 22.23.1 npm run test:unit
```

Expected: すべてPASS。

- [ ] **Step 3: test buildとfull testを実行する**

LevelDB lock ownerを確認し、`vault/test.md`をvault外へbackupしてから実行する。

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test
```

Expected: 全test suiteがPASS。
test renderer終了後にfixtureをrestoreし、SHA-256が時間差でbackupと一致することを確認する。

- [ ] **Step 4: 実Obsidianでpixelを確認する**

tab文字で4階層にしたtest noteをrepositoryの`vault`で開く。
各UI action前にtitleへ`vault`が含まれ`base`が含まれないこと、`app.vault.config`が`useTab: true`と`tabSize: 4`を持つことを確認する。

Live PreviewとSource modeの各深さで、通常1pxのcolumnを`C`としたときhoverが`C-1,C,C+1`を描くことをscreenshot pixelで検証する。
start capの最初のrowは`C`だけ、次のrowは`C-1,C,C+1`であることを確認する。
pointer leave後はhover markerとendpoint markerが0個になることも確認する。

- [ ] **Step 5: production buildを実行する**

Run:

```bash
n exec 22.23.1 npm run build
```

Expected: commandが0で終了する。

- [ ] **Step 6: GitButler branchへcommitする**

`but diff`で今回のfile IDだけを選び、`codex/centered-guide-stroke`へcommitする。

```text
fix(styles): center enhanced guide strokes

Why:
- Rounded endpoints rendered from a one-sided border bias their first painted row.
- The test vault did not preserve the requested tab indentation settings.

What:
- Paint enhanced guides as centered three-pixel fills.
- Persist tabs with a four-column width in the test vault setup.
```

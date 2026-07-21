# Desktop Native Chevron Scroll Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デスクトップ版 Live Preview の list と heading の native chevron を開閉しても、viewport 上端と操作行の Y 座標を固定する。

**Architecture:** 既存の mobile native fold transaction extender を `NativeFoldScroll` feature へ移し、desktop と mobile right controls の両方から使う。CodeMirror の native transaction へ補正済み `scrollSnapshot()` を追加し、CSS の browser anchoring や事後の `scrollTop` 補正は使わない。

**Tech Stack:** TypeScript、CodeMirror 6、Obsidian 1.13.2、Jest 30、Rollup、Node.js 22.23.1。

## Global Constraints

- Accepted design: `docs/superpowers/specs/2026-07-21-desktop-native-chevron-scroll-anchor-design.md`。
- Source と unit test は `n exec 22.23.1` で実行する。
- `src` の Jest を直接実行するときは `SKIP_OBSIDIAN=1` を付ける。
- native click、fold transaction、selection semantics は置き換えない。
- `preventDefault()`、`stopPropagation()`、手動 `scrollTop` 復元、遅延補正、overlay、座標 cache を追加しない。
- CodeMirror の `.cm-scroller { overflow-anchor: none; }` を上書きしない。
- Git の書き込みは `but` だけを使う。

---

### Task 1: Desktop native click の回帰 test

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`

**Interfaces:**

- Consumes: `MobileRightFoldControlsPluginValue` の capture listener と `MobileNativeFoldScroll.prepare(view)`。
- Produces: desktop document の list と heading が scroll reserve と snapshot 準備を通る failing contract。

- [ ] **Step 1: desktop document を表現できる test helper を追加する**

body class の fake は `is-mobile` と `bullet-plugin-mobile-right-fold-controls` を別々に表現する。

mobile setting 無効 test は `is-mobile` だけを持つ document とし、desktop と混同しない。

- [ ] **Step 2: list と heading の failing test を追加する**

次の二つの selector を table test にする。

```ts
[
  ["list", ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"],
  ["heading", ".HyperMD-header .cm-fold-indicator .collapse-indicator"],
]
```

desktop body で `pointerdown` 後に padding と `scrollHeight` read、`click` 後に `prepare(view)` を期待する。

- [ ] **Step 3: RED を確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand
```

Expected: desktop case が `paddingBottom` と `prepare` の未実行で FAIL する。

---

### Task 2: Native fold scroll feature の分離

**Files:**

- Create: `src/features/NativeFoldScroll.ts`
- Create: `src/features/__tests__/NativeFoldScroll.test.ts`
- Modify: `src/features/MobileRightFoldControls.ts`
- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `src/__tests__/ObsidianBulletPlugin.test.ts`

**Interfaces:**

- Consumes: `ensureFoldScrollReserve(view)` と `stableFoldScrollSnapshot(view)` from `src/features/FoldScroll.ts`。
- Produces: `NativeFoldScroll implements Feature`、`NativeFoldScrollState.extension`、`NativeFoldScrollPluginValue`。

- [ ] **Step 1: transaction state を移す**

`MobileNativeFoldScroll` の pending object、`WeakMap<EditorState, PendingFoldScrollSnapshot>`、transaction extender、`prepare()`、timeout expiry を `NativeFoldScrollState` へ名前を変えて移す。

fold effect、unfold effect、folded range の実内容変更という消費条件は変えない。

- [ ] **Step 2: desktop と mobile の activation rule を実装する**

`NativeFoldScrollPluginValue` は `contentDOM` の capture phase に `pointerdown` と `click` を登録する。

次の関数で event 時点の document を判定する。

```ts
function isNativeFoldScrollEnabled(document: Document): boolean {
  return (
    !document.body.classList.contains("is-mobile") ||
    document.body.classList.contains(
      "bullet-plugin-mobile-right-fold-controls",
    )
  );
}
```

対象 selector は list と heading の native `.collapse-indicator` だけに限定する。

- [ ] **Step 3: mobile feature を body class 管理へ戻す**

`MobileRightFoldControls.ts` から CodeMirror extension、ViewPlugin、pointer listener、transaction state を削除する。

`MobileRightFoldControls.load()` は setting callback と `DocumentBodyClass` だけを管理する。

- [ ] **Step 4: generic test を専用 file へ移す**

desktop list、desktop heading、mobile setting 有効、mobile setting 無効、対象外 element、fold、unfold、中間 selection、implicit unfold、timeout expiry、古い timeout の全 case を `NativeFoldScroll.test.ts` に置く。

test は mock の呼び出し自体ではなく、native fold transaction に snapshot effect が含まれる結果を確認する。

- [ ] **Step 5: plugin へ feature を登録する**

`ObsidianBulletPlugin.ts` で `new NativeFoldScroll(this)` を `MobileRightFoldControls` の直後に登録する。

plugin lifecycle test は feature の load と unload が既存 feature と同じ順序で実行されることを確認する。

- [ ] **Step 6: GREEN を確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest \
  src/features/__tests__/NativeFoldScroll.test.ts \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/__tests__/ObsidianBulletPlugin.test.ts \
  --runInBand
```

Expected: 対象 suite がすべて PASS する。

---

### Task 3: Durable instruction と local verification

**Files:**

- Modify: `AGENTS.md`
- Verify: all changed source, tests, specs, and plans
- Delete after verification: `vault/desktop-native-chevron-scroll-repro.md`

**Interfaces:**

- Consumes: desktop native chevron の one-snapshot transaction contract。
- Produces: 自動 test と実 Obsidian の検証記録、再発防止指示。

- [ ] **Step 1: AGENTS.md に desktop contract を追加する**

native chevron の scroll 保持対象は desktop の list と heading、mobile right controls 有効時の list と heading であることを記録する。

capture phase の pointer sequence、同じ transaction の snapshot、手動 `scrollTop` 補正禁止を明記する。

- [ ] **Step 2: source verification を実行する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build-with-tests
```

Expected: 全 command が exit 0。

- [ ] **Step 3: 実 Obsidian で desktop list と heading を測る**

test build を `vault/.obsidian/plugins/bullet/` へ配置し、`vault=vault` を明示して plugin を reload する。

972 行 fixture の list と heading を viewport 上端から 160px に置く。

cursor を fold 内へ置き、native mouse の `pointerdown`、`pointerup`、`click` sequence で fold と unfold を行う。

各 animation frame の操作行 Y、上側の表示行 Y、`scrollTop` を記録する。

Expected: list と heading の fold と unfold の全四操作で、各 span が 0px、fold 状態が一度だけ反転する。

- [ ] **Step 4: fixture と診断 state を片づける**

診断 listener を外し、`vault/desktop-native-chevron-scroll-repro.md` を `apply_patch` で削除する。

`test.md` を開き直し、test vault だけが操作対象だったことを確認する。

- [ ] **Step 5: full verification を実行する**

full test 前に test renderer lock と fixture backup の project rule を守る。

Run:

```bash
n exec 22.23.1 npm test -- --runInBand
n exec 22.23.1 npm run build
git diff --check
```

Expected: 全 test suite が PASS し、production build と diff check が exit 0。

---

### Task 4: GitButler commit と review

**Files:**

- Commit: changed tracked files only

**Interfaces:**

- Consumes: 全 verification evidence と actual diff。
- Produces: `codex/roam-scroll-anchor` 上の Conventional Commit と review 済み changeset。

- [ ] **Step 1: diff を review する**

`but diff` で task 外の変更がないことを確認する。

Critical または Important な review 指摘は commit 前に修正し、該当 verification を再実行する。

- [ ] **Step 2: commit する**

`but diff` が返した change ID だけを使う。

```text
fix(editor): stabilize desktop native fold scrolling

Why:
- CodeMirror disables browser scroll anchoring and desktop native chevrons did not attach the plugin's corrected viewport snapshot.
- Fold and unfold could therefore move the visible Y position under runtime-dependent anchor selection.

What:
- Apply the native fold scroll transaction contract to desktop list and heading chevrons.
- Separate cross-platform scroll preservation from mobile control styling.
- Cover desktop, mobile, selection, and timeout behavior with regression tests.
```

- [ ] **Step 3: committed state を確認する**

`but status` の返値で branch、commit、残っている uncommitted changes を確認する。

Expected: temporary fixture がなく、task の tracked changes が `codex/roam-scroll-anchor` にだけ入る。


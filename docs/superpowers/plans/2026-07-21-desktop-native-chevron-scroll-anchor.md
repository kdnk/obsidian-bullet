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

### Task 1: Desktop native fold scroll feature

**Files:**

- Create: `src/features/NativeFoldScroll.ts`
- Create: `src/features/__tests__/NativeFoldScroll.test.ts`
- Modify: `src/features/MobileRightFoldControls.ts`
- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `src/__tests__/ObsidianBulletPlugin.test.ts`

**Interfaces:**

- Consumes: `ensureFoldScrollReserve(view)` と `stableFoldScrollSnapshot(view)` from `src/features/FoldScroll.ts`。
- Produces: `NativeFoldScroll implements Feature`、`NativeFoldScrollState.extension`、`NativeFoldScrollPluginValue` と、その RED から GREEN までの regression test。

- [x] **Step 1: desktop document を表現できる test helper を追加する**

body class の fake は `is-mobile` と `bullet-plugin-mobile-right-fold-controls` を別々に表現する。

mobile setting 無効 test は `is-mobile` だけを持つ document とし、desktop と混同しない。

- [x] **Step 2: list と heading の failing test を追加する**

次の二つの selector を table test にする。

```ts
[
  ["list", ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"],
  ["heading", ".HyperMD-header .cm-fold-indicator .collapse-indicator"],
]
```

desktop body で `pointerdown` と `click` の各event後にpaddingと`scrollHeight` readを期待し、`click`では加えて`prepare(view)`を期待する。

- [x] **Step 3: RED を確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand
```

Expected: desktop case が `paddingBottom` と `prepare` の未実行で FAIL する。

- [x] **Step 4: transaction state を移す**

`MobileNativeFoldScroll` の pending object、`WeakMap<EditorState, PendingFoldScrollSnapshot>`、transaction extender、`prepare()`、timeout expiry を `NativeFoldScrollState` へ名前を変えて移す。

fold effect、unfold effect、folded range の実内容変更という消費条件は変えない。

- [x] **Step 5: desktop と mobile の activation rule を実装する**

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

- [x] **Step 6: mobile feature を body class 管理へ戻す**

`MobileRightFoldControls.ts` から CodeMirror extension、ViewPlugin、pointer listener、transaction state を削除する。

`MobileRightFoldControls.load()` は setting callback と `DocumentBodyClass` だけを管理する。

- [x] **Step 7: generic test を専用 file へ移す**

desktop list、desktop heading、mobile setting 有効、mobile setting 無効、対象外 element、fold、unfold、中間 selection、implicit unfold、timeout expiry、古い timeout の全 case を `NativeFoldScroll.test.ts` に置く。

test は mock の呼び出し自体ではなく、native fold transaction に snapshot effect が含まれる結果を確認する。

- [x] **Step 8: plugin へ feature を登録する**

`ObsidianBulletPlugin.ts` で `new NativeFoldScroll(this)` を `MobileRightFoldControls` の直後に登録する。

plugin lifecycle test は feature の load と unload が既存 feature と同じ順序で実行されることを確認する。

- [x] **Step 9: GREEN を確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest \
  src/features/__tests__/NativeFoldScroll.test.ts \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/__tests__/ObsidianBulletPlugin.test.ts \
  --runInBand
```

Expected: 対象 suite がすべて PASS する。

- [x] **Step 10: Task 1 を commit する**

`but diff` が返した source と test の change ID だけを使い、`codex/roam-scroll-anchor` へ次の message で commit する。

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

---

### Task 2: Durable instruction と local verification

**Files:**

- Modify: `AGENTS.md`
- Verify: all changed source, tests, specs, and plans
- Delete after verification: `vault/desktop-native-chevron-scroll-repro.md`

**Interfaces:**

- Consumes: desktop native chevron の one-snapshot transaction contract。
- Produces: 自動 test と実 Obsidian の検証記録、再発防止指示。

- [x] **Step 1: AGENTS.md に desktop contract を追加する**

native chevron の scroll 保持対象は desktop の list と heading、mobile right controls 有効時の list と heading であることを記録する。

capture phase の pointer sequence、同じ transaction の snapshot、手動 `scrollTop` 補正禁止を明記する。

- [x] **Step 2: source verification を実行する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build-with-tests
```

Expected: 全 command が exit 0。

- [x] **Step 3: 実 Obsidian で desktop list と heading を測る**

test build を `vault/.obsidian/plugins/bullet/` へ配置し、`vault=vault` を明示して plugin を reload する。

972 行 fixture の list と heading を viewport 上端から 160px に置く。

cursor を fold 内へ置き、native mouse の `pointerdown`、`pointerup`、`click` sequence で fold と unfold を行う。

各 animation frame の操作行 Y、上側の表示行 Y、`scrollTop` を記録する。

Expected: list と heading の fold と unfold の全四操作で、各 span が 0px、fold 状態が一度だけ反転する。

- [x] **Step 4: fixture と診断 state を片づける**

診断 listener を外し、`vault/desktop-native-chevron-scroll-repro.md` を `apply_patch` で削除する。

`test.md` を開き直し、test vault だけが操作対象だったことを確認する。

- [x] **Step 5: full verification を実行する**

full test 前に test renderer lock と fixture backup の project rule を守る。

Run:

```bash
n exec 22.23.1 npm test -- --runInBand
n exec 22.23.1 npm run build
git diff --check
```

Expected: 全 test suite が PASS し、production build と diff check が exit 0。

Verification evidence（2026-07-21）：

- Node.js 22.23.1 の unit test は 55 suites、651 tests が PASS し、lint、`tsc --noEmit`、test build も exit 0 だった。
- 実 Obsidian 1.13.2 の 972 行 fixture では、list と heading の fold と unfold の全四操作で native trusted `pointerdown` → `pointerup` → `click` を観測し、操作行、上側表示行、`scrollTop` の各 span が 0px、fold state の反転が一回だった。
- full test は test build を再生成した最終実行で 75 suites、798 tests が PASS し、15 tests が skipped だった。
- `vault/test.md` は renderer 終了後に 4,588 bytes、SHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`へ復元し、production build と `git diff --check` は exit 0 だった。

- [x] **Step 6: Task 2 を commit する**

`but diff` が返した `AGENTS.md` と verification evidence を追記した spec と plan の change ID だけを使い、`codex/roam-scroll-anchor` へ次の message で commit する。

```text
docs(editor): record native fold scroll safeguards

Why:
- Desktop and mobile native controls now share transaction timing constraints that future UI changes must preserve.

What:
- Document the desktop activation rule and same-transaction snapshot invariant.
- Record the completed automated and real-Obsidian verification evidence.
```

---

### Task 3: GitButler review

**Files:**

- Commit: changed tracked files only

**Interfaces:**

- Consumes: 全 verification evidence と actual diff。
- Produces: `codex/roam-scroll-anchor` 上の review 済み changeset。

- [ ] **Step 1: diff を review する**

`but diff` で task 外の変更がないことを確認する。

Critical または Important な review 指摘は commit 前に修正し、該当 verification を再実行する。

- [ ] **Step 2: committed state を確認する**

`but status` の返値で branch、commit、残っている uncommitted changes を確認する。

Expected: temporary fixture がなく、task の tracked changes が `codex/roam-scroll-anchor` にだけ入る。

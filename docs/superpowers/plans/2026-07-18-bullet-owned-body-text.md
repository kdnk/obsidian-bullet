# Bullet-Owned Body Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通常の直接入力をバレット項目へ所属させながら、Markdown構造、paste、Vim selection、IMEを維持する。

**Architecture:** `BulletTypingPolicy`をtransaction補正の深いmoduleとし、元のtransactionをpass、correct、rejectのいずれかへ分類する。`BulletTypingGuard`はCodeMirrorとのadapterだけを担当し、correct時には元のtransactionへsequentialな補正を連結する。EnterとBackspaceの意味的なリスト操作は既存operation pathへ置き、文字入力と任意のVim削除はtransaction pathで保護する。

**Tech Stack:** TypeScript 5.9、CodeMirror 6.5、Obsidian 1.12.7以降、Jest 30、Markdown semantic spec harness、Node.js 22.23.1。

## Global Constraints

- 設計の基準は`docs/superpowers/specs/2026-07-18-bullet-owned-body-text-design.md`とする。
- Live Previewとは別のeditor modeを追加しない。
- 新設定`keepBodyTextInBullets`の初期値は`false`とする。
- paste、drop、completion、undo、redo、remote、user eventを持たない変更を補正しない。
- 直接変更された物理行だけを補正し、文書全体のvalidatorにはしない。
- 通常入力と補正を一つのundo history eventへまとめる。
- Vimのselection anchor、head、方向、main selectionを独自に変更しない。
- Shift+Enterのリスト継続行を維持する。
- rootの空バレットでEnterを押した場合は、現在項目を残して新しいroot itemを作る。
- nestedの空バレットでEnterを押した場合は、subtreeごと一段アウトデントする。
- 空のleaf itemでBackspaceを押した場合は、indentの深さにかかわらず行全体を削除する。
- Node.js 22系のlocal verificationには`n exec 22.23.1`を使う。
- unit testを直接実行するときは`SKIP_OBSIDIAN=1`を付ける。
- `.spec.md`を実行する前に`npm run build-with-tests`を実行する。
- version controlの書き込みには`but`だけを使い、branchは`codex/bullet-owned-body-text`を使う。

---

### Task 1: 設定値と設定画面

**Files:**

- Modify: `src/services/Settings.ts`
- Modify: `src/services/__tests__/Settings.test.ts`
- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/__mocks__.ts`
- Modify: `src/ObsidianBulletPluginWithTests.ts`
- Modify: `src/__tests__/ObsidianBulletPluginWithTests.test.ts`

**Interfaces:**

- Produces: `SettingsObject.keepBodyTextInBullets: boolean`
- Produces: `Settings.keepBodyTextInBullets` getter and setter
- Produces: settings control key `keepBodyTextInBullets`
- Preserves: every existing persisted setting key and default

- [ ] **Step 1: 初期値と通知のfailing testを書く**

`src/services/__tests__/Settings.test.ts`へ、保存dataに新keyがない場合の初期値と変更通知を追加する。

```ts
test("keeps body text enforcement disabled for saved data predating the setting", async () => {
  const settings = new Settings({
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  });

  await settings.load();

  expect(settings.keepBodyTextInBullets).toBe(false);
});

test("notifies subscribers when body text enforcement changes", async () => {
  const settings = new Settings({
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  });
  const callback = jest.fn<void, [SettingsChange]>();
  settings.onChange(["keepBodyTextInBullets"], callback);

  settings.keepBodyTextInBullets = true;

  expect(callback.mock.calls[0]?.[0].keys).toEqual(
    new Set(["keepBodyTextInBullets"]),
  );
});
```

- [ ] **Step 2: 設定画面のfailing testを書く**

`src/features/__tests__/SettingsTab.test.ts`のEditing group期待値へ`Keep body text in bullets`を追加し、値の読み書きを検証する。

```ts
expect(groups[0]?.items[1]).toMatchObject({
  name: "Keep body text in bullets",
  control: { type: "toggle", key: "keepBodyTextInBullets" },
});

await tab.setControlValue("keepBodyTextInBullets", true);
expect(settings.keepBodyTextInBullets).toBe(true);
```

旧設定画面の期待順序も、cursor設定の直後に新toggleを置く形へ更新する。

- [ ] **Step 3: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/Settings.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: `keepBodyTextInBullets`が未定義でFAILする。

- [ ] **Step 4: 設定modelとUIを実装する**

`SettingsObject`と`DEFAULT_SETTINGS`へkeyを追加し、`Settings`へ次のaccessorを追加する。

```ts
get keepBodyTextInBullets() {
  return this.values.keepBodyTextInBullets;
}

set keepBodyTextInBullets(value: boolean) {
  this.update({ keepBodyTextInBullets: value });
}
```

Editing groupのcursor設定直後へ次の定義を追加する。

```ts
{
  name: "Keep body text in bullets",
  desc: "Automatically keep directly typed body text in list items while allowing headings, quotes, horizontal rules, code fences, and frontmatter. Pasted and external changes are left unchanged.",
  control: {
    type: "toggle",
    key: "keepBodyTextInBullets",
  },
},
```

`getControlValue()`、`setControlValue()`、test settings factory、`settingCommandDecoders`へ同じkeyを追加する。

`src/__mocks__.ts`の`makeSettings()`では`keepBodyTextInBullets: false`を明示する。

- [ ] **Step 5: 対象testと型検査をGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/Settings.test.ts src/features/__tests__/SettingsTab.test.ts src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand
n exec 22.23.1 npx tsc --noEmit
```

Expected: 対象suiteと型検査がPASSする。

- [ ] **Step 6: 設定変更をcommitする**

`but diff`でこのTaskのFilesに挙げたfile IDだけを選び、branch `codex/bullet-owned-body-text`へ次のmessageでcommitする。

```text
feat(settings): add bullet-owned body text option

Why:
- Restrictive outline editing must remain opt-in for existing users.
- The transaction policy needs one persisted source of truth.

What:
- Add the disabled-by-default setting and Editing control.
- Extend settings migration, notification, and test-harness decoding.
```

### Task 2: Markdown行分類module

**Files:**

- Create: `src/services/MarkdownLineClassifier.ts`
- Create: `src/services/__tests__/MarkdownLineClassifier.test.ts`

**Interfaces:**

- Produces: `MarkdownLineKind`
- Produces: `MarkdownLineInspection`
- Produces: `MarkdownLineClassifier.inspect(doc: Text, lineNumber: number): MarkdownLineInspection`
- Consumes: CodeMirror `Text`

- [ ] **Step 1: 行分類のfailing testを書く**

次のhelperで文書と1-originの行番号をclassifierへ渡す。

```ts
function inspect(source: string, lineNumber: number) {
  const classifier = new MarkdownLineClassifier();
  return classifier.inspect(Text.of(source.split("\n")), lineNumber);
}
```

最低限、次のcaseをtable testへ含める。

```ts
test.each([
  ["", 1, "blank"],
  ["plain", 1, "body"],
  ["- item", 1, "list-item"],
  ["1. item", 1, "list-item"],
  ["- item\n  continuation", 2, "list-continuation"],
  ["# heading", 1, "structure"],
  ["> quote", 1, "structure"],
  ["---", 1, "structure"],
  ["`", 1, "structure-prefix"],
  ["``", 1, "structure-prefix"],
  ["--", 1, "structure-prefix"],
])("classifies %p line %i as %s", (source, lineNumber, kind) => {
  expect(inspect(source, lineNumber).kind).toBe(kind);
});
```

frontmatter内、fenced code内、閉じdelimiter後の本文、indentがあるだけで親listを持たない本文も追加する。

setext見出し、table、HTML block、indented codeは初期実装の許可構造に含めず、`body`として分類するcaseを追加する。

- [ ] **Step 2: list metadataのfailing testを書く**

rootの空バレット、nestedの空バレット、空task、子項目付き空バレットを区別する。

```ts
expect(inspect("- ", 1).listItem).toMatchObject({
  prefix: "- ",
  isRoot: true,
  isPlainEmpty: true,
  hasOwnedFollowingLine: false,
});

expect(inspect("- parent\n  - \n    - child", 2).listItem).toMatchObject({
  isRoot: false,
  isPlainEmpty: true,
  hasOwnedFollowingLine: true,
});
```

- [ ] **Step 3: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/MarkdownLineClassifier.test.ts --runInBand
```

Expected: moduleが存在しないためFAILする。

- [ ] **Step 4: inspection interfaceとlexical classifierを実装する**

interfaceは次の形に固定する。

```ts
export type MarkdownLineKind =
  | "blank"
  | "list-item"
  | "list-continuation"
  | "structure"
  | "structure-prefix"
  | "body";

export interface ListLineInspection {
  prefix: string;
  // Physical line startから数えたrelative offset。
  contentStart: number;
  isRoot: boolean;
  isPlainEmpty: boolean;
  hasOwnedFollowingLine: boolean;
}

export interface MarkdownLineInspection {
  kind: MarkdownLineKind;
  from: number;
  to: number;
  text: string;
  listItem: ListLineInspection | null;
}
```

構造判定は次のregexを起点にし、frontmatterとfenceだけは文書先頭から対象行までdelimiter状態を走査する。

一行だけで競合する場合は、frontmatterまたはfence内、水平線、ATX見出し、引用、list item、構造prefix、本文の順に判定する。

```ts
const listItemRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(.*)$/;
const atxHeadingRe = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const quoteRe = /^ {0,3}>/;
const horizontalRuleRe = /^ {0,3}(?:-[ \t]*){3,}$/;
const fenceRe = /^ {0,3}(`{3,})(?:[^`]*)$/;
const structurePrefixRe = /^(?:#{1,6}|`{1,2}|-{1,2})$/;
```

継続行は、現在行にindentがあり、空行または構造行で分断される前に、現在行より浅いlist itemが見つかる場合だけ`list-continuation`とする。

`hasOwnedFollowingLine`は直後の行から同じitemへ所属する継続行またはより深いlist itemが続くかを返す。

- [ ] **Step 5: classifier testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/MarkdownLineClassifier.test.ts --runInBand
```

Expected: すべてPASSする。

- [ ] **Step 6: classifierをcommitする**

`but diff`で二つの新規file IDだけを選び、次のmessageでcommitする。

```text
feat(editor): classify outline-owned markdown lines

Why:
- Typed text can only be corrected safely after distinguishing body text from valid Markdown structure.
- Structural and list ownership rules must stay local to one deterministic module.

What:
- Classify list items, continuations, structural blocks, provisional prefixes, and body text.
- Expose root, emptiness, and descendant metadata for transaction decisions.
```

### Task 3: 直接入力と構造prefixのtransaction policy

**Files:**

- Create: `src/services/BulletTypingPolicy.ts`
- Create: `src/services/__tests__/BulletTypingPolicy.test.ts`
- Modify: `src/services/MarkdownLineClassifier.ts`
- Modify: `src/services/__tests__/MarkdownLineClassifier.test.ts`

**Interfaces:**

- Consumes: `MarkdownLineClassifier.inspect()`
- Consumes: `Logger`
- Produces: `BulletTypingDecision`
- Produces: `BulletTypingPolicy.decide(transaction: Transaction): BulletTypingDecision`

- [ ] **Step 1: transaction test helperと除外eventのfailing testを書く**

test helperは実際の`EditorState.update()`でtransactionを作る。

```ts
function makeTransaction(doc: string, changes: ChangeSpec, userEvent?: string) {
  const state = EditorState.create({ doc });
  return state.update({ changes, userEvent });
}

function applyCorrection(tr: Transaction, decision: BulletTypingDecision) {
  if (decision.kind !== "correct") return tr.newDoc.toString();
  return EditorState.create({ doc: tr.newDoc })
    .update({ changes: decision.changes })
    .newDoc.toString();
}
```

`input.paste`、`input.drop`、`move.drop`、`input.complete`、`undo`、`redo`、`Transaction.remote`、user eventなし、selection-onlyが`pass`になることを検証する。

`input.type.compose`のような詳細eventが`transaction.isUserEvent("input.type")`で対象になるcaseも追加する。

- [ ] **Step 2: 通常入力補正のfailing testを書く**

```ts
test("prefixes directly typed body text on a blank line", () => {
  const tr = makeTransaction("", { from: 0, insert: "a" }, "input.type");

  const decision = policy.decide(tr);

  expect(applyCorrection(tr, decision)).toBe("- a");
});

test("prefixes only an edited plain-text line", () => {
  const tr = makeTransaction(
    "pasted\nuntouched",
    { from: 6, insert: "!" },
    "input.type",
  );

  expect(applyCorrection(tr, policy.decide(tr))).toBe("- pasted!\nuntouched");
});
```

ATX見出し、引用、水平線、fenced code、frontmatter、list continuationへ入力しても`pass`になるcaseを追加する。

- [ ] **Step 3: root空バレット変換のfailing testを書く**

`#`、`>`、backtick、`-`を別々に検証する。

```ts
test.each(["#", ">", "`", "-"])(
  "promotes %s from an empty root item",
  (insert) => {
    const tr = makeTransaction("- ", { from: 2, insert }, "input.type");

    expect(applyCorrection(tr, policy.decide(tr))).toBe(insert);
  },
);
```

nested item、task item、子項目付きitem、複数selectionでは変換しないcaseも追加する。

`#`の次に`text`を入力して`#text`になったtransactionは`- #text`へ補正し、`# heading`は構造行として通す。

- [ ] **Step 4: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: policy moduleが存在しないためFAILする。

- [ ] **Step 5: decision interfaceとtyping policyを実装する**

interfaceは設計どおり次の形にする。

```ts
export type BulletTypingDecision =
  | { kind: "pass" }
  | { kind: "correct"; changes: readonly ChangeSpec[] }
  | { kind: "reject" };

export class BulletTypingPolicy {
  constructor(
    private classifier: MarkdownLineClassifier,
    private logger: Logger,
  ) {}

  decide(transaction: Transaction): BulletTypingDecision {
    try {
      return this.decideSafely(transaction);
    } catch (error) {
      this.logger.log("bulletTypingPolicy", error);
      return { kind: "pass" };
    }
  }
}
```

`transaction.changes.iterChangedRanges()`で変更後文書の対象行番号を集め、重複を除く。

`transaction.isUserEvent("input.type")`またはTask 4で列挙する四つのdelete eventに一致しないtransactionと、設計で除外したtransactionは最初に`pass`する。

user event annotationの文字列を直接比較せず、composition系subtypeも含める。

通常本文になった変更行には、その行の`from`へ`- `を挿入するcorrectionを返す。

構造変換は、変更前inspectionがrootのplain empty itemであり、単一cursorから一つのtriggerを入力した場合だけ、変更後行の先頭から元のprefix長までを削除する。

複数correctionは`from`昇順で重複がないことを検証して返す。

- [ ] **Step 6: typing policy testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/MarkdownLineClassifier.test.ts src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: すべてPASSする。

- [ ] **Step 7: typing policyをcommitする**

`but diff`でこのTaskの四file IDだけを選び、次のmessageでcommitする。

```text
feat(editor): correct directly typed body text

Why:
- Ordinary typing should stay in outline items without validating or rewriting the whole note.
- Markdown structures need an intentional escape from an empty root item.

What:
- Add pass, correction, and rejection decisions for typed transactions.
- Prefix changed body lines and promote supported root structural prefixes.
```

### Task 4: 削除transactionのprefix保護

**Files:**

- Modify: `src/services/BulletTypingPolicy.ts`
- Modify: `src/services/__tests__/BulletTypingPolicy.test.ts`

**Interfaces:**

- Extends: `BulletTypingPolicy.decide()` for `delete.backward`, `delete.forward`, `delete.selection`, and `delete.cut`
- Preserves: `BulletTypingDecision`

- [ ] **Step 1: marker部分削除のfailing testを書く**

`- item`のmarker、space、markerから本文の途中までを削除するcaseを作る。

```ts
test("preserves a list prefix when a partial deletion crosses it", () => {
  const tr = makeTransaction("- item", { from: 0, to: 4 }, "delete.selection");

  expect(applyCorrection(tr, policy.decide(tr))).toBe("- em");
});
```

`* `、`+ `、`10. `も元のprefixを維持するtable testへ含める。

- [ ] **Step 2: 行全体削除と空leaf削除のfailing testを書く**

```ts
test("allows deleting an entire list line", () => {
  const tr = makeTransaction(
    "- one\n- two",
    { from: 0, to: 6 },
    "delete.selection",
  );

  expect(policy.decide(tr)).toEqual({ kind: "pass" });
});

test("removes an isolated empty root item instead of leaving a raw marker", () => {
  const tr = makeTransaction("- ", { from: 1, to: 2 }, "delete.backward");

  expect(applyCorrection(tr, policy.decide(tr))).toBe("");
});
```

文書先頭、中間、末尾の空leaf item、nested空leaf item、子項目付き空itemを分けて検証する。

- [ ] **Step 3: selection mapping用のfailing testを書く**

変更前のcontent startを`tr.changes.mapPos()`で変更後へ写し、同じ物理行へ残るcaseだけを安全に補正することをtestする。

複数rangeが同じprefixへ競合するcaseは`reject`になることを確認する。

- [ ] **Step 4: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: delete transactionが`pass`してFAILする。

- [ ] **Step 5: deletion decisionを実装する**

変更前のlist prefixが部分的に壊された場合は、元のcontent startを変更後文書へmapし、変更後行の先頭からmapped content startまでを元prefixで置き換える。

```ts
const mappedContentStart = transaction.changes.mapPos(
  before.from + before.listItem.contentStart,
  1,
);
```

old lineとmapped content startが同じsurviving lineへ対応しない場合は、行全体削除なら`pass`し、それ以外は`reject`する。

空leaf itemのBackspaceでは、変更後に残ったmarkerと隣接newlineを一つのcorrectionで削除する。

前方Deleteで次itemを結合した結果が有効なlist itemなら、そのtransactionをそのまま通す。

- [ ] **Step 6: deletion policy testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: すべてPASSする。

- [ ] **Step 7: deletion policyをcommitする**

`but diff`でpolicyとtestのfile IDだけを選び、次のmessageでcommitする。

```text
feat(editor): preserve bullets across deletion transactions

Why:
- Vim and native selection deletes can bypass individual key bindings.
- Removing only a Markdown marker must not leave body text outside the outline.

What:
- Restore partially damaged list prefixes without changing selections.
- Allow whole-item deletion and remove empty leaf rows atomically.
```

### Task 5: CodeMirror feature adapter

**Files:**

- Create: `src/features/BulletTypingGuard.ts`
- Create: `src/features/__tests__/BulletTypingGuard.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `src/__tests__/ObsidianBulletPlugin.test.ts`

**Interfaces:**

- Consumes: `Settings.keepBodyTextInBullets`
- Consumes: `BulletTypingPolicy.decide()`
- Produces: `BulletTypingGuard implements Feature`
- Registers: `EditorState.transactionFilter`

- [ ] **Step 1: adapterのfailing testを書く**

plugin mockから登録extensionを受け取り、実`EditorState`へ組み込む。

次を検証する。

- setting無効時は`input.type`を変更しない。
- setting有効時は`a`が`- a`になる。
- correction後のcursorが`- a|`へmapされる。
- reverse selectionとmain selectionを維持する。
- 元変更とcorrectionが一つの`Transaction`を構成する。
- `reject`では元のdocument changeを適用しない。
- `keepCursorWithinContent`の値を変えても、同じtransactionに対する文書結果は変わらない。

- [ ] **Step 2: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BulletTypingGuard.test.ts --runInBand
```

Expected: featureが存在しないためFAILする。

- [ ] **Step 3: transaction filter adapterを実装する**

```ts
private filterTransaction = (transaction: Transaction) => {
  if (!this.settings.keepBodyTextInBullets) {
    return transaction;
  }

  const decision = this.policy.decide(transaction);
  if (decision.kind === "pass") {
    return transaction;
  }
  if (decision.kind === "reject") {
    return { selection: transaction.startState.selection };
  }
  return [
    transaction,
    {
      changes: decision.changes,
      sequential: true,
    },
  ];
};
```

`load()`では`EditorState.transactionFilter.of(this.filterTransaction)`を一度だけ登録する。

`BulletTypingPolicy`へ`MarkdownLineClassifier`と既存`Logger`を渡す。

- [ ] **Step 4: production pluginへwireする**

`ObsidianBulletPlugin`のgeneral featuresへ`BulletTypingGuard`を追加する。

selection featureより前へ置くが、selection transaction自体はpolicyが`pass`する。

plugin testではfeature数の固定値ではなく、instanceまたはconstructor wiringを検証する既存patternに合わせる。

- [ ] **Step 5: adapter testと関連plugin testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BulletTypingGuard.test.ts src/__tests__/ObsidianBulletPlugin.test.ts --runInBand
```

Expected: すべてPASSする。

- [ ] **Step 6: adapterをcommitする**

`but diff`でこのTaskの四file IDだけを選び、次のmessageでcommitする。

```text
feat(editor): apply bullet typing corrections atomically

Why:
- Policy corrections must preserve CodeMirror selection, effects, annotations, and history semantics.
- The feature should remain dormant until its setting is enabled.

What:
- Register a small transaction-filter adapter around the policy.
- Apply corrections sequentially in the originating transaction.
```

### Task 6: 空バレットのEnter規則

**Files:**

- Create: `src/operations/CreateNewRootItemAfterEmpty.ts`
- Create: `src/operations/__tests__/CreateNewRootItemAfterEmpty.test.ts`
- Modify: `src/features/EnterBehaviourOverride.ts`
- Modify: `src/features/__tests__/EnterBehaviourOverride.test.ts`
- Modify: `specs/features/EnterBehaviourOverride.spec.md`

**Interfaces:**

- Consumes: `Settings.keepBodyTextInBullets`
- Produces: `CreateNewRootItemAfterEmpty implements Operation`
- Changes: Enter feature activates when either `overrideEnterBehaviour` or `keepBodyTextInBullets` is enabled

- [ ] **Step 1: root空item operationのfailing testを書く**

plain bullet、unordered marker variation、ordered marker、empty checkbox、subtree付きroot itemを含める。

```ts
test("keeps an empty root item and creates a sibling below its subtree", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- \n  - child\n- after",
      cursor: { line: 0, ch: 2 },
    }),
  });

  const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

  expect(outcome).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- \n  - child\n- \n- after");
  expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
});
```

non-empty、nested、multiline、複数selectionでは`NO_OP_OUTCOME`になるtestを追加する。

- [ ] **Step 2: feature設定matrixのfailing testを書く**

次の四組をtable testにする。

```ts
test.each([
  [false, false, false],
  [true, false, true],
  [false, true, true],
  [true, true, true],
])(
  "runs Enter override when betterEnter=%s and keepBodyTextInBullets=%s",
  (betterEnter, keepBodyTextInBullets, expected) => {
    const feature = makeFeature({
      overrideEnterBehaviour: betterEnter,
      keepBodyTextInBullets,
    });
    const check = (feature as unknown as { check: () => boolean }).check;

    expect(check()).toBe(expected);
  },
);
```

`makeFeature`は既存mockを再利用し、指定した二設定だけを上書きして`EnterBehaviourOverride`を返すtest helperとして同fileへ実装する。

root空itemでは新operation、nested空itemでは既存`OutdentListIfItsEmpty`、通常itemでは既存`CreateNewItem`が選ばれることを確認する。

- [ ] **Step 3: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/operations/__tests__/CreateNewRootItemAfterEmpty.test.ts src/features/__tests__/EnterBehaviourOverride.test.ts --runInBand
```

Expected: 新operationと設定分岐がないためFAILする。

- [ ] **Step 4: root sibling operationを実装する**

operationは単一selection、単一content line、root level、`isEmptyLineOrEmptyCheckbox()`をguardする。

現在itemと同じbullet、space、checkbox種別から新しい`List`を作り、`list.getParentOrThrow().addAfter(list, sibling)`でsubtreeの後へ置く。

番号付きlistでは`recalculateNumericBullets()`を呼ぶ。

cursorは新itemのcheckbox後へ置く。

- [ ] **Step 5: Enter featureへ設定分岐を加える**

```ts
private check = () => {
  return (
    (this.settings.overrideEnterBehaviour ||
      this.settings.keepBodyTextInBullets) &&
    !this.imeDetector.isOpened()
  );
};
```

新設定が有効でroot itemが空なら`CreateNewRootItemAfterEmpty`を返す。

nested空itemの`OutdentListIfItsEmpty`分岐は先行条件を維持する。

Shift+Enterも同じcheckを使い、継続行を残す。

- [ ] **Step 6: unit testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/operations/__tests__/CreateNewRootItemAfterEmpty.test.ts src/features/__tests__/EnterBehaviourOverride.test.ts --runInBand
```

Expected: すべてPASSする。

- [ ] **Step 7: semantic specへrootとnestedの期待値を追加する**

`keepBodyTextInBullets=true`でroot空itemのEnterが空itemを二つにし、nested空itemのEnterが一段アウトデントするcaseを追加する。

この時点ではspecを実行せず、Task 9のbuild後に実行する。

- [ ] **Step 8: Enter規則をcommitする**

`but diff`でこのTaskの五file IDだけを選び、次のmessageでcommitする。

```text
feat(editor): preserve root items on empty Enter

Why:
- Root and nested empty items have distinct outliner semantics.
- Enforced body ownership cannot fall back to Obsidian's list-exit behavior.

What:
- Create a root sibling while retaining the current empty item.
- Keep nested empty Enter as a subtree outdent and preserve Shift-Enter notes.
```

### Task 7: 空leaf itemのBackspace規則

**Files:**

- Modify: `src/operations/DeleteTillPreviousLineContentEnd.ts`
- Modify: `src/operations/__tests__/DeleteTillPreviousLineContentEnd.test.ts`
- Modify: `src/features/BackspaceBehaviourOverride.ts`
- Create: `src/features/__tests__/BackspaceBehaviourOverride.test.ts`
- Modify: `specs/features/BackspaceBehaviourOverride.spec.md`

**Interfaces:**

- Changes: `DeleteTillPreviousLineContentEnd` accepts `removeEmptyLeafItem: boolean`
- Consumes: `Settings.keepBodyTextInBullets`
- Preserves: forward Delete behavior

- [ ] **Step 1: rootとnested削除のfailing operation testを書く**

```ts
test("removes the only empty root item when enforcement is enabled", () => {
  const root = makeRoot({
    editor: makeEditor({ text: "- ", cursor: { line: 0, ch: 2 } }),
  });

  const outcome = new DeleteTillPreviousLineContentEnd(
    root,
    true,
    true,
  ).perform();

  expect(outcome).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("");
  expect(root.getCursor()).toEqual({ line: 0, ch: 0 });
});
```

first root with next item、middle item、last item、nested item、empty checkboxを追加する。

子項目付き空item、継続行付きitem、新設定無効では既存挙動を維持するtestを追加する。

- [ ] **Step 2: Backspace featureのfailing testを書く**

`keepCursorWithinContent="never"`でも`keepBodyTextInBullets=true`ならBackspace overrideが有効になり、empty leaf removal flagを渡すことを確認する。

`EnterBehaviourOverride`と同様にfeatureの`check`を取り出し、設定matrixを直接検証する。

```ts
const check = (feature as unknown as { check: () => boolean }).check;

expect(check()).toBe(true);
```

- [ ] **Step 3: 対象testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/operations/__tests__/DeleteTillPreviousLineContentEnd.test.ts src/features/__tests__/BackspaceBehaviourOverride.test.ts --runInBand
```

Expected: constructor flagとroot removalがないためFAILする。

- [ ] **Step 4: operationへ空leaf削除を実装する**

content startでBackspaceが発生し、次をすべて満たす場合だけitemをparentから除く。

```ts
const removable =
  this.removeEmptyLeafItem &&
  lines.length === 1 &&
  isEmptyLineOrEmptyCheckbox(lines[0].text) &&
  list.isEmpty();
```

削除前に前の表示listと次の表示listを取得する。

削除後は前listの本文末尾、前がなければ次listの本文先頭、どちらもなければroot開始位置へcursorを置く。

番号付きlistを再計算する。

- [ ] **Step 5: Backspace featureのcheckとflagを更新する**

featureはcursor設定または新設定のどちらかが有効なら動作し、operationへ新設定値を渡す。

```ts
return (
  (this.settings.keepCursorWithinContent !== "never" ||
    this.settings.keepBodyTextInBullets) &&
  !this.imeDetector.isOpened()
);
```

- [ ] **Step 6: unit testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/operations/__tests__/DeleteTillPreviousLineContentEnd.test.ts src/operations/__tests__/DeleteTillNextLineContentStart.test.ts --runInBand
```

Expected: Backspaceと既存forward DeleteのsuiteがPASSする。

- [ ] **Step 7: semantic specを更新する**

新設定有効時に、only root、nested、middle rootの空itemが行ごと消えるcaseを追加する。

既存の「last empty lineではregular Backspace」とするcaseは新設定無効の回帰testとして残す。

- [ ] **Step 8: Backspace規則をcommitする**

`but diff`でこのTaskのfile IDだけを選び、次のmessageでcommitする。

```text
feat(editor): remove empty outline items on Backspace

Why:
- Deleting an empty item must remove the block instead of exposing a raw Markdown marker.
- The behavior must not depend on cursor-prefix ergonomics.

What:
- Remove empty leaf rows at every indentation depth.
- Preserve descendants, forward Delete merging, and the legacy disabled path.
```

### Task 8: semantic input harnessと統合spec

**Files:**

- Modify: `src/ObsidianBulletPluginWithTests.ts`
- Modify: `src/__tests__/ObsidianBulletPluginWithTests.test.ts`
- Create: `specs/features/BulletTypingGuard.spec.md`
- Modify: `specs/features/EnterBehaviourOverride.spec.md`
- Modify: `specs/features/BackspaceBehaviourOverride.spec.md`

**Interfaces:**

- Produces: semantic command `typeText`
- Produces: semantic command `pasteText`
- Preserves: existing `insertText` as an unannotated programmatic edit

- [ ] **Step 1: command decoderのfailing testを書く**

`typeText`と`pasteText`がstringだけを受け入れ、不正dataを拒否することを既存decoder testへ追加する。

- [ ] **Step 2: annotated input commandを実装する**

現在のmain selectionを置換し、cursorを挿入末尾へ置く一つのtransactionをdispatchする。

```ts
private dispatchText(text: string, userEvent: "input.type" | "input.paste") {
  const view = this.editor.getCodeMirrorView();
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    userEvent,
  });
}
```

`typeText`は`input.type`、`pasteText`は`input.paste`を渡す。

既存`insertText`はuser eventなしの外部変更を検証するため変更しない。

- [ ] **Step 3: body入力specを書く**

`specs/features/BulletTypingGuard.spec.md`へ次を記述する。

- 空文書で`typeText: "a"`を実行すると`- a|`になる。
- 通常入力とcorrectionは`editor:undo`一回で空文書へ戻る。
- 非バレット本文の一行を編集すると、その行だけに`- `が付く。
- `pasteText`と`insertText`では`- `が付かない。
- `keepCursorWithinContent`が`never`でも`always`でも、通常入力の文書結果は同じになる。
- list continuationへの入力は新しいbulletを作らない。
- markerの部分削除後も本文がbulletへ所属する。
- 行全体を選択した削除はitemを復元しない。

- [ ] **Step 4: 構造prefix specを書く**

root空itemから`#`、`>`、backtick、`---`を入力するcaseを追加する。

nested空itemと空taskではpromotionしないcaseを追加する。

frontmatterとfenced code内の通常入力にbulletを付けないcaseを追加する。

- [ ] **Step 5: harness unit testをGREENにする**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand
```

Expected: command decoderとdispatch helper testがPASSする。

- [ ] **Step 6: test harnessとspecをcommitする**

`but diff`でこのTaskのfile IDだけを選び、次のmessageでcommitする。

```text
test(editor): cover bullet-owned typing semantics

Why:
- Programmatic test insertion cannot prove that user-event filtering works.
- Paste and typed input need distinct end-to-end contracts.

What:
- Add annotated typing and paste commands to the semantic driver.
- Cover body correction, structural promotion, Enter, and Backspace behavior.
```

### Task 9: IME、Vim、全体検証

**Files:**

- Modify only if characterization exposes a missing adapter: `src/features/BulletTypingGuard.ts`
- Modify only if the adapter changes: `src/features/__tests__/BulletTypingGuard.test.ts`
- Modify only if a regression is missing: `specs/features/BulletTypingGuard.spec.md`
- Modify when a durable new operational rule is discovered: `AGENTS.md`

**Interfaces:**

- Verifies: production behavior across CodeMirror, Obsidian, Vim, and IME
- Preserves: design and policy interfaces from Tasks 2 through 5

- [ ] **Step 1: 全unit testとlintを実行する**

Run:

```bash
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
```

Expected: すべてexit 0で、ESLint warningは0件になる。

- [ ] **Step 2: test vault fixtureをbackupする**

`vault/test.md`をvault外の`mktemp -d`で作ったdirectoryへcopyし、元fileのSHA-256とsizeを記録する。

`~/Library/Application Support/obsidian/Local Storage/leveldb/LOCK`を`lsof`で確認する。

小文字の`obsidian` processがownerなら、そのprocessを終了してlock解放を確認する。

lock file自体は削除しない。

- [ ] **Step 3: test buildとfull integration testを実行する**

Run:

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- --runInBand
```

Expected: 既存suiteと新しいsemantic specがすべてPASSする。

renderer終了後にfixtureをrestoreし、遅延保存を待ってSHA-256とsizeがbackup前と一致することを再確認する。

- [ ] **Step 4: test vaultへproduction bundleを配置する**

Run:

```bash
n exec 22.23.1 npm run build
```

`dist/main.js`、`manifest.json`、`styles.css`を`vault/.obsidian/plugins/bullet/`へ配置する。

個人用vaultには配置しない。

- [ ] **Step 5: Vim操作を実Obsidianで確認する**

Computer Useを使う前に、各action直前に次を実行する。

```bash
obsidian-cli vault=vault eval code='window.focus()'
```

fresh stateのwindow titleが`vault`であることを確認する。

次の操作とMarkdown結果を記録する。

- Insert modeで空行へ通常文字を入力すると`- `が付く。
- root空itemで`x`を使ってmarkerを壊せない。
- `dd`はitem行全体を削除する。
- `cc`後の最初の通常文字がbulletへ所属する。
- Visual Lineを`j`と`k`で上下へ伸縮できる。
- Visual Lineの`d`と`c`がselection表示どおりに動く。
- `.`が直前のVim editと補正を同じ意味で繰り返す。
- undoとredoが一回で元編集と補正を戻す。

Vim transactionがuser eventを持たずpolicyを通らない場合だけ、`BulletTypingGuard`へkeydown中の同期transactionを識別する局所的なadapterを追加する。

そのadapterはpaste user eventを最優先で除外し、selection transactionを変更せず、keydown turn終了時に状態をclearするtestを伴う。

- [ ] **Step 6: 日本語IMEを実Obsidianで確認する**

空行と既存の非バレット本文で、composition開始、候補移動、確定、Escapeによる取り消し、再変換を確認する。

cursor、候補window、確定文字列が維持されることを確認する。

transaction filterがcompositionを壊す場合だけ、`EditorView.inputHandler`でdefault `insert()` transactionを取得し、composition開始前のprefix correctionとdefault transactionを一回のdispatchへまとめる。

このfallbackでは`view.compositionStarted`または`view.composing`のときだけcomposition専用pathを使い、通常入力はtransaction filterへ残す。

- [ ] **Step 7: Markdown構造とpasteを実Obsidianで確認する**

root空itemから見出し、引用、水平線、fenced code blockを作る。

frontmatterとcode fence内で通常文字を入力する。

複数行のplain text、list、見出し、code fenceをpasteし、内容が一文字も変換されないことを確認する。

Live PreviewとSource modeで保存Markdownが一致することを確認する。

- [ ] **Step 8: fallbackまたは回帰testが必要な場合だけcommitする**

変更が生じた場合は`but diff`で該当file IDだけを選び、次のmessageでcommitする。

```text
fix(editor): preserve native input integrations

Why:
- Real Obsidian input metadata can differ from isolated CodeMirror tests.
- Vim and IME must retain their native state while outline corrections run.

What:
- Add only the adapter required by runtime characterization.
- Cover the observed transaction sequence with a regression test.
```

変更がなければ空commitは作らない。

- [ ] **Step 9: completion reviewを行う**

`requesting-code-review` skillで設計書からbranch diffまでをreviewする。

CriticalまたはImportant findingを修正し、影響範囲のtestとTask 9 Step 1からStep 3のverificationを再実行する。

最後に`but status`でcommit順と未committed changeを確認し、実装結果、検証数値、manual verification結果、残る制約を報告する。

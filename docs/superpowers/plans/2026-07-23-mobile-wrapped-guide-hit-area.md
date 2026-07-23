# Mobile Wrapped Guide Hit Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルの折り返し行で、縦線と同じインデント帯をタップしたときに本文へカーソルを入れず、対応するlist branchを開閉する。

**Architecture:** capture phaseで行本体へ落ちたmobile interactionだけを補足し、`clientX`をその行の既存`.cm-indent`のDOMRectへ対応づける。解決後は既存のraw-prefix target resolver、selection-safe fold transaction、scroll snapshotをそのまま使う。

**Tech Stack:** TypeScript、CodeMirror 6、Jest 30、Obsidian 1.13.3、GitButler

## Global Constraints

- local verificationはNode.js 22.23.1で実行する。
- version controlの書き込みには`but`を使い、`codex/mobile-indent-tap-target`へcommitする。
- fallbackはevent target自体が`.cm-line`であり、`body.is-mobile`かつLive Previewかつ`verticalLinesAction === "toggle-folding"`の場合に限定する。
- 透明なoverlay、追加Decoration、座標cache、独自fold transactionを追加しない。
- outer guide、desktop、Source mode、本文、リストmarker、設定無効時の編集操作を変更しない。
- 実Obsidianの検証にはrepository内の`vault`だけを使い、各UI action前にtitle、`useTab === true`、`tabSize === 4`を確認する。

---

### Task 1: 折り返し行のmobile tapを既存guideへ解決する

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `src/features/GuideFolding.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: `MouseEvent.target`、`MouseEvent.clientX`、`.cm-line`、`.cm-hmd-list-indent > .cm-indent`、`Element.getBoundingClientRect()`、`Settings.verticalLinesAction`。
- Produces: `resolveMobileIndentGuide(target: Element, clientX: number): Element | null`相当のprivate resolution path。
- Preserves: `resolveVerticalGuideTarget(list, pressedGuide)`以降のfolding semantics。

- [x] **Step 1: 折り返し行の失敗するinteraction testを追加する**

`makeEvent`へ任意の`clientX`を渡せる引数を追加する。

```ts
function makeEvent(target: unknown, clientX?: number) {
  let defaultPrevented = false;
  const preventDefault = jest.fn(() => {
    defaultPrevented = true;
  });
  const stopPropagation = jest.fn();
  return {
    event: {
      target,
      clientX,
      get defaultPrevented() {
        return defaultPrevented;
      },
      preventDefault,
      stopPropagation,
    } as unknown as MouseEvent,
    preventDefault,
    stopPropagation,
  };
}
```

`makeGuideLine`のlineへguide queryとmobile documentを追加し、guideごとの横幅を指定できるようにする。

```ts
const line = {
  ownerDocument: {
    body: { classList: { contains: (name: string) => name === "is-mobile" } },
  },
  querySelectorAll: jest.fn((selector: string) =>
    selector === ".cm-hmd-list-indent > .cm-indent" ? guides : [],
  ),
};
```

直接guideではなくlineをtargetとし、guide帯内の`clientX`を持つ`mousedown`と`click`を検証する。

```ts
test("routes a wrapped mobile indentation lane to its rendered guide", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- parent\n    - branch\n        - leaf",
      cursor: { line: 2, ch: 8 },
    }),
  });
  mockGetEditorFromState.mockReturnValue(makeFoldEditor());
  const pluginValue = makeInteractionHarness(
    { verticalLinesAction: "toggle-folding" },
    { parse: jest.fn().mockReturnValue(root) },
  );
  const { line } = makeGuideLine(["    "], {
    guideRects: [{ left: 24, right: 60 }],
  });
  const mouseDown = makeEvent(line, 50);
  const click = makeEvent(line, 50);

  expect(pluginValue.mouseDown(mouseDown.event, makeView(2))).toBe(true);
  expect(foldable).not.toHaveBeenCalled();
  expect(pluginValue.click(click.event, makeView(2))).toBe(true);
  expect(foldable).toHaveBeenCalledTimes(1);
  expect(mouseDown.stopPropagation).toHaveBeenCalledTimes(1);
  expect(click.stopPropagation).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: focused testを実行してREDを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "routes a wrapped mobile indentation lane"
```

Expected: handlerが`.cm-line` targetをguideとして扱わないため、最初の`true` assertionで失敗する。

- [x] **Step 3: mobile fallback resolverを最小実装する**

`GuideFolding.ts`へselectorを追加する。

```ts
const LINE_INDENT_GUIDE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent";
```

`handleGuideInteraction()`のouter guide分岐後で、直接guideまたはmobile fallbackを選ぶ。

```ts
const pressedGuide = pressedTarget.matches(INDENT_GUIDE_SELECTOR)
  ? pressedTarget
  : this.resolveMobileIndentGuide(pressedTarget, event.clientX);
if (!pressedGuide) return false;
```

private resolverはmobileと設定を確認し、現在のguide DOMRectだけを読む。

```ts
private resolveMobileIndentGuide(target: Element, clientX: number) {
  if (
    !this.interactionEnabled() ||
    !target.matches(LINE_SELECTOR) ||
    !Number.isFinite(clientX)
  ) {
    return null;
  }
  if (
    !target.ownerDocument.body.classList.contains("is-mobile") ||
    !target.closest(".markdown-source-view.mod-cm6.is-live-preview")
  ) {
    return null;
  }

  return (
    Array.from(target.querySelectorAll(LINE_INDENT_GUIDE_SELECTOR)).find(
      (guide) => {
        const rect = guide.getBoundingClientRect();
        return rect.left <= clientX && clientX < rect.right;
      },
    ) ?? null
  );
}
```

- [x] **Step 4: 境界条件testを追加する**

同じfixtureでguideの`right`以上にあるX座標、`.cm-line`の子孫target、desktop document、Source mode、`verticalLinesAction: "none"`をそれぞれ渡し、`mousedown`と`click`がfalseを返し、`preventDefault`、`stopPropagation`、`foldable`を呼ばないことを確認する。

- [x] **Step 5: focused interaction suiteでGREENを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "wrapped mobile indentation lane|wrapped guide lane descendant|outside a wrapped guide lane|desktop wrapped indentation|Source mode wrapped indentation|folding is disabled"
```

Expected: 追加したtestと既存のdisabled interaction testがすべてpassする。

- [x] **Step 6: durable instructionをAGENTS.mdへ追加する**

縦線ガイド節へ、折り返し行ではnative pseudo-elementの描画高だけが行全体へ伸びること、mobile fallbackはinteraction時のDOMRectと`clientX`だけでguideを決めること、overlayと座標cacheを追加しないことを記録する。

### Task 2: 自動検証と実touch検証を完了する

**Files:**

- Verify: `src/features/GuideFolding.ts`
- Verify: `src/features/__tests__/GuideFolding.test.ts`
- Verify: `AGENTS.md`
- Verify: `vault/test.md`

**Interfaces:**

- Consumes: Task 1のmobile fallback resolution path。
- Produces: unit、lint、build、full Jest、実Obsidian touchの検証結果。

- [x] **Step 1: unit、lint、test bundleを検証する**

Run:

```bash
n exec 22.23.1 npm run test:unit
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: 全commandがexit 0になる。

- [x] **Step 2: full Jest suiteを安全に実行する**

LevelDB `LOCK`のownerを`lsof`で確認する。

`vault/test.md`を新しい`/tmp/obsidian-bullet-mobile-guide.*` directoryへbackupし、SHA-256を記録する。

Run:

```bash
n exec 22.23.1 npm test -- --runInBand
```

rendererの終了後にfixtureをrestoreし、直後と少し待った後のhashがbackupと一致することを確認する。

確認後、agentが作成した正確なtemporary directoryだけを`/usr/bin/trash`へ移す。

- [x] **Step 3: test vaultへ検証bundleを配置する**

`dist/main.js`、`manifest.json`、`styles.css`を`vault/.obsidian/plugins/bullet/`へ配置し、`obsidian-cli vault=vault plugin:reload id=bullet`を実行する。

`app.emulateMobile(true)`、幅412px、DPR 2.625、touch emulationを有効にし、対象noteを開き直す。

- [x] **Step 4: 折り返し行のguide帯をnative touchで検証する**

各action前に`window.focus()`を実行し、titleに`vault`が含まれて`base`が含まれないこと、`useTab === true`、`tabSize === 4`を確認する。

折り返し行の2行目で、`elementFromPoint()`が`.cm-line`を返し、X座標が対応する`.cm-indent`の`left`以上かつ`right`未満になる点を選ぶ。

`pointerType="touch"`相当の`touchStart`と`touchEnd`を送り、生成される`pointerdown`、`pointerup`、`mousedown`、`mouseup`、`click` sequenceを記録する。

tap後に対応する直下branchだけが一度foldし、同じ位置の再tapで一度unfoldし、本文selectionがタップ位置へ移動しないことを確認する。

guide帯の`right`より本文側をtapし、fold状態を変えず本文編集へ流れることも確認する。

- [x] **Step 5: scoped changeをcommitする**

`but diff`からdesign、plan、source、test、`AGENTS.md`のchange IDを取得する。

該当IDだけを`codex/mobile-indent-tap-target`へ、次の形式のEnglish Conventional Commitでcommitする。

```text
fix(vertical-lines): widen wrapped mobile guide taps

Why:
- Native indentation paint spans wrapped list rows while its element hit box remains on the first visual row.
- Mobile taps beside the painted guide can therefore enter the editor instead of folding the represented branch.

What:
- Resolve wrapped mobile line taps through the rendered guide lane at the interaction point.
- Preserve direct guide, desktop, text editing, and existing fold transaction behavior.
- Cover mobile routing and its disabled and out-of-lane boundaries with regression tests.
```

### Task 3: 最終差分をreviewする

**Files:**

- Review: `src/features/GuideFolding.ts`
- Review: `src/features/__tests__/GuideFolding.test.ts`
- Review: `AGENTS.md`
- Review: `docs/superpowers/specs/2026-07-23-mobile-wrapped-guide-hit-area-design.md`
- Review: `docs/superpowers/plans/2026-07-23-mobile-wrapped-guide-hit-area.md`

**Interfaces:**

- Consumes: committed branch diffと全verification output。
- Produces: requirement coverage、regression risk、test evidenceの最終判定。

- [x] **Step 1: branch diffとtest evidenceを照合する**

`but show codex/mobile-indent-tap-target`で、変更がdesign、plan、source、test、`AGENTS.md`に限定されることを確認する。

fallbackがexact `.cm-line` target、mobile、Live Preview、設定有効、有限な`clientX`、guide DOMRect内という六条件をすべて要求し、座標cacheやDOM追加を含まないことを確認する。

- [x] **Step 2: verification-before-completion checklistを実行する**

focused REDとGREEN、unit、lint、build、full Jest、実touch foldとunfold、本文側control tap、fixture restore、temporary cleanupの新しい出力が揃っていることを確認する。

## Verification Results

- RED：折り返し行の`.cm-line` targetはguide帯内でもhandlerが`false`を返した。
- GREEN：guide帯内、帯外、desktop、Source mode、設定無効の5 testがpassした。
- Review RED / GREEN：帯内の子孫targetがfoldへ奪われるtest failureを確認し、exact `.cm-line` targetへ限定した後にpassした。
- Focused：`GuideFolding.test.ts`を含むunit runで、同fileの82 testsがpassした。
- Unit：55 suites、671 testsがpassした。
- Lint：PrettierとESLintがwarningなしでpassした。
- Build：`build-with-tests`がTypeScript warningなしで完了した。
- Full Jest：75 suites、818 passed、15 skippedで完了した。
- Environment diagnosis：mobile emulationを残した最初のfull runではDragAndDropの7件が無反応になり、desktopへ戻した同一bundleでfocused 7件とfull suiteがpassした。
- Real touch fold：`x=50`は`.cm-line` targetのまま`mousedown`と`click`がpreventされ、childが非表示になり、cursorは`line 53, ch 6`に留まった。
- Real touch unfold：fresh geometryから同じguide帯をtapし、childが再表示され、cursorは変化しなかった。
- Editing control：guide rightの外側`x=61`ではeventをpreventせず、fold状態を維持してcursorが本文へ移動した。
- Fixture：`vault/test.md`をSHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`へrestoreし、renderer終了後に再確認した。
- Cleanup：diagnostic listener、mobile emulation、device metrics、touch emulationを解除し、temporary backupをTrashへ移した。

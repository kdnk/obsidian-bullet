# Persistent Vertical Guide Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クリックまたはタップした論理的な縦線ガイドを、折りたたみの可否と設定から独立して選択表示し、別の場所をクリックするまで維持する。

**Architecture:** `GuideFoldingPluginValue`が現在のdocumentに対するsemantic keyをview固有状態として保持する。fold、scroll、viewport更新では既存resolverと`requestMeasure()`から表示segmentを再解決し、`docChanged`では選択を解除する。

**Tech Stack:** TypeScript、CodeMirror 6.38.6、Obsidian 1.13系、CSS、Jest、GitButler CLI

## Global Constraints

- 選択状態は`ViewPlugin`のimplementationに閉じ、`StateField`、`StateEffect`、position mapping、editor transactionへ追加しない。
- DOM elementを状態として保持せず、inner guideは対象Listの先頭位置、outer guideはchunk IDをsemantic keyにする。
- fold、unfold、scroll、viewport更新では選択を維持し、`ViewUpdate.docChanged`では解除する。
- Obsidian所有の`.cm-indent::before`と既存outer guide widgetを描画源とし、独立overlay、追加Decoration、複製DOM、画面座標cacheを追加しない。
- marker同期は`requestMeasure()`のread phaseとwrite phaseを使う。
- 選択表示は現在のhoverと同じactive色、active幅、enhanced時の3px幅、中心補正、endpoint角丸を使う。
- 折りたたみ設定が`none`でも、または直下に開閉対象がなくても、解決できるguideを選択できる。
- 既存のfold transaction、selection退避、scroll snapshot、persistent guide、raw-prefix target resolverは変更しない。
- `mousedown`と`click`は`contentDOM`のcapture phaseで受け、document内の選択解除は`contentDOM.ownerDocument`のcapture phaseで受ける。
- 検証にはNode.js 22.23.1を使い、`src`のJestには`SKIP_OBSIDIAN=1`を付ける。
- version controlの書き込みにはGitButler CLIを使い、commitは`codex/persistent-vertical-guide-selection`へ追加する。
- 共有worktreeの対象外変更は編集せず、commitには`but diff`が返す今回のfile IDだけを渡す。

---

### Task 1: Semantic Guide Selection Lifecycle

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `src/features/GuideFolding.ts`

**Interfaces:**

- Consumes: `resolveVerticalGuideTarget()`、`collectVerticalGuideGroup()`、outer chunk ID、`ViewUpdate.docChanged`
- Produces: view-local `SelectedGuide`、selected marker group、document click cleanup

- [ ] **Step 1: 選択のsemantic scopeとlifecycleを要求する失敗テストを書く**

既存のViewPlugin test harnessへ`contentDOM.ownerDocument`のlistener記録と`contentDOM.contains()`を追加する。
public methodは増やさず、capture listenerとqueued measurementを通して次を検証する。

```ts
clickListener?.(makeEvent(clickedGuide).event);
executeLatestMeasurement();

expect(selectedSegments.every((guide) =>
  guide.classList.contains("bullet-plugin-selected-indent-guide"),
)).toBe(true);
expect(unrelatedSegments.some((guide) =>
  guide.classList.contains("bullet-plugin-selected-indent-guide"),
)).toBe(false);
```

test caseは次を含める。

- 同じ実リスト祖先へ解決されるinner segment全体を選択する。
- 同じX位置でも別listのsegmentは選択しない。
- `verticalLinesAction: "none"`でも選択する。
- 直下に非空childがないtargetも選択し、fold effectはdispatchしない。
- `data-actionable="false"`のouter chunkも選択する。
- pointer leaveではhover markerだけが消え、selected markerは残る。
- foldまたはviewport update後に交換されたDOMへselected markerを付け直す。
- 別guide clickで選択を移し、非guideまたは別viewのdocument clickで解除する。
- `docChanged: true`のupdateで解除する。
- destroyでdocument listenerとselected markerを除去する。

- [ ] **Step 2: 選択未実装でtestが失敗することを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: selected marker、action非依存click、document listenerの期待値でFAILし、既存fold testはPASSする。

- [ ] **Step 3: view-local semantic keyを追加する**

`GuideFolding.ts`へ次のprivate stateを追加する。

```ts
type SelectedGuide =
  | { kind: "indent"; targetStart: MyEditorPosition }
  | { kind: "outer"; chunkId: string };

class GuideFoldingPluginValue implements PluginValue {
  private selectedGuide: SelectedGuide | null = null;

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.selectedGuide = null;
      this.decorations = this.buildOuterDecorations();
    }
    this.scheduleGuideSynchronization();
  }
}
```

inner clickでは`resolveVerticalGuideTarget()`が返したListの`getFirstLineContentStart()`を保存する。
outer clickでは検証済みの`data-chunk-start`と`data-chunk-end`から既存形式のchunk IDを保存する。

- [ ] **Step 4: selected groupを既存measurementへ統合する**

`HoverMeasurement`をguide marker全体のmeasurementへ改名し、hoverとselectedのinner groupおよびouter groupを一回のreadで返す。
inner selectionは保存したList開始位置と`hasSameListStart()`が一致するcandidateだけを集める。
outer selectionは保存したchunk IDと同じ`data-chunk-id`を持つ表示中widgetだけを集める。

selected用にinnerとouterそれぞれmarker、start marker、end markerを追加し、既存`synchronizeHoverMarkers()`を用途非依存の`synchronizeGuideMarkers()`へ改名して再利用する。
表示segmentが0個の場合はstateを残し、次のview updateで再解決する。

- [ ] **Step 5: 選択とfoldの条件を分離する**

`handleGuideInteraction()`先頭の`interactionEnabled()` gateを外す。
semantic targetを解決できたguideは`mousedown`でselection移動だけをpreventし、`click`で選択状態を設定する。
foldは次の条件を満たす場合だけ既存処理へ渡す。

```ts
this.selectedGuide = resolved.selection;
this.scheduleGuideSynchronization();

if (this.interactionEnabled() && resolved.actionable) {
  resolved.toggle();
}

event.preventDefault();
return true;
```

`contentDOM.ownerDocument`へcapture phaseの`click` listenerを登録する。
targetが現在の`contentDOM`内にあるguideでなければ選択を解除し、measurementを予約する。
guide clickではdocument listenerが先に走っても解除せず、その後のcontent listenerが選択を設定する。

- [ ] **Step 6: focused testを通す**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: GuideFolding testがすべてPASSする。

- [ ] **Step 7: selection lifecycleをcommitする**

Run `but diff`し、sourceとtestのfile IDだけを次のmessageで既存branchへcommitする。

```text
feat(editor): persist vertical guide selection

Why:
- Guide feedback currently disappears with hover and only exists for actionable folding targets.
- A tapped guide should remain selected independently from folding behavior.

What:
- keep semantic guide selection in view-local state until another click or document edit
- resynchronize selected native segments after fold, scroll, and DOM replacement
- remove document listeners and markers when the view is destroyed
```

### Task 2: Selected Paint and Durable Guidance

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `styles.css`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: Task 1のselected marker群と既存hover paint
- Produces: action設定に依存しないselected表示、ガイド選択のドメイン語と実装制約

- [ ] **Step 1: selected paintの失敗するCSS contract testを書く**

innerとouterのselected selectorがhoverと同じactive変数を使うことを確認する。

```ts
expect(selectedDeclarations).toContain(
  "border-inline-end: var(--indentation-guide-width-active) solid var(--indentation-guide-color-active);",
);
expect(enhancedSelectedDeclarations).toContain("inline-size: 3px;");
expect(enhancedSelectedDeclarations).toContain(
  "background-color: var(--indentation-guide-color-active);",
);
```

selected startとendだけが対応する上下の角を2pxへ丸めること、selectorがfold action body classへ依存しないことも確認する。
outer widgetは`data-actionable`に関係なく既存width内でpointerを受け、追加width、padding、overlayを持たないことを確認する。

- [ ] **Step 2: 新しいCSS contractが失敗することを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: selected selectorまたはaction非依存pointer targetの期待値でFAILする。

- [ ] **Step 3: hoverとselectedへ同じpaintを適用する**

既存hover ruleへselected selectorをcommaで追加するか、同じ宣言を共有するselector groupへ整理する。
selected selectorはaction body classの外へ置く。
通常線の色、幅、位置は変更しない。

```css
.markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent.bullet-plugin-selected-indent-guide::before {
  border-inline-end: var(--indentation-guide-width-active) solid
    var(--indentation-guide-color-active);
}
```

enhanced表示、Live PreviewとSource modeの中心補正、innerとouterのendpoint ruleにもselected markerを加える。
outer widgetの`width: var(--list-indent)`をそのままhit areaにし、独自geometryは追加しない。

- [ ] **Step 4: ドメイン語とagent指針を追加する**

`CONTEXT.md`へ次を追加する。

```md
**ガイド選択**は、最後にクリックまたはタップした実リスト祖先またはリストチャンクを、fold可能性から独立してview内で示す一時状態である。
```

`AGENTS.md`へ次を追加する。

```md
- ガイド選択はfold可能性と`verticalLinesAction`から独立したview固有状態として扱ってください。DOM elementを状態として保持せず、documentが同じ間だけsemantic keyから表示中のnative segmentへ`requestMeasure()`でselected markerを同期してください。fold、scroll、DOM再生成では維持し、別の場所のclick、`docChanged`、ViewPlugin destroyでは解除してください。独立overlay、追加Decoration、StateField、editor transactionを選択状態のために導入しないでください。
```

- [ ] **Step 5: focused test、lint、type checkを通す**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
```

Expected: 3commandがexit 0になる。

- [ ] **Step 6: paintとguidanceをcommitする**

Run `but diff`し、Task 2の4ファイルのfile IDだけを次のmessageで既存branchへcommitする。

```text
feat(styles): show persistent guide selection

Why:
- View-local guide selection needs theme-aware feedback even when folding is disabled.
- Future editor changes need a durable rule separating semantic selection from native DOM.

What:
- share active guide paint between hover and selected markers
- keep existing guide geometry as the selection hit area
- document guide selection ownership and cleanup
```

### Task 3: Automated and Real-Obsidian Verification

**Files:**

- Verify: `src/features/GuideFolding.ts`
- Verify: `src/features/__tests__/GuideFolding.test.ts`
- Verify: `styles.css`
- Generated, untracked: `dist/main.js`
- Runtime artifacts only: `vault/.obsidian/plugins/bullet/`

**Interfaces:**

- Consumes: Tasks 1と2のselection lifecycleとpaint
- Produces: CI相当の自動検証結果とtest vaultでのdesktopおよびmobile確認

- [ ] **Step 1: runtimeとObsidian lockを確認する**

Run:

```bash
n exec 22.23.1 node --version
lsof "$HOME/Library/Application Support/obsidian/Local Storage/leveldb/LOCK"
```

Expected: Node.jsは`v22.23.1`を表示する。lock ownerが小文字の`obsidian` CLI processなら、その正確なPIDだけを終了して解放を再確認する。

- [ ] **Step 2: fixtureをbackupしてtest buildを生成する**

Run:

```bash
guide_selection_backup_dir=$(mktemp -d /tmp/obsidian-bullet-guide-selection.XXXXXX)
cp vault/test.md "$guide_selection_backup_dir/test.md"
shasum -a 256 "$guide_selection_backup_dir/test.md"
n exec 22.23.1 npm run build-with-tests
```

Expected: backup hashが表示され、buildがexit 0になる。

- [ ] **Step 3: automated verificationを実行する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm test -- --runInBand
n exec 22.23.1 npm run build
```

Expected: 全commandがexit 0になる。

- [ ] **Step 4: renderer終了後にfixtureをrestoreする**

`vault=vault`のrenderer終了を確認してからbackupを戻し、少し待ってSHA-256が一致することを再確認する。
backup directoryの絶対pathが`/tmp/obsidian-bullet-guide-selection.`で始まることを検証し、`/usr/bin/trash <exact-path>`でTrashへ移す。

- [ ] **Step 5: test vaultで実動作を確認する**

production buildを`vault/.obsidian/plugins/bullet/`へ配置する。
各UI action直前にtest vaultのfocus、title、`useTab === true`、`tabSize === 4`を確認する。

desktopとmobile touch emulationで次を確認する。

- actionable guideは選択を残し、fold状態を一度だけ反転する。
- non-actionable guideとfold action無効時のguideは選択だけを残す。
- pointer leave後もselected表示が残る。
- fold、scroll、DOM再生成後も同じ論理guideへselected markerが戻る。
- 別guide clickで移動し、本文またはeditor外のclickで解除する。
- 文書編集で解除する。

- [ ] **Step 6: workspaceを確認する**

Run:

```bash
but diff
but status
```

Expected: 今回のtracked fileにuncommitted changeがなく、生成物とtest-vault artifactがbranchへ入っていない。

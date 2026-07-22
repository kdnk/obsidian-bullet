# Logseq風ドラッグカーソル設計

## 目的

デスクトップでリスト項目をドラッグできる場所と、ドラッグ中の状態を、Logseq 2.0.1と同じカーソル形状で示す。

バレット、番号、チェックボックス、シェブロンへホバーしたときは、リンクと同じ`pointer`を表示する。

ドラッグ開始後は、矢印へplus記号を添える`copy`を表示する。

`copy`は視覚フィードバックだけに使い、ドロップ後の処理は既存どおりリストbranchの移動とする。

## 比較結果

現在のBulletは、ドラッグ開始UIへ`grab`、ドラッグ中のbodyへ`grabbing`を指定している。

Logseq 2.0.1は、バレットとシェブロンへ`pointer`を表示する。

LogseqのネイティブHTML Drag and Dropは、ドラッグ中に矢印とplus記号を組み合わせたカーソルを表示する。

Bulletは独自のmouse eventでリスト移動を実装しているため、同じ表示をCSSの`copy`で再現する。

## 対象範囲

対象は、`Drag-and-Drop`設定が有効なデスクトップのMarkdown editorとする。

ドラッグ開始UIとして既に認識している次の要素へ同じ通常時カーソルを適用する。

- unordered listとordered listのmarker
- task listのcheckbox
- list itemのnative fold chevron

モバイル、Reading View、見出しのシェブロン、縦線ガイド、通常のeditor本文は変更しない。

ドラッグ開始距離、drop候補の計算、移動元と挿入位置の表示、list移動処理も変更しない。

## カーソル状態

`bullet-plugin-dnd`があり、`bullet-plugin-dragging`がない通常時は、バレット、番号、チェックボックス、シェブロンへ`cursor: pointer`を適用する。

pointerが6pxの開始距離へ達して`bullet-plugin-dragging`が付いた後は、ドラッグ対象とdrop候補を含むeditor領域へ`cursor: copy`を適用する。

ドラッグ中は子要素が持つ`text`や`pointer`より`copy`を優先し、pointer位置によってplus記号が消えないようにする。

drop、mouse up、Escape、window close、feature unloadで既存の`bullet-plugin-dragging`が外れた後は、通常時の`pointer`へ戻る。

## 実装境界

既存のbody classが通常時とドラッグ中を区別できるため、`styles.css`だけを変更する。

TypeScriptへ新しい状態、event listener、inline style、DOM markerを追加しない。

通常時のselectorは、実際にドラッグ開始判定が受け付けるmarker、checkbox、fold indicatorへ限定する。

ドラッグ中のselectorはデスクトップのMarkdown editorへ限定し、設定画面やsidebarなどeditor外のUIへ`copy`を強制しない。

## エラー処理

list解析失敗、編集内容の競合、drop候補なしの場合は既存処理を維持する。

これらの経路でも既存の終了処理が`bullet-plugin-dragging`を外すため、カーソル用の追加cleanupは持たない。

## テスト

CSS contract testで、通常時のバレット、番号、チェックボックス、シェブロンが`pointer`を使うことを確認する。

同じtestで、ドラッグ中のeditor領域が`copy`を使い、`grab`と`grabbing`が残らないことを確認する。

既存のDragAndDrop unit testで、開始距離、body classの追加と解除、drop、cancel、pop-out windowのcleanupを回帰確認する。

実Obsidianでは、バレット、番号、チェックボックス、シェブロンのcomputed cursorが通常時に`pointer`となることを確認する。

各要素からドラッグを始め、editor内の移動元、本文、drop separator上で矢印とplus記号が維持されることを確認する。

dropとEscape後に`pointer`へ戻り、branchがコピーされず一度だけ移動することも確認する。

## 完了条件

- バレット、番号、チェックボックス、シェブロンで`pointer`を表示する。
- ドラッグ中のeditor領域で矢印とplus記号を表示する。
- dropとcancel後に通常時のカーソルへ戻る。
- list移動の結果と既存のdrag feedbackを変更しない。
- モバイルとeditor外のUIへ影響しない。

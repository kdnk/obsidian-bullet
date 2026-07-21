# デスクトップ native chevron のスクロール固定

## 症状

デスクトップ版 Obsidian の Live Preview で、リスト項目または Markdown 見出しの native chevron を開閉すると、表示中のページが Y 方向へ動く場合がある。

縦線ガイドから同じ枝を開閉した場合は、表示中の上端が固定される。

ページの長さは必要条件ではなく、native chevron という操作経路の差として扱う。

## Roam Research の参照挙動

共有された White Paper ページを Chrome 上で調べた。

Roam の本文は、`overflow-y: scroll` の `.rm-article-wrapper` に通常の block DOM を並べる構造だった。

開いた block は `.rm-block-children` を子 subtree として持ち、閉じると subtree 自体が DOM から取り除かれた。

scroll container、block、children の `overflow-anchor` はすべて `auto` であり、表示中の block に transform または layout containment はなかった。

「1. Introduction」を閉じた一例では、block の高さが 203.0556px から 28.0035px、scroll height が 7083px から 6908pxへ減った一方、block の画面上 Y 座標は 412.0313px、`scrollTop` は 0px のまま変わらなかった。

Roam の非公開 bundle に専用補正が存在しないことまでは断定できない。

ただし、観測した DOM と computed style は、React の通常レイアウト更新を Chromium の native scroll anchoring に渡す構成と一致する。

## Obsidian との違い

Obsidian 1.13.2 の Live Preview は CodeMirror 6 を使う。

CodeMirror は大きな文書を仮想化し、972 行の検証 fixture でも DOM に描画されていた `.cm-line` は 85 行だった。

さらに、CodeMirror の base theme は `.cm-scroller` へ `overflow-anchor: none` を設定する。

実 Obsidian の computed style でも同じ値を確認した。

したがって、Roam と同じ browser anchoring を CSS で有効化すると、CodeMirror の仮想 viewport 管理と二重にスクロールを補正することになる。

このプラグインは、縦線ガイド操作と mobile native chevron に対して `EditorView.scrollSnapshot()` を fold transaction へ追加し、CodeMirror 自身に viewport を復元させている。

しかし、desktop native chevron は mobile 用 body class の判定で除外される。

ローカルの 972 行 fixture では list と heading の fold および unfold を 0px 差で完了し、報告された揺れを再現できなかった。

それでも desktop 経路にスクロール固定の effect が存在しないことはコードと unit test から確認できる。

環境依存の anchor 選択へ任せている状態を、既存の確定的な transaction contract へ揃える。

## 目標

デスクトップ版 Live Preview の list と heading の native chevron で、fold と unfold の両方を補正済み scroll snapshot と同じ transaction にする。

操作した行と viewport 上端の表示内容を、開閉前と同じ画面上 Y 座標に保つ。

短い文書、仮想化される長い文書、文末付近のいずれでも同じ経路を使う。

## 対象外

native fold transaction を独自 handler へ置き換えない。

event の `preventDefault()` または `stopPropagation()` を追加しない。

fold 後に `scrollTop` を手動で戻さない。

遅延した scroll 補正、独自 DOM、overlay、座標 cache を追加しない。

縦線ガイド、keyboard command、Reading View の挙動を変更しない。

CodeMirror の `overflow-anchor: none` を CSS で上書きしない。

mobile right fold controls が無効な mobile UI へ補正を広げない。

## 設計

native chevron の scroll 保持を `NativeFoldScroll` feature として mobile の見た目設定から分離する。

feature は、補正済み snapshot を次の fold 状態変更 transaction へ運ぶ `NativeFoldScrollState` と、capture phase の pointer event を受ける `NativeFoldScrollPluginValue` を登録する。

対象 selector は既存どおり、Live Preview の list と heading の `.collapse-indicator` の和集合とする。

desktop は常に対象にする。

mobile は `bullet-plugin-mobile-right-fold-controls` body class がある場合だけ対象にし、現在の setting contract を維持する。

`pointerdown` では `ensureFoldScrollReserve()` を呼び、`scrollHeight` を読んで復元した下端余白を layout へ反映する。

`click` では同じ処理に加え、`stableFoldScrollSnapshot()` を準備する。

transaction extender は、次の `foldEffect`、`unfoldEffect`、または folded range の実内容が変わる transaction に snapshot を追加する。

selection-only transaction が先に入った場合は、同じ event turn の次 state へ pending snapshot を引き継ぐ。

この lifecycle は既存の mobile 実装を移動するだけで変更しない。

`MobileRightFoldControls` は body class の管理だけを残し、native scroll の責務を持たない。

## 自動テスト

実装前に、mobile body class がない desktop document の list と heading click が reserve を復元し、`NativeFoldScrollState.prepare()` を呼ぶ期待を追加する。

現行コードでは mobile body class の gate で処理が止まり、test は失敗する。

実装後は、mobile setting 有効時の既存 list と heading、mobile setting 無効時、対象外 element、fold と unfold、selection-only transaction、implicit unfold、timeout expiry の全 contract を維持する。

plugin 登録 test は、`NativeFoldScroll` と `MobileRightFoldControls` が別 feature として読み込まれることを確認する。

## 実 Obsidian 検証

リポジトリ内の `vault` と plugin ID `bullet` だけを使う。

300 行の前置き、20 個の child、300 行の後続、foldable heading を持つ 972 行 fixture を test build で開く。

desktop mode で list と heading を viewport 上端から 160px に置き、cursor が fold 内にある状態で fold と unfold を native mouse sequence から実行する。

各 animation frame で操作行の Y 座標、操作行より上の表示行の Y 座標、`scrollTop`、fold 状態を記録する。

すべての操作で Y 座標差と `scrollTop` 差を 0px にし、fold 状態が一度だけ反転することを確認する。

検証後は診断 listener と一時 fixture を削除する。

## 検証結果

2026-07-21にNode.js 22.23.1とObsidian 1.13.2で検証した。

source verificationではunit test 55 suites、651 testsがPASSし、lint、`tsc --noEmit`、test buildがすべてexit 0だった。

実Obsidianでは、test buildをリポジトリ内の`vault/.obsidian/plugins/bullet/`へ配置し、972行のfixtureをdesktop modeで開いた。

全操作でtrusted eventが`pointerdown`、`pointerup`、`click`の順に一度ずつ到達し、click captureから12 animation framesまで記録した。

| 対象 | 操作 | 操作行のviewport相対Y | 上側表示行 | 操作行span | 上側表示行span | `scrollTop` | `scrollTop` span | state反転 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| list | fold | 159.6875px | `- before 294` | 0px | 0px | 7432px | 0px | 1回 |
| list | unfold | 159.6875px | `- before 294` | 0px | 0px | 7432px | 0px | 1回 |
| heading | fold | 160.1875px | `- middle 295` | 0px | 0px | 15454px | 0px | 1回 |
| heading | unfold | 160.1875px | `- middle 295` | 0px | 0px | 15454px | 0px | 1回 |

listとheadingのどちらもfold時は`false`から`true`、unfold時は`true`から`false`へ一度だけ変わった。

診断listenerとruntime globalを削除し、fixtureを`apply_patch`で削除した後、`test - vault - Obsidian 1.13.2`、`test.md`、desktop mode、fixture不在を確認した。

full testの初回実行は、並行releaseがproduction buildで`dist/main.js`を上書きした後だったため、test relay renderer connection timeoutで失敗した。

rendererとLOCKの解放、`vault/test.md`の復元、test buildの再生成と再配置を行った最終実行では、75 suites、798 testsがPASSし、15 testsがskippedだった。

test後はrendererとLOCK ownerがないことを確認してから`vault/test.md`を4,588 bytes、SHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`へ復元し、二秒後も一致することを確認した。

検証用backup directoryは対象pathと内容を確認してから`/usr/bin/trash`へ移し、production buildと`git diff --check`はexit 0だった。

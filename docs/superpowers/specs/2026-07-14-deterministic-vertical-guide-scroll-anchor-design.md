# 縦線開閉の上側固定設計

## 目的

縦線クリックによるリスト開閉で、CodeMirrorがviewportの上下どちらをanchorに選ぶかによって表示位置が変わる挙動をなくす。

開閉対象より上側の表示位置を維持し、閉じるときは削除された高さの分だけ下側が上へ詰まり、開くときは追加された高さの分だけ下側が下へ広がるようにする。

## 適用範囲

対象は、`Vertical lines action` が `Toggle folding` のときの縦線クリックとする。

ネストしたnative indent guideと、リストチャンクの最外線の両方へ適用する。

Obsidianのnative chevron、keyboard操作、command paletteからのfold/unfold、pluginの既存folding commandには適用しない。

document末尾付近でも上側を維持できるよう、toggle actionが有効な間だけCodeMirror標準の `scrollPastEnd()` extensionを有効にする。
Obsidianが実DOMの余白を上書きした場合は、縦線操作の直前だけ標準と同じ値へ復元する。
この処理は縦線以外の開閉transactionを変更せず、scroll snapshotがdocument高の縮小によって最大 `scrollTop` へclampされることだけを防ぐ。

## Obsidian固有の座標差

Obsidianは、file titleとPropertiesをCodeMirrorのdocumentより前に置き、同じscroll containerでスクロールする。
この構造では、scroll containerの `scrollTop` とCodeMirror document内の高さが、file titleとPropertiesの高さ分だけ異なる。

CodeMirrorの `scrollSnapshot()` は `scrollTop` をdocument内の高さとしてanchor行を選ぶ。
Propertiesを展開した状態でこの前提を使うと、実際のviewport上端より下にある行がanchorになり、その行がfold対象に含まれるかどうかで移動方向が変わる。

Obsidianは新しいMarkdown editor viewを開いた直後にも、`contentDOM` の `padding-bottom` を `100px` へ上書きする。
この上書きはCodeMirrorのcontent attributeを変更しないため、`scrollPastEnd()` pluginが保持する余白と実DOMの余白が一致しなくなる。
その結果、document末尾ではfold後の最大 `scrollTop` へclampされる。

## Transaction設計

縦線クリック1回で対象になる全childの開閉を、1回のCodeMirror transactionへまとめる。

transactionには次を同居させる。

- 開閉前に取得した `EditorView.scrollSnapshot()` effect。
- 対象childすべての `foldEffect` または `unfoldEffect`。
- 現在のselection headが閉じる範囲内にある場合の安全なselection。

scroll snapshotは実際のviewport上端を基準にする。
scroll containerの上端と `EditorView.documentTop` の差を `scaleY` で補正し、CodeMirror document内でviewport上端にある高さを求める。
その高さへCodeMirrorと同じ8pxのbiasを加え、`lineBlockAtHeight()` でanchor行を取得する。

`scrollSnapshot()` が返したsnapshot targetのrangeをanchor行へ置き換え、`yMargin` を `anchor.top - scrollTop` に設定する。
この補正により、file titleとPropertiesを含むscroll offsetを保ったまま、実際のviewport上端に対応する行を維持できる。
開閉によってviewport上端の文書位置が非表示にならない限り、その位置とpixel offsetを維持する。

snapshot targetの構造またはviewport geometryを安全に取得できない場合は、CodeMirrorが返したsnapshotをそのまま使う。
補正失敗を理由にtransactionを分割したり、dispatch後に `scrollTop` を書き戻したりしない。

viewport上端自体が閉じる範囲内にある場合は、非表示になる行の位置を維持できないため、CodeMirrorが同じ文書位置を含むfold placeholderへ解決する。この場合も、別の可視行やcursorを暗黙のanchorとして選ばせない。

複数branchを操作する最外線でも、branchごとにsnapshotやtransactionを作らない。1回のクリックにつきsnapshotを1個だけ取得し、全effectを同時にdispatchする。

`scrollSnapshot()` はscroll可能な範囲を増やさないため、document末尾でfold後の高さがviewportより短くなると最大 `scrollTop` へclampされる。
toggle actionが有効な間は `scrollPastEnd()` で1 viewport弱の下端余白を確保し、この物理的なclampを避ける。

縦線操作の直前に、実DOMの下端余白がCodeMirror標準の計算値より小さいかを確認する。
計算値には `editorHeight - defaultLineHeight - documentPadding.top - 0.5` を使う。
Obsidianによって余白が小さく上書きされている場合だけ、`contentDOM.style.paddingBottom` を計算値へ復元してからsnapshotを取得する。
常時監視、遅延した再設定、dispatch後の手動scroll補正は使わない。
toggle actionが無効な場合と、native chevronを含む縦線以外の操作では復元しない。

fold前後のheight差がsub-pixelになる場合、snapshotの `yMargin` をそのまま次回snapshotへ引き継ぐと、scroll elementが丸めた差分を毎回再学習して0.5px単位のdriftが累積する。snapshot effectをdispatchへ入れる前に、`yMargin` を `devicePixelRatio` に対応する物理pixel gridへ丸める。これにより1回の開閉中に1物理pixel未満の差が出る場合も、往復後は同じ位置へ戻り、誤差を累積しない。

## Fold target API

縦線操作専用のbatch APIを `MyEditor` に追加する。

APIは対象行と、閉じる場合のfallback cursorを受け取り、開閉方向に応じて現在のCodeMirror stateからfold rangeを解決する。

rangeを持たない対象はeffectへ含めない。すべてのrangeが無効ならdispatchしない。

閉じるrangeのうちselection headを含むものがあれば、その対象のfallback cursorへselectionを退避する。selectionとfold effectsは必ず同じtransactionに含め、CodeMirrorのselection更新による自動unfoldを防ぐ。

既存の単一行用 `fold`、`unfold` とfolding commandの意味は変更しない。

## 縦線操作との接続

`toggleVerticalGuideTarget` と `toggleOuterListChunk` は、対象childを列挙し、1回だけbatch APIを呼ぶ。

1つでも開いているchildがあれば、対象childをすべて閉じる。

すべて閉じていれば、対象childをすべて開く。

対象がない場合はtransactionを作らず、mousedownも消費しない既存動作を維持する。

raw indent prefix resolver、hover同期、persistent guide、outer chunk境界は変更しない。

## テスト

自動テストでは次を検証する。

- 複数のfold対象を、1個のscroll snapshot、全fold effects、安全なselectionを含む1 transactionでdispatchする。
- selectionがfold範囲外ならselectionを変更しない。
- 複数のunfold対象を、1個のscroll snapshotと全unfold effectsを含む1 transactionでdispatchする。
- 有効なfold rangeまたはfolded rangeがない場合はdispatchしない。
- ネスト線と最外線がbatch APIを1回だけ呼び、branchごとのfold/unfoldを呼ばない。
- leafだけの対象ではtransactionを作らない。
- native chevronと既存folding commandが新しいbatch APIを使わない。
- toggle actionの有効化・無効化に合わせて `scrollPastEnd()` extensionを追加・除去し、設定変更時だけMarkdown viewをreconfigureする。
- file titleとPropertiesによるscroll offsetを除いたdocument内のviewport上端から、snapshotのanchor行とmarginを補正する。
- snapshot targetの構造またはviewport geometryが不正な場合は、CodeMirrorのsnapshotへフォールバックする。
- Obsidianが下端余白を `100px` へ上書きした状態では、縦線操作の直前だけCodeMirror標準の計算値を復元する。
- native chevronとtoggle action無効時には下端余白を復元しない。
- snapshot marginを物理pixel gridへ正規化し、sub-pixelのfold高を繰り返してもdriftが累積しない。

実Obsidianの確認では、リポジトリ内の `vault` だけを使う。

frontmatterなし、frontmatterあり、Properties折りたたみ、Properties展開のfixtureを用意する。各fixtureは複数のトップレベルbranchと12階層のネストを持つ長いリストにする。

viewport上端、中央、下端で、cursorが閉じるbranchの内側と外側にある場合を確認する。ネスト線と最外線をそれぞれ複数回開閉し、開閉対象より上にある可視行の画面上のY座標が変わらないことを記録する。

別のノートへ移動してfixtureへ戻り、実DOMの下端余白が `100px` へ上書きされた状態から最初の縦線操作を実行する。
Properties展開時と折りたたみ時の両方で、最初の操作とその後の往復操作が同じanchor規則を使うことを確認する。

## 完了条件

- 縦線で閉じると、開閉対象より上側が固定され、下側だけが上へ移動する。
- 縦線で開くと、開閉対象より上側が固定され、下側だけが下へ移動する。
- ネスト線と最外線で同じanchor規則を使う。
- frontmatter、Properties、cursor位置、viewport位置によって上下のanchorが切り替わらない。
- selectionを含むbranchを閉じても直後に自動unfoldしない。
- native chevronと既存folding commandの挙動を変更しない。
- document末尾でも最大 `scrollTop` のclampによって上側が下へ移動しない。

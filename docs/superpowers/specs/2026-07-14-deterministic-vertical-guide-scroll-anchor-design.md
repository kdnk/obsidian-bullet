# 縦線開閉の上側固定設計

## 目的

縦線クリックによるリスト開閉で、CodeMirrorがviewportの上下どちらをanchorに選ぶかによって表示位置が変わる挙動をなくす。

開閉対象より上側の表示位置を維持し、閉じるときは削除された高さの分だけ下側が上へ詰まり、開くときは追加された高さの分だけ下側が下へ広がるようにする。

## 適用範囲

対象は、`Vertical lines action` が `Toggle folding` のときの縦線クリックとする。

ネストしたnative indent guideと、リストチャンクの最外線の両方へ適用する。

Obsidianのnative chevron、keyboard操作、command paletteからのfold/unfold、pluginの既存folding commandには適用しない。

## Transaction設計

縦線クリック1回で対象になる全childの開閉を、1回のCodeMirror transactionへまとめる。

transactionには次を同居させる。

- 開閉前に取得した `EditorView.scrollSnapshot()` effect。
- 対象childすべての `foldEffect` または `unfoldEffect`。
- 現在のselection headが閉じる範囲内にある場合の安全なselection。

scroll snapshotは現在のviewport上端を基準にする。開閉によってviewport上端の文書位置が非表示にならない限り、その位置とpixel offsetを維持する。

viewport上端自体が閉じる範囲内にある場合は、非表示になる行の位置を維持できないため、CodeMirrorが同じ文書位置を含むfold placeholderへ解決する。この場合も、別の可視行やcursorを暗黙のanchorとして選ばせない。

複数branchを操作する最外線でも、branchごとにsnapshotやtransactionを作らない。1回のクリックにつきsnapshotを1個だけ取得し、全effectを同時にdispatchする。

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

実Obsidianの確認では、リポジトリ内の `vault` だけを使う。

frontmatterなし、frontmatterあり、Properties折りたたみ、Properties展開のfixtureを用意する。各fixtureは複数のトップレベルbranchと12階層のネストを持つ長いリストにする。

viewport上端、中央、下端で、cursorが閉じるbranchの内側と外側にある場合を確認する。ネスト線と最外線をそれぞれ複数回開閉し、開閉対象より上にある可視行の画面上のY座標が変わらないことを記録する。

## 完了条件

- 縦線で閉じると、開閉対象より上側が固定され、下側だけが上へ移動する。
- 縦線で開くと、開閉対象より上側が固定され、下側だけが下へ移動する。
- ネスト線と最外線で同じanchor規則を使う。
- frontmatter、Properties、cursor位置、viewport位置によって上下のanchorが切り替わらない。
- selectionを含むbranchを閉じても直後に自動unfoldしない。
- native chevronと既存folding commandの挙動を変更しない。

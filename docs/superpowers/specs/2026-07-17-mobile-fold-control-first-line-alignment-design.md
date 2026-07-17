# モバイル折りたたみコントロールの1行目配置

> [!NOTE]
> この文書の48px、`-35px`、13pxの配置は廃止されました。現行仕様は[モバイル折りたたみコントロールのヘッダー対称配置](./2026-07-17-mobile-fold-control-overflow-containment-design.md)を参照してください。

## 背景

モバイルのLive Previewでは、右側のnative折りたたみコントロールを48px幅に広げ、リスト行の右端から35px外側へ配置している。

Obsidianはnativeコントロールへ`height: 100%`を指定している。
pluginが外側の`.cm-fold-indicator`を`position: static`へ変更すると、この100%がリスト行全体の高さを参照する。
そのため、親項目が折り返されると操作領域が親行の全高まで伸び、中央配置されたシェブロンも複数行の中央へ移動する。

本文の右余白は、`.cm-fold-indicator`を持つ行だけに13px付いている。
子項目の追加によって親項目へfold indicatorが現れると、同じ本文でも利用可能な横幅が13px減り、折り返し位置が変わる。

## 実測結果

Obsidian 1.13.2のテスト用vaultで、2行に折り返す親項目を計測した。

- 親行の表示高：50.375px
- 現在の操作領域の高さ：50.375px
- 現在のシェブロン中心：親行上端から25.1875px
- pluginの右側配置を外したnative操作領域の高さ：24px
- nativeシェブロン中心：親行上端から13.1875px
- fold indicatorがある行の右余白：13px
- fold indicatorがない行の右余白：0px

pluginの右側配置を外すと、nativeコントロールは折り返し行でも1行目の高さに限定される。
今回のずれは、右側配置によってnativeの`height: 100%`が参照する包含ブロックを変えたために起きている。

## 採用する設計

コントロールの横幅は48pxのまま維持する。
`inset-inline-end: -35px`も維持し、シェブロンの左右位置は変更しない。

Obsidianの`height: 100%`を、`calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`で上書きする。
`1lh`は1行のline heightを表し、二つの`--list-spacing`はリスト行の上下paddingを表す。
これにより、シェブロンとタップ領域は一緒に親項目の1行目へ揃う。

本文の`padding-inline-end: 13px`は、fold indicatorの有無にかかわらず、機能が有効なすべてのLive Previewリスト行へ適用する。
子項目を追加または削除しても、親項目の本文幅と折り返し位置は変わらない。

## 検討した別案

シェブロンだけを上へ移動し、行全体をタップ領域として残す案は採用しない。
見えていない操作領域が折り返し本文の右側へ残り、カーソル配置と折りたたみ操作を区別しにくいためである。

48px四方の操作領域を1行目へ置く案も採用しない。
通常の1行は約26pxの高さしかなく、上下のリスト行に操作領域が重なるためである。

24pxなどの固定高をplugin側で指定する案も採用しない。
line heightとlist spacingから計算すれば、テーマや文字設定に追従できる。

## CSS契約

- 右余白のselectorは、`.HyperMD-list-line:has(.cm-fold-indicator)`ではなく、Live Previewの全`.cm-line.HyperMD-list-line`を対象にする。
- 全リスト行の`padding-inline-end`は13pxとする。
- native `.collapse-indicator`の`width: 48px`を維持する。
- native `.collapse-indicator`の`inset-inline-end: -35px`を維持する。
- pluginは`.collapse-indicator`の`height: 100%`を、`calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`で上書きする。
- シェブロンSVGだけを移動する`translate`は追加しない。
- nativeのfold transactionとscroll補正処理は変更しない。

## 検証

CSS contract testでは、全リスト行へ13pxの右余白が適用され、foldable行限定の余白selectorが存在しないことを確認する。
同じtestで、右側コントロールが1行高の計算式を持ち、`height: 100%`と`translate`を持たないことも確認する。

実Obsidianでは、同じ長文を持つfoldable行とnon-foldable行を並べる。
両方の本文領域、表示高、折り返し位置が一致することを確認する。

折り返したfoldable行では、操作領域の高さが親行全体より小さく、nativeの1行目高と一致することを確認する。
シェブロン中心は1行目の文字中央と揃える。

touch emulationでは、シェブロン内を`pointerdown`、`pointerup`、`click`の順で操作する。
1行目より下の右端をタップしても折りたたまれないことを確認する。

既存の100px、160px、400pxの位置でfoldとunfoldを行い、親行の画面上Y座標差と`scrollTop`差が0であることも再確認する。

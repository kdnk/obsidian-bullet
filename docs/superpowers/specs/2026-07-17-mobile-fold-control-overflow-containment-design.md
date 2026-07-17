# モバイル折りたたみコントロールの横幅制御

## 問題

モバイルのLive Previewでは、48px幅のnative `.collapse-indicator`を`inset-inline-end: -35px`で右へ移動している。

390pxのviewportでは、リスト行右端が366px、controlの左端が353px、右端が401px、シェブロン中心が377pxになる。

この配置はシェブロンを左側のnative controlと左右対称にするが、`.cm-scroller`の`overflow-x: auto`がcontrol右端までをscrollable overflowへ含める。

その結果、`.cm-scroller`は`clientWidth: 390px`に対して`scrollWidth: 401px`となり、画面を横へ11px移動できる。

## 維持する配置

controlの横幅は48px、`inset-inline-end`は`-35px`、リスト行の`padding-inline-end`は13pxのまま維持する。

シェブロン中心をリスト行右端から約11px外側へ置き、controlとpointer targetを一体で移動する。

折り返し行ではcontrolを1行目へ揃え、1行目より下の右端をtapしてもfoldしない。

foldable行とnon-foldable行の本文幅も変えない。

## 横方向overflowの制御

機能が有効なLive Previewの`.cm-scroller`へ`overflow-x: clip`を適用する。

clipの対象はviewport境界であり、content境界ではない。

そのため、viewport内にあるシェブロン全体とcontrolの表示中部分は描画され、pointer hit testingも維持される。

viewport外の11pxは描画と操作の対象外になり、horizontal scroll positionへ移動できなくなる。

`.cm-content`にはoverflow指定を追加しない。

contentをclipすると、リスト行右端より外側にあるシェブロンとpointer targetまで切れるためである。

SVGだけを移動するtransform、scroll event listener、`scrollLeft`の手動復元、独立overlayも追加しない。

## 適用範囲

selectorは`.bullet-plugin-mobile-right-fold-controls .markdown-source-view.mod-cm6.is-live-preview .cm-scroller`へ限定する。

デスクトップ、Reading view、見出し、Properties、機能が無効なeditorには適用しない。

## テスト

CSS contract testでは、限定したselectorに`overflow-x: clip`があり、`.cm-content`へoverflow指定を追加していないことを確認する。

実Obsidianでは`app.emulateMobile(true)`、390×844px、DPR 3、touch emulationを使い、次を確認する。

- viewport、document、editor rootの幅が390pxである。
- `.cm-scroller`の`clientWidth`が390pxである。
- horizontal scrollを試しても`.cm-scroller.scrollLeft`が0のままである。
- controlの左端が353px、右端が401px、シェブロン中心が約377pxのままである。
- viewport右端の389pxで`.collapse-indicator`をpointer targetとして取得できる。
- foldとunfoldの前後で画面上の行位置と`scrollTop`が変わらない。
- 折り返した1行目より下の右端をtapしてもfoldしない。

## 完了条件

- モバイル画面を横へ移動できない。
- 右端シェブロンの見た目と表示中のtap領域が変わらない。
- 本文の折り返し位置が子要素の有無で変わらない。
- native foldingとscroll anchoringに回帰がない。

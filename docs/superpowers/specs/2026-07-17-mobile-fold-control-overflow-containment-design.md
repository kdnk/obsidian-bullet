# モバイル折りたたみコントロールのヘッダー対称配置

## 問題

モバイルのLive Previewでは、リスト行のnative `.collapse-indicator`を48px幅に広げ、`inset-inline-end: -35px`で右へ移動している。

390pxのviewportでは、リスト行右端が366px、controlの左端が353px、右端が401px、シェブロン中心が377pxになる。

シェブロンの見た目は意図した位置にあるが、control右端がviewportを11px越える。

その結果、`.cm-scroller`は`clientWidth: 390px`に対して`scrollWidth: 401px`となり、画面を横へ11px移動できる。

overflowをclipすれば横移動は止められるが、viewport外へはみ出すcontrolを残したまま隠す構造になる。

## nativeヘッダーとの対応

Obsidian 1.13.2をモバイル表示にした実測では、見出しのnative fold controlは次の寸法だった。

- controlは15px幅である。
- SVGは10px四方である。
- controlの残り5pxは、SVGと見出し本文の間隔になる。
- controlの高さは見出しの1行目のline boxに一致する。
- controlは見出し本文の左端から外側へ15px配置される。

リスト側では、この配置を左右反転する。

controlはリスト行右端から外側へ15px配置し、SVGと本文の間に5pxを置く。

390pxのviewportでは、リスト行右端が366px、controlの左端が366px、右端が381px、SVGの左端が371px、右端が381pxになる。

シェブロン中心は376pxとなり、現在の377pxとほぼ同じ見た目を保ちながら、control全体がviewport内に収まる。

## 配置

controlへ`box-sizing: border-box`、`width: 15px`、`inset-inline-end: -15px`、`padding-inline-start: 5px`、`padding-inline-end: 0`を適用する。

SVGをcontrolの中央へ置く`justify-content: center`は使わず、`justify-content: flex-start`で5pxの開始側paddingに続けて配置する。

リスト行全体へ追加していた13pxの`padding-inline-end`は削除する。

controlが本文領域へ入らなくなるため、折りたたみ可能な行と子を持たない行は、どちらも追加paddingなしで同じ本文幅になる。

折り返し行では、controlの高さを`calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`として1行目へ揃える。

1行目より下の右端をtapしてもfoldしない。

## overflow

`.cm-scroller`と`.cm-content`へ新しいoverflow指定を追加しない。

control自体をviewport内に収めるため、clip、scroll event listener、`scrollLeft`の手動復元は不要である。

SVGだけをtransformで移動する方法や、独立overlayも追加しない。

## 適用範囲

selectorは、機能が有効な`.markdown-source-view.mod-cm6.is-live-preview`の`.cm-line.HyperMD-list-line:has(.cm-fold-indicator)`内にあるnative `.collapse-indicator`へ限定する。

デスクトップ、Reading view、見出し、Properties、機能が無効なeditorには適用しない。

## テスト

CSS contract testでは、次を確認する。

- リスト行へ一律の`padding-inline-end`を追加していない。
- controlが15px幅、`inset-inline-end: -15px`、`padding-inline-start: 5px`、`padding-inline-end: 0`である。
- SVGを開始側へ配置するため、controlが`justify-content: flex-start`である。
- `.cm-scroller`と`.cm-content`へoverflow指定を追加していない。
- controlの高さが1行目のline boxに一致する。

実Obsidianでは`app.emulateMobile(true)`、390×844px、DPR 3、touch emulationを使い、次を確認する。

- viewport、document、editor rootの幅が390pxである。
- `.cm-scroller`の`clientWidth`と`scrollWidth`が390pxである。
- horizontal scrollを試しても`.cm-scroller.scrollLeft`が0のままである。
- controlの左端が366px、右端が381px、幅が15pxである。
- SVGの左端が371px、右端が381px、中心が約376pxである。
- controlの1行目を`pointerType="touch"`でtapするとfoldとunfoldが動作する。
- `elementFromPoint`ではcontrol外をpointer targetとして取得しない。
- Chromiumがcontrol外のtouchを近くのclickable targetへ補正する場合は、nativeヘッダーと同じ補正を許容する。CSSでtouch領域を追加拡張しない。
- 折り返した1行目より下をtapしてもfoldしない。
- foldable行とnon-foldable行で同じ本文の折り返し位置が一致する。
- foldとunfoldの前後で画面上の行位置と`scrollTop`が変わらない。

## 完了条件

- モバイル画面の横幅がviewportを越えず、横へ移動できない。
- 右端シェブロンがnativeヘッダーを左右反転した位置と操作領域になる。
- 本文の折り返し位置が子要素の有無で変わらない。
- 折り返し行ではシェブロンと操作領域が1行目へ揃う。
- native foldingとscroll anchoringに回帰がない。

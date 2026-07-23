# モバイルの折り返し行における縦線タップ領域設計

## 問題

Obsidian 1.13.3のモバイルLive Previewでは、リストのインデント1段を36px幅の`.cm-indent`で表し、その疑似要素で縦線を描く。

リスト行の1行目では`.cm-indent`自体が24px高を持つため、36px幅のインデント帯全体が縦線操作のevent targetになる。

しかし、本文が折り返した2行目以降でも`.cm-indent::before`は行全高へ縦線を描く一方、元の`.cm-indent`要素の高さは1行目の24pxから伸びない。

実DOMでは、折り返し行の2行目にある3px幅の線上だけが`.cm-indent`を返し、同じ36px幅の残りは`.cm-line`を返した。

実touch sequenceでも`.cm-line`をtargetとする`pointerdown`、`mousedown`、`click`が発生し、既存のguide folding handlerへ届かなかった。

この差により、利用者が縦線の近くをタップしても、折りたたみではなく本文へカーソルが入る。

## 目的

- モバイルの折り返し行でも、表示中のインデント帯全体から対応する縦線を操作できるようにする。
- 既存のraw indent prefixによる祖先解決と、単一transactionによるfoldまたはunfoldを再利用する。
- 縦線から外れた本文、リストmarker、デスクトップ、Source mode、設定無効時の編集操作を変えない。

## 採用する方法

capture phaseの`mousedown`と`click`でevent targetが`.cm-indent`でなかった場合に限り、モバイル用のfallback resolverを使う。

resolverはevent target自体が`.cm-line`であることを確認し、その行に存在する`.cm-hmd-list-indent > .cm-indent`を列挙する。

各guideの現在の`getBoundingClientRect()`と`event.clientX`だけを比較し、X座標がguideの`left`以上かつ`right`未満にある要素をpressed guideとして返す。

測定はinteraction時に一度だけ行い、DOM要素や座標を保存しない。

見つかったguideは既存の`resolveVerticalGuideTarget()`へ渡すため、複数のインデント単位を一つの`.cm-indent`へまとめるDOMでも、1行目の直接タップと同じraw-prefix semanticsを保つ。

fallbackはevent target自体が`.cm-line`であり、`body.is-mobile`かつLive Previewかつ`verticalLinesAction === "toggle-folding"`の場合だけ有効にする。

`.cm-line`の子孫であるcheckbox、link、widget、native controlは、X座標がguide帯に重なってもfallbackへ渡さない。

直接`.cm-indent`を押した既存経路、outer guide、hover、selection、scroll snapshot、fold effectは変更しない。

## 検討した代替案

### 透明な疑似要素でhit areaを広げる

`.cm-indent::after`を行全高かつ36px幅で配置すれば、browserのhit testからguideを直接返せる。

しかし、Obsidianは複数段のインデントを一つの`.cm-indent`へまとめる場合があり、固定幅の疑似要素では元要素の実幅を再現できない。

nativeの線とは別のhit geometryも追加されるため採用しない。

### 誤タップ時のフォーカスだけを防ぐ

インデント領域で`preventDefault()`だけを実行すればカーソル移動は防げる。

しかし、利用者が意図したfoldまたはunfoldも起きないため採用しない。

## テスト

unit testでは、モバイルの折り返し行を表す`.cm-line` targetとguideの横幅を用意する。

guide帯内の`mousedown`はdefaultとpropagationを止めるがfoldしないことを確認する。

同じ位置の`click`は既存のfold経路を一度だけ実行することを確認する。

guide帯の外、`.cm-line`の子孫target、デスクトップ、Source mode、設定無効時はeventを消費しないことを確認する。

既存の直接guide操作、複数段targeting、outer guide、scroll保持のtestも通す。

実Obsidianでは`app.emulateMobile(true)`、幅412px、DPR 2.625、touch emulationを使う。

折り返し行の2行目で、縦線から横へ外れた同じguide帯をnative touch sequenceでタップし、該当branchが一度だけfoldまたはunfoldすることと、カーソルが本文へ移動しないことを確認する。

## エージェント向け指示

折り返し行では`.cm-indent::before`の描画高と`.cm-indent`本体のhit box高が一致しない。

モバイルのguide帯fallbackは現在のDOMRectをinteraction時にだけ読み、既存のraw-prefix resolverへ渡す。

透明なoverlay、追加Decoration、座標cache、独自fold transactionへ置き換えない。

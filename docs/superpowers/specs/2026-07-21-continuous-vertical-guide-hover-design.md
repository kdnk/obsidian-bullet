# Logseq風の連続した縦線hover

## 観測結果

実Logseqの子listには、通常線を描く`.block-children`と、hoverを受ける`.block-children-left-border`が別要素として置かれている。
hover要素は子list全体を覆う1本のabsolute elementであり、`height: 100%`、`width: 4px`、`border-radius: 2px`を持つ。
そのため、丸くなるのは線全体の上端と下端だけである。

実Obsidian 1.13.2では、同じ実list祖先へ対応するguideが行ごとの`.cm-indent::before`へ分割されていた。
長い検証listでは各segmentの高さと次のsegmentのY座標差がともに`26.375px`で、segment自体は隙間なく接続している。
しかし、hover中の17 segmentすべてに`border-radius: 2px`が適用されていた。
segment境界ごとに3px線が細くなり、線全体が波打って見える原因はこの全周角丸である。

Obsidian既定dark themeの通常線は`color-mix(in oklch, white 12%, transparent)`、hover色はwhite 30%相当だった。
通常線はhover線より十分に細いだけでなく、12%では背景へ沈みやすい。

## 表示契約

「Enhance vertical line hover」は表示名を「Enhance vertical lines」へ改める。
保存keyの`enhanceVerticalLineHover`と既定値`true`は変えず、既存設定をそのまま引き継ぐ。
説明文は通常線を少し強くし、hover時に太い連続線を表示する設定だと示す。

設定が有効な`.markdown-source-view.mod-cm6`では、`--indentation-guide-color`を`color-mix(in oklch, var(--text-normal) 20%, transparent)`へ上書きする。
light themeではtext色を混ぜて暗くし、dark themeでは明るくするため、固定色を持たずthemeへ追従する。
通常線の幅、位置、segment高、pointer領域は変更しない。
設定を無効にした場合はObsidianが提供する通常色へ戻す。

hover中のinner guideとouter guideは、既存の3px幅、active色、中心補正を維持する。
全segmentへ適用している`border-radius`は外す。
同じ論理groupの先頭segmentだけに上側2角の2px radiusを、末尾segmentだけに下側2角の2px radiusを付ける。
groupが1 segmentだけなら、そのsegmentが先頭と末尾を兼ね、4角すべてが丸くなる。
中間segmentにはradiusを付けない。

## endpoint marker

`GuideFoldingPluginValue`は、既存のhover markerに加えてgroupの先頭と末尾を表すmarkerを同期する。
inner guideとouter guideは別のmarker名を使い、既存のgroup resolverとchunk IDをそのまま利用する。

同期処理は現在のhover対象から古いendpoint markerをすべて外したあと、現在の配列順で先頭と末尾を付け直す。
これにより、CodeMirrorのDOM置換やscroll後に表示segmentが変わっても、古い中間segmentへ角丸が残らない。
pointer leave、設定無効化、ViewPlugin destroyではhover markerとendpoint markerを同時に除去する。

独立overlay、screen座標cache、追加DOM、gradient、box-shadow、transitionは導入しない。
線を描く主体は引き続きObsidianの`.cm-indent::before`と既存のouter guide widgetである。

## 折りたたみとの境界

raw indent prefixによる対象解決、hover groupの範囲、capture phaseのclick処理、fold transaction、scroll保持は変更しない。
endpoint markerはpaintだけを制御し、pointer targetやfold対象の判定には使わない。
「Enhance vertical lines」を無効にしても、縦線からの折りたたみが有効ならnative active幅とactive色によるhover feedbackとclick動作を維持する。

## 検証

unit testは、3 segment groupの先頭だけにstart marker、末尾だけにend markerが付くことを確認する。
1 segment groupでは両markerが同居し、group置換、pointer leave、設定無効化、destroyでは古いmarkerが消えることも確認する。
outer chunkにも同じendpoint契約を適用する。

CSS contract testは、通常色がtext色20%へ変わること、全segment用ruleにradiusがないこと、startとendのruleが論理方向の上角と下角だけを丸めることを確認する。
3px幅、active色、Live PreviewとSource modeの中心補正は維持する。

実Obsidianでは、長いlistのhover中に中間segmentのcomputed radiusが`0px`、先頭の上角と末尾の下角だけが`2px`になることを確認する。
通常線はdarkとlightの両方で20%のtheme追従色となり、hoverは30%のactive色を維持する。
縦線clickによるfoldとunfoldはそれぞれ一度だけ反転し、hover解除後にendpoint markerが残らないことを確認する。

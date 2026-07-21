# 中心軸を固定する縦線ホバー

## 背景

現在の縦線ホバーは、Obsidianの`--indentation-guide-width-active`と`--indentation-guide-color-active`をそのまま使っている。
Obsidian既定値では通常時とactive時の幅がどちらも1pxなので、hoverしても色しか変わらない。

Roam Researchは通常線を1px、hover線を3pxで描き、Logseq 2.0.1は通常の1px線へ4pxのhover面を重ねる。
Logseqのhover面には`border-radius: 2px`が指定され、上下端も角張らない。
この比較から、Bulletのhover線は3pxへ太くする。

ただし、境界位置を変えずにborderだけを1pxから3pxへ広げると、増えた2pxが片側へ寄り、線の中心が1px移動する。
hover前後で同じリスト階層を指しているように見せるには、元の1px線の中心座標を固定する必要がある。

## 決定

通常線は、Obsidianのnative幅とnative色を変更しない。
hover線は3pxとし、色には`--indentation-guide-color-active`を使う。
独自の透明度、固定色、transitionは追加しない。
hover線だけへ`border-radius: 2px`を適用し、通常線の形状は変更しない。

3px線は、元の1px線の中心からinline start側とinline end側へ1pxずつ広げる。
border幅の増加と反対向きにpseudo-elementを1px移動し、hover前後の中心座標を一致させる。

## Native indent guide

Obsidianの`.cm-indent::before`は明示的なinline insetではなく、各indent spanのstatic positionを基準に`border-inline-end`で1px線を描く。
ここへ`inset-inline-end`を追加するとstatic positionが失われ、線が行の反対側へ移動するため使わない。
hover markerが付いたpseudo-elementへ次の三つを同時に適用する。

```css
margin-inline-start: -1px;
border-inline-end: 3px solid var(--indentation-guide-color-active);
border-radius: 2px;
```

これにより、static positionを維持したままpseudo-element全体をinline start側へ1px戻し、3px borderを元の1px線の両側へ均等に広げる。
論理プロパティを使うため、LTRとRTLで同じ中心固定の関係を保つ。

## Outer guide

mobileを含む基本配置では、outer guideは`inset-inline-end: 0`を基準にする。
hover時は`inset-inline-end: -1px`と3px borderを適用する。
native guideと同じ`border-radius: 2px`も適用する。

desktopのouter guideは、既存の配置規則によって`inset-inline-start: 0`と`inset-inline-end: auto`を使う。
この場合だけhover時に`inset-inline-start: -1px`と`inset-inline-end: auto`を適用し、inline start側の基準線を中心に3pxへ広げる。

## 維持する挙動

hover markerの同期、同じ実リスト祖先へ対応する表示中segment全体の強調、persistent guide、outer chunkの対応付けは変更しない。
クリック領域、fold処理、selection退避、scroll snapshot、z-indexも変更しない。
CodeMirrorが管理するnative pseudo-elementを使い続け、overlay、box-shadow、gradient、座標cacheは追加しない。

## 検証

CSS契約テストでは、native hover ruleが3px border、`margin-inline-start: -1px`、`border-radius: 2px`を同時に持ち、static positionを上書きするinline insetを持たないことを確認する。
outer guideの基本hover ruleが`inset-inline-end: -1px`、3px border、`border-radius: 2px`を持つことを確認する。
desktop outer guide専用のhover ruleが`inset-inline-start: -1px`と`inset-inline-end: auto`を持つことを確認する。

実Obsidianではinner guideとouter guideをLTRで操作し、通常時とhover時の線の中心X座標差が0pxであることを確認する。
RTLの中心固定は、物理方向の`left`や`right`を追加せず、論理方向のmargin、inset、borderだけで配置していることをCSS契約テストで確認する。
hover時に論理ガイド全体だけが3pxかつ2px角丸となり、隣の階層や同じX座標にある別リストが変化しないことも確認する。

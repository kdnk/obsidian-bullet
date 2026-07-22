# Outer Line Chevron Clearance Design

## 症状

desktop Live Previewのouter lineはシェブロンとの重なりを避けたが、左へ移動しすぎた。
実Obsidian 1.13.3ではouter widgetが`x=40..76`、通常線が`x=53.6..54.6`、シェブロンSVGが`x=71..81`であり、通常時の空きは`16.4px`だった。
同じ画面のnative inner guideとbulletの空きは`5.8px`であり、outer lineだけが視覚的に離れている。

## 原因

現行ruleはouter widgetのinline startから`--indentation-guide-editing-indent`だけ進めた位置へ線を置く。
この配置はinner guideとの36px gridを保つが、outer widgetのinline endを中心に広がるnative collapse indicatorの位置を使っていない。
そのため、シェブロンを避けるために必要な距離より約15px余分に移動している。

## 候補

1. native guide gridを維持する。
   現行配置のため、離れすぎる症状が残る。
2. 固定pixelでwidget inline endから戻す。
   現在のthemeには合わせられるが、native icon sizeの変更へ追従できない。
3. nativeの`--icon-xs`からcollapse indicatorのinline startを算出する。
   themeのicon sizeへ追従しながら、シェブロンの直前まで線を近づけられる。

3を採用する。

## 配置

desktop Live Previewの通常線は`inset-inline-end: calc(var(--icon-xs) / 2)`へ置く。
native collapse indicatorはouter widgetのinline endを中心に`--icon-xs`幅で描かれるため、このoffsetでは1px線のinline endがindicatorのinline startへ接する。

enhanced hoverとselectedの3px paintは`inset-inline-end: calc(var(--icon-xs) / 2 - 1px)`へ置く。
通常線の中心を維持したまま左右へ1pxずつ広がり、現在のObsidianではシェブロンSVGとの間に`1px`残る。

base ruleの`inset-inline-end: 0`はmobileとSource modeのfallbackとして維持する。
outer widget、collapse indicator、シェブロン、bullet halo、pointer領域、fold処理、marker同期、inner guideは変更しない。

## テスト

CSS contract testはdesktop Live Previewのnormal ruleが`--icon-xs / 2`を使い、hoverとselected ruleが同じ中心を保つ`--icon-xs / 2 - 1px`を使うことを固定する。
base fallbackと論理propertyの使用も維持する。

実Obsidianでは通常線が`x=68..69`、enhanced paintが`x=67..70`、シェブロンSVGが`x=71..81`になることを確認する。
通常とenhanced paintの中心はともに`x=68.5`であり、hover時のSVG gapは`1px`でなければならない。

## 完了条件

- desktop Live Previewのouter lineがシェブロンの直前へ移動する。
- 通常、hover、selectedの全状態で線が表示される。
- hoverとselectedのpaintがシェブロンSVGと交差しない。
- normal、hover、selectedで中心位置が変わらない。
- mobile、Source mode、シェブロン、halo、widget、fold action、selection同期は変わらない。


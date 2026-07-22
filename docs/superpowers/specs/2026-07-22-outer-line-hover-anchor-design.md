# Outer Line Native Grid Design

## 症状

desktopのouter lineは通常時には表示されるが、hoverすると消える環境があった。
通常線をouter widgetのinline endへ復元すると、Live Previewのシェブロンとouter lineが重なった。

実Obsidianではouter widgetが`x=40..76`、通常線が`x=75..76`、シェブロンSVGが`x=71..81`だった。
outer lineのinline endとfold indicatorの原点が同じ位置であるため、通常の1px線からシェブロンと交差していた。

## Native guideとの対応

Live Previewのnative inner guideは、indent spanのinline startから`--indentation-guide-editing-indent`だけ内側へ線を描く。
実測ではouter widgetのinline startが`x=40`、offsetが`13.6px`、最初のinner spanのinline startが`x=76`だった。
outer lineにも同じoffsetを使うと、outer lineは`x=53.6`、inner lineは`x=89.6`となり、widget幅と同じ36px間隔へ揃う。

## 設計

base ruleの`inset-inline-end: 0`はmobileとSource modeのfallbackとして維持する。
desktop Live Previewだけは、通常線を`inset-inline-start: var(--indentation-guide-editing-indent)`へ置き、inline endをautoにする。

enhanced hoverとselected stateでは、通常の1px線の中心を維持するため、同じoffsetから1px戻した位置へ3pxのbackground boxを置く。
active color、endpoint radius、線幅は変更しない。

シェブロン、bullet halo、outer widgetの位置と幅、pointer領域、chunk decoration、marker同期、fold処理は変更しない。
mobileとSource modeでは既存のinline-end geometryを維持する。

## テスト

CSS contract testは、base ruleのinline endを維持し、desktop Live Previewの通常線だけがnative editing offsetを使うことを確認する。
enhanced hoverとselected stateは`calc(var(--indentation-guide-editing-indent) - 1px)`を使い、inline endをautoにすることを確認する。

focused unit test、全unit test、lint、test buildをNode.js 22.23.1で実行する。
実Obsidianではrepositoryのtest vaultを使い、outer lineと最初のinner guideが36px離れ、シェブロンSVGとhover paintの間に正の空きがあることをcomputed styleと画面で確認する。

## 完了条件

- desktop Live Previewのouter lineが通常、hover、selectedの全状態で表示される。
- outer lineとシェブロンSVGが交差しない。
- outer lineと最初のnative inner guideが1 indent分離れる。
- hover前後でouter lineの中心位置が変わらない。
- シェブロン、halo、mobile、Source mode、inner guide、fold action、selection同期は変わらない。

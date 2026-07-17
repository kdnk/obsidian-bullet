# モバイル折りたたみコントロールの端寄せ設計

> [!NOTE]
> この文書の48px、`-35px`、13pxの配置は廃止されました。現行仕様は[モバイル折りたたみコントロールのヘッダー対称配置](./2026-07-17-mobile-fold-control-overflow-containment-design.md)を参照してください。

## 目的

モバイルのLive Previewで右側へ移したリストのシェブロンは、48px幅の操作領域の中央にあるため、アイコン本体がリスト行の右端から24px内側に見える。

Propertiesなどの左側にあるnativeシェブロンは、内容領域の左端からアイコン中心が約11px外側にある。

右側のリストシェブロンも、内容領域を基準として左右反転した位置へ移す。

## 配置

native `.collapse-indicator`の横幅は48pxのまま維持する。

縦幅は48pxやリスト行全体へ固定せず、1行分のline heightと上下のlist spacingを足した高さにする。

折り返した親項目では、シェブロンと操作領域を一緒に1行目へ揃える。

連続する通常行は約26pxの高さしかないため、48px四方へ広げると上下の操作領域が重なる。

コントロール全体を現在の位置から35px右へ移し、`inset-inline-end`を`-35px`にする。

この配置では、48px幅の中心にあるシェブロンがリスト行右端から11px外側へ出る。

左側のnativeシェブロンも内容領域左端から中心が約11px外側にあるため、両者は内容領域を基準として左右対称になる。

コントロールのうちリスト行内に残る幅は13pxである。

機能が有効なLive Previewの全リスト行へ`padding-inline-end: 13px`を適用し、本文と操作領域が重ならない範囲で本文幅を戻す。

fold indicatorの有無で余白を変えず、子項目の追加または削除による親項目の折り返し変化を防ぐ。

## 操作

シェブロンのSVGだけを動かさず、native `.collapse-indicator`の操作領域全体を移動する。

見えているアイコンとpointer targetの中心を一致させる。

native pointer event、fold transaction、scroll snapshot、展開時と折りたたみ時の向きは変更しない。

デスクトップ、閲覧モード、見出しのシェブロンには適用しない。

## 実装

`styles.css`のモバイル右端コントロール規則だけを変更する。

Obsidianの高詳細度selectorを上書きする現在のselectorは維持し、`padding-inline-end: 0`も維持する。

native `.collapse-indicator`の`height: 100%`は、`calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`で上書きする。

プラグイン独自のDOM、decoration、overlay、座標測定は追加しない。

既存の設計書と`AGENTS.md`にある「indicator右端とlist行右端の差を0にする」という条件は、新しい配置へ更新する。

## テスト

CSS contract testでは次を確認する。

- Live Previewの全リスト行の`padding-inline-end`が13pxである。
- native controlの`inset-inline-end`が`-35px`である。
- controlの横幅が48pxで、縦幅はnativeの1行目高である。
- controlの高さが1行分のline heightと上下のlist spacingの合計である。
- controlに`height: 100%`がない。
- アイコンだけを動かす追加transformがない。
- Live Previewのlist lineだけが対象である。

実Obsidianではモバイルemulation、390px幅、DPR 3、touch emulationを有効にし、次の実座標を確認する。

- controlの横幅が48pxである。
- control右端がlist行右端から35px外側にある。
- control左端がlist行右端から13px内側にある。
- listシェブロン中心がlist行右端から約11px外側にある。
- Propertiesのnativeシェブロン中心が内容領域左端から外側にある距離と、listシェブロンの距離がほぼ一致する。
- 長い本文が操作領域と重ならない。
- foldable行とnon-foldable行で同じ長文の折り返し位置が一致する。
- 折り返した親行ではcontrolの高さが行全体より小さく、1行目より下の右端をタップしてもfoldしない。

pointer tapでは既存の検証条件を維持し、foldとunfoldの両方でclicked rowの画面上Y座標差と`scrollTop`差が0であることを確認する。

## 完了条件

- モバイルのlistシェブロンが、左側のnativeヘッダーシェブロンを左右反転した位置に見える。
- 48px幅の操作領域とシェブロンが一体で移動する。
- 隣接する行の操作領域が上下に重ならない。
- 本文と操作領域が重ならない。
- 子項目の有無で親項目の本文幅が変わらない。
- 折り返した親項目ではシェブロンと操作領域が1行目に揃う。
- native foldingとscroll anchoringに回帰がない。

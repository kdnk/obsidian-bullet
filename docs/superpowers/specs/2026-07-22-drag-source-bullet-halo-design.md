# ドラッグ元バレットのハローとseparator位置

## 背景

ドラッグ中の移動元branchは、中立色の行背景で示されている。
しかし、leaf itemをドラッグするとfold状態の手掛かりがなく、どのバレットから操作を始めたかがbranch背景だけでは判別しにくい。

移動先の3px separatorは、現在の配置からわずかに上へ寄って見える。
この線はdrop候補の位置も表すため、見た目だけを直す変更がlist移動の判定へ影響してはならない。

## 表示契約

`Style list bullets`が有効なデスクトップのLive Previewでは、ドラッグ元itemの先頭行にあるunordered list bulletへ、既存と同じ18pxの薄いグレーhaloを表示する。
対象itemがleafでも、fold indicatorの有無に依存せずhaloを表示する。

移動元に子項目がある場合も、haloを表示するのはドラッグを開始したitemのバレットだけとする。
移動元branch全体の既存背景は維持するが、子項目のバレットへhaloを広げない。
ドラッグ終了、キャンセル、window closeでは、既存のdrag decoration cleanupと同時にhaloを取り除く。

ordered list marker、task checkbox、モバイル、Reading View、`Style list bullets`が無効な表示は変更しない。

移動先separatorは、現在の描画位置から2px下へ配置する。
drop候補の計算値、pointer座標との距離比較、semantic indent、幅、太さ、色は変更しない。

## 実装境界

ドラッグ開始effectは、移動元branchの各行offsetに加えて、ドラッグ元itemの先頭行offsetを渡す。
CodeMirrorのstate fieldは、先頭行へ既存の`bullet-plugin-dragging-line`と専用の`bullet-plugin-dragging-source-line`を付け、残りのbranch行へ既存classだけを付ける。
専用classは既存のstate fieldと`dndEnded`で管理し、新しいDOM参照やcleanup経路を増やさない。

CSSでは、既存のhover中とcollapsed中のhalo selectorへ、ドラッグ元の専用行selectorを加える。
haloの18px geometry、色、pointer event、transitionなしという契約を共有し、別のhalo描画を作らない。

separatorの2px補正は`drawDropZone()`で表示用`top`へだけ加える。
`DropVariant.top`はdrop候補の選択に使われるため変更しない。

## 検討した方式

### ドラッグ中の全行をCSSで対象にする

既存の`bullet-plugin-dragging-line`だけを使えるが、子項目を持つbranchでは全バレットがhaloになり、ドラッグ開始点を示せない。

### ドラッグ元行へ専用decorationを付ける

この方式を採用する。
CodeMirrorの仮想化に追従しつつ、移動元branchの背景と開始バレットのhaloを別の意味として保てる。

### ドラッグ開始時のDOM elementを保持する

対象バレットを直接特定できるが、CodeMirrorが行DOMを再生成すると参照が古くなる。
pop-out windowとcleanupにも追加状態が必要になるため採用しない。

separatorについては、候補計算の既存`-8px`補正を`-6px`へ変える案もある。
ただし、同じ`top`がpointerから最も近い候補の選択にも使われるため、見た目の修正がdrop判定を変えてしまう。
CSS transformは判定を保てるものの、elementの`top`と実描画位置が一致しなくなる。
描画時に2pxを加える方式なら、表示位置とDOM styleを一致させたままdrop判定を維持できる。

## テスト

unit testでは、drag開始effectがbranch全行と先頭行を区別して渡し、source decorationが先頭行だけへ付くことを確認する。
子項目を含むbranchの子行へsource classが付かないことも確認する。

CSS contract testでは、drag source selectorが既存のhover、collapsed selectorと同じhalo宣言を共有し、leafを除外するfold indicator条件を持たないことを確認する。
同じtestで、mobile、Reading View、設定無効時へ対象が広がらないことを確認する。

drop zoneのunit testでは、variantの`top`が120pxならelementへ122pxが設定され、left、width、DOM shapeが変わらないことを確認する。

実Obsidianでは、leafと子項目を持つitemをそれぞれドラッグする。
leafの元バレットに18px haloが出ること、branchでは先頭バレットだけがhaloになること、終了後にhaloが消えることを確認する。
separatorは変更前より2px下がり、sibling dropとnested dropの形、移動結果、pointerによる候補選択が維持されることを確認する。

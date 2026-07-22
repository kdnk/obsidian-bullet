# Logseqに合わせたhaloとシェブロンの間隔

## 背景

デスクトップのLive Previewでは、折りたたみ可能なリスト行のシェブロン中心とbullet中心が13.617px離れている。
この間隔は7pxのbulletを基準に決められたが、`Style list bullets`は折りたたみ中のbulletへ18pxのhaloを常時表示する。
10pxのシェブロンと18pxのhaloを現在の中心間隔へ当てはめると、両者は0.383px重なる。

Logseq 2.0.1は、シェブロン用コントロールとbullet haloに相当するcontainerを隣接する別要素として配置し、描画同士へ約2pxの空きを残している。

## 表示契約

対象は、`Style list bullets`が有効なデスクトップのLive Previewにある、折りたたみ可能なリスト行のネイティブシェブロンとする。

シェブロンの14px操作領域をinline-start側へ2px移し、`inset-inline-start`を`-7px`とする。
10pxのSVG、14pxの操作領域、18pxのhalo、7pxのbulletは変更しない。

既定テーマでのシェブロン中心とbullet中心の距離は約15.617pxとなり、シェブロンとhaloの描画間隔は約1.617pxになる。
実画面では小数pixelの丸めを考慮し、1.5px以上2.5px以下の空きを完了条件とする。

`Style list bullets`が無効な場合は、既存の`inset-inline-start: -5px`と中心間隔を維持する。
モバイル、Reading View、見出しのfold control、leaf行は変更しない。

## CSSの境界

既存のデスクトップ用シェブロンruleは、haloを持たない通常のbulletにも使われているため変更しない。
`body:not(.is-mobile).bullet-plugin-better-lists`へ限定したoverrideを追加し、同じネイティブ`.collapse-indicator`の`inset-inline-start`だけを`-7px`へ上書きする。

追加DOM、TypeScriptの状態、SVGのtransform、独立overlay、座標cache、animation、transitionは導入しない。
折りたたみは引き続きObsidianのネイティブcontrolとtransactionを使う。

## 操作との関係

シェブロンの14px操作領域を保つため、縦線操作が無効な場合のhit targetは縮小しない。
縦線操作が有効な場合も、既存どおり10pxのSVGだけをネイティブfoldingのtargetとし、操作領域の左右2pxは対応するguideへ渡す。

位置を2px移すことでguideとの重なり方は変わるため、rootと入れ子の両方で`elementFromPoint()`を再確認する。
シェブロン中央はネイティブSVG、左右の余白はguideを返す状態を維持する。

## 検討した方式

### `Style list bullets`に限定してシェブロンを移す

この方式を採用する。
haloが存在するときだけ間隔を広げ、設定無効時の既存配置を保てる。

### デスクトップの全シェブロンを移す

ruleは一つで済むが、haloがない通常のbulletまで中心間隔が変わる。
今回の違和感が発生しない表示へ変更を広げる理由がない。

### haloを縮める

シェブロンの位置を保てるが、折りたたみ状態とhover feedbackの18px表現が弱くなる。
前回確定したhaloの視認性を崩すため採用しない。

## 検証

CSS contract testでは、限定overrideがデスクトップのLive Preview、`bullet-plugin-better-lists`、折りたたみ可能なリスト行へだけ適用され、宣言が`inset-inline-start: -7px`だけであることを確認する。
既存testでは、設定に依存しないbase ruleが`-5px`、幅が14px、SVGが10pxのままであることを維持する。

実Obsidianではtest vaultを使い、rootと入れ子のfoldable行についてexpanded hover、collapsed pointer leave、collapsed hoverを確認する。
各状態でシェブロンとhaloの水平間隔が1.5px以上2.5px以下であり、haloとbulletの中心が一致することを測る。

シェブロンと縦線からfoldとunfoldを一度ずつ実行し、各操作で状態が一度だけ反転することを確認する。
設定無効時、leaf行、見出し、モバイルの右端fold controlには配置変更がないことも確認する。

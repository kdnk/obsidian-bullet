# Collapsed List Bullet Halo Design

## 背景

desktop Live Previewの折りたたみ可能なリスト丸印には、hover中だけ18pxの薄いグレーhaloが表示される。
一方、折りたたみ後はObsidianのaccent表現が現れ、同じ操作対象なのにhover前後で色の意味が変わって見える。

## 目的

折りたたみ中のリスト丸印へ、hover中と同じ薄いグレーhaloを常時表示する。
展開後は従来どおりhaloを消し、折りたたみ可能な丸印へhoverした間だけ表示する。

## 表示契約

対象は、`Style list bullets`が有効なdesktop Live Previewの折りたたみ可能なリスト丸印に限る。
hover中とcollapsed中は、同じ`::before`へ次の表現を適用する。

- haloは18px四方の円とする。
- haloは7pxの丸印を中心として配置する。
- 色は`color-mix(in srgb, var(--text-muted) 38%, transparent)`とする。
- animation、transition、outline、box-shadowは追加しない。
- haloはpointer eventを受け取らない。

collapsed中の中央の丸印は`var(--text-muted)`を維持し、native accentのbox-shadowは表示しない。
collapsed中にhoverしてもhaloを重ねたり、色や大きさを変えたりしない。

mobile、Reading View、折りたたみ不可能な丸印の表示は変更しない。

## 実装方針

既存のhover selectorとcollapsed selectorを一つのCSS ruleへまとめ、同じ`::before`宣言を共有する。
折りたたみ状態はObsidianが付与する`.is-collapsed`から判定できるため、TypeScriptの状態管理や追加DOMは導入しない。

既存のcollapsed `::after` ruleは、中央の丸印をグレーへ固定してnative accent shadowを消す役割として維持する。

## 検討した方式

### hoverとcollapsedで同じpseudo-elementを使う

これを採用する。
形、位置、色の宣言を共有でき、hoverとcollapsedの見た目がずれない。

### collapsedだけbox-shadowでhaloを描く

宣言は短いが、hoverの18px円とgeometryが異なり、theme側のnative shadowとも競合する。

### TypeScriptでcollapsed用classを管理する

DOMがすでに折りたたみ状態を公開しているため、状態同期とcleanupを増やす理由がない。

## 検証

CSS contract testでは、hover selectorとcollapsed selectorが同じ18pxのグレーhalo宣言を共有することを確認する。
同じtestで、対象がdesktop Live Previewへ限定され、mobileとReading Viewへhalo selectorが広がっていないことを確認する。
collapsed `::after`が中央の丸印へ`var(--text-muted)`と`box-shadow: none`を適用する既存契約も維持する。

実Obsidianではtest vaultを使い、折りたたみ可能な親項目についてhover、fold、pointer leave、unfoldを順に確認する。
fold後はpointer leave後もグレーhaloが残り、unfold後はhaloが消えることを確認する。

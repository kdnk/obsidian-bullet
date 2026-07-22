# Logseq風drag feedback設計

## 目的

drag中の画面を、Logseqと同じ情報構造へ揃える。

利用者へ示す状態を、移動中のbranchと移動後の挿入位置の二つに絞る。

list移動、drop候補の計算、pointer操作は変更しない。

## 比較結果

Logseqは、移動元blockを中立色の背景で示し、移動先を3pxの水平separatorで示す。

nested dropもseparatorの開始位置だけを内側へずらし、線の形や色は変えない。

現在のBulletは、accent色の移動元背景とseparatorに加えて、移動先の親行、separator端のmarker、nested dropの太線とhalo、親階層へ戻る点線も描く。

複数の強調が同時に現れるため、挿入位置より装飾の差へ注意が分散する。

## 選択肢

### 色だけを変更する

accent色を中立色へ変え、geometryと補助表示は残す。

変更は小さいが、親行、marker、halo、点線が残るためLogseqの情報構造とは一致しない。

### feedbackを二つへ絞る

移動元branchをObsidianの中立的なhover背景で示す。

移動先は`--text-muted`を使う3pxの水平separatorに統一する。

nested dropは既存のsemantic indent位置をseparatorの開始位置として使う。

親行の背景、separator端のmarker、nested drop専用の太線とhalo、親階層へ戻る点線は削除する。

この案を採用する。

### native drag imageを導入する

HTML Drag and Drop APIで移動branchのghostをpointerへ追従させる。

現在のmouse eventとCodeMirror transactionを使う実装から外れるうえ、複数行branch、fold、pop-out windowごとのdrag image生成が必要になる。

separatorの明瞭化だけで目的を満たせるため採用しない。

## 構造

`DragAndDrop`は各Documentに一つのdrop zone elementだけを作る。

drag planが選んだ`left`、`top`、editor右端までの`width`を、そのelementへ反映する。

移動先の親行をDecorationsで塗るstateと、indent幅をSVGの点線へ変換するchild elementは削除する。

移動元branchのline Decorationsは残し、CSSだけを中立色へ変更する。

## エラー処理

listを解析できない場合、編集内容がdrag中に変わった場合、drop候補がない場合の既存処理を維持する。

表示用elementはpop-out windowごとに作成し、window closeとfeature unloadで削除する。

## テスト

unit testで、各Documentにdrop zone elementが一つだけ作られることを確認する。

unit testで、inside dropでもvariant専用classやchild decorationを追加せず、semantic indent位置へ同じseparatorを描くことを確認する。

CSS contract testで、移動元が中立背景を使い、drop zoneが3pxの`--text-muted` separatorだけを描くことを確認する。

対象unit test、lint、buildをNode.js 22.23.1で実行する。

実Obsidianでは、sibling dropとnested dropでseparatorの形が同じであり、開始位置だけが変わることを確認する。

## 完了条件

- 移動元branchだけが中立色で強調される。
- 移動先は3pxの水平separatorだけで示される。
- sibling dropとnested dropはseparatorの開始位置だけが異なる。
- drag and dropの移動結果は変わらない。
- main windowとpop-out windowのcleanupが維持される。

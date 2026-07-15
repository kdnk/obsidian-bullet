# settings change設計

## 目的

設定変更のdependencyをsubscriber登録時に表し、同値更新と複数key更新による不要な処理を減らす。

永続化形式と設定画面の挙動は変更しない。

## settings change

settings changeは、実際に値が変わったkey集合を持つ。

単一keyのsetterは一件のsettings changeを通知する。

同じ値を設定した場合は保存前のmemory stateもsubscriberも変更しない。

resetは既定値との差分を集め、一回だけ通知する。

## subscription

subscriberは依存する永続化keyを登録する。

変更keyと依存keyが交差するときだけcallbackを実行する。

全設定を表示または記録するmoduleだけは全key subscriptionを使える。

unsubscribeはcallbackとdependencyを同時に除去する。

## 既存subscriber

VerticalLinesはlistLines、outerListLines、listLineActionに依存する。

BetterListsStylesはstyleListsに依存する。

VimOBehaviourOverrideはbetterVimOに依存する。

DragAndDropはdndに依存する。

SettingsTabは値を直接保存するためsubscriptionを追加しない。

## 互換性

既存の保存keyと公開getter名を維持する。

旧boolean形式のstickCursor migrationを維持する。

callbackの非同期実行は導入しない。

## テスト

- 同値更新でcallbackを呼ばない。
- 異なるkeyのsubscriberを呼ばない。
- 複数依存keyのうち一つが変われば一回呼ぶ。
- resetが変更keyをまとめて一回通知する。
- unsubscribe後は通知しない。
- 各featureが正しいkeyへ登録する。

## 完了条件

- subscriberのdependencyが登録箇所で読める。
- resetがkey数分の通知を行わない。
- 無関係な設定変更でVerticalLinesのmeasureをscheduleしない。
- 保存dataと設定画面に回帰がない。

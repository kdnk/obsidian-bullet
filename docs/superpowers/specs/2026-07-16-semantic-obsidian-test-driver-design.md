# semantic Obsidian test driver設計

## 目的

integration specがWebSocket command名とrenderer実装の重複を管理せず、利用者操作としてObsidianを制御できるようにする。

最初の追加操作として、縦線ガイドのクリックを自動化する。

## 現状

command名はrendererのmessage unionとswitch、Jest environmentのglobal登録、Markdown transformerのcode generation、global型定義に重複している。

新しい操作を追加すると複数fileを同時に変更する必要がある。

縦線ガイドの検証はunit testのmock eventに限られ、実Obsidian DOMへ完全なpointer sequenceを送れない。

## Node側driver

Node側にsemantic driver moduleを追加する。

Jest environmentはtransportを初期化し、driverが公開する操作だけをglobalへ登録する。

driverはcommandの組み立てとresponse errorの変換を担当する。

Markdown transformerはdriverの操作名を生成するが、WebSocketの接続とcallback管理を持たない。

## renderer側registry

renderer側はmessage typeのswitchをhandler registryへ置き換える。

registry keyをcommand名のsource of truthとし、unknown commandはerror responseを返す。

各handlerは受信dataを検証してから既存のeditor操作を呼ぶ。

## ガイド操作

ガイド操作は対象行、guide種別、raw indent prefixを受け取る。

outer guideではraw indent prefixを使わない。

rendererは対象行のfresh DOMを取得し、条件に一致する表示中segmentを解決する。

対象を解決できない場合は、行番号と候補数を含むerrorを返す。

対象へmousedown、mouseup、clickを同じ座標で順に送る。

各eventはbubbleとcancelを有効にする。

操作後は既存のidle判定を再利用する。

## Markdown spec

Markdown actionへclickGuideを追加する。

dataはJSONで記述し、indent guideとouter guideを同じactionで扱う。

fold結果は既存のassertStateで検証する。

最初のspecは保存済みfoldを再度開き、markerがraw textとして残らないことを検証する。

## エラー処理

unknown command、invalid data、対象DOMなしはtest failureにする。

transport切断とrenderer errorを同じmessageへ潰さず、原因を区別する。

## テスト

- Node driverがcommand名とdataをtransportへ渡す。
- renderer registryがhandlerを一回だけ実行する。
- unknown commandがerrorになる。
- guide resolverがraw indent prefixでsegmentを選ぶ。
- pointer sequenceがmousedown、mouseup、clickの順になる。
- Markdown transformerがclickGuide actionを生成する。
- 実Obsidianでindent guideのfoldとunfoldを検証する。

## 完了条件

- command追加時にNode側の登録列挙を編集しない。
- renderer dispatchにswitchを使わない。
- integration specから縦線ガイドをクリックできる。
- 既存の全integration actionを維持する。

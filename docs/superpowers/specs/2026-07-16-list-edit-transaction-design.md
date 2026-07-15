# リスト編集トランザクション設計

## 目的

featureへ漏れているparse、operation lifecycle、差分適用、outcome判定を一つのmoduleへ集約する。

リスト編集operation自体の挙動は変更しない。

## transaction

リスト編集トランザクションは次の順で処理する。

1. Editor adapterから対象リスト文書を解析する。
2. 変更前のリスト文書をcloneする。
3. operationを一回だけ実行する。
4. operation outcomeが更新を要求するときだけ差分を適用する。
5. eventを消費するかをoutcomeとして返す。

対象リスト文書がない場合はno-op outcomeを返す。

operationを作れないguard条件でもno-op outcomeを返す。

## operation outcome

operationは実行後のmutable getterを公開せず、実行結果としてoutcomeを返す。

outcomeは更新有無とevent消費有無を持つ。

transactionはoperationを二回評価しない。

## feature adapter

featureはkeymap、command、IME、Obsidian設定の判定を担当する。

parse結果に依存するguardはtransactionへ渡すoperation factory内で判定する。

Tab、Shift-Tab、Enter、selection recoveryからParserの直接依存を段階的に除去する。

drag and dropのように開始時点のリスト文書を保持する操作は、既存文書を受け取るtransaction pathを使う。

## Root interface

この段階ではRootとListの構造変更を行わない。

featureからRootが見える範囲だけを減らし、operation implementationは既存interfaceを使う。

Rootのmutation interface縮小は別の変更として扱う。

## テスト

- transactionがoperationを一回だけ実行する。
- no rootとno operationでno-op outcomeを返す。
- update outcomeのときだけChangesApplicatorを呼ぶ。
- event消費だけを要求するoperationを維持する。
- 各operation testをreturn outcomeへ移行する。
- feature testでParser mockとeval直呼びへの依存を減らす。
- 既存integration specをすべて維持する。

## 完了条件

- Operationのmutable outcome getterを削除する。
- transactionがparseからdiff適用までを所有する。
- common featureがParserとtransactionの両方を組み立てない。
- operationを二回評価しない。

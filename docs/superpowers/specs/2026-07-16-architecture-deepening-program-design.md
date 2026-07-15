# アーキテクチャ改善プログラム設計

## 目的

直近の不具合が集中した縦線ガイドと、その変更を支えるintegration test seamを先に深くする。

その後、リスト編集、drag measurement、settings changeの順にmoduleのlocalityを高める。

すべての段階で利用者向け挙動を維持する。

## 対象

改善対象は次の五つである。

1. semantic Obsidian test driver
2. ガイド折りたたみ操作
3. リスト編集トランザクション
4. drag measurement
5. settings change

各対象は独立したspec、plan、commitを持つ。

後続段階で問題が見つかった場合でも、通過済みの前段階をrevertせずに原因を切り分けられる構成にする。

## 比較した進め方

### 基盤から順に変更する

test driverを先に変更し、ガイドの実DOM操作を自動化してからproduction moduleを変更する。

共有fileの変更時期が分かれ、各段階の回帰を直前のtest surfaceで検出できる。

この進め方を採用する。

### 五件を並行して変更する

所要時間を短縮できる可能性はある。

ただし、VerticalLines、Settings、test harnessを複数段階が共有するため、同じfileの編集と失敗原因が重なる。

### 局所的な修正だけを行う

差分は最小になる。

しかし、現在のshallow moduleと重複したprotocolを残すため、今回の目的を満たさない。

## 実施順序

### semantic Obsidian test driver

renderer側のcommand dispatchとNode側のtest操作を、それぞれ一つのregistryへ集約する。

縦線ガイドへ完全なpointer sequenceを送るsemantic actionを追加する。

### ガイド折りたたみ操作

inner guideとouter guideのtarget解決、hover同期、fold planning、scroll-preserving dispatchを一つのdeep moduleへ集約する。

VerticalLines featureはbody classとCodeMirror extension登録だけを担当する。

### リスト編集トランザクション

parse、operation実行、差分適用、outcome決定を一つのmoduleへ集約する。

featureからParserとoperation lifecycleの知識を減らす。

### drag measurement

一つのcallerしか持たないmeasurement moduleをDragAndDrop implementationへ戻す。

measurement単体ではなくdrag planをtest surfaceにする。

### settings change

同値更新を通知せず、複数keyの更新を一回へまとめる。

subscriberは依存するkeyだけを登録する。

## 検証

各段階でunit testとlintを実行する。

srcを変更した後のintegration testは、先にnpm run build-with-testsを実行する。

full test前にvault/test.mdをvault外へbackupし、renderer終了後にrestoreとhash確認を行う。

ガイド変更後は、リポジトリ内のvaultを実Obsidianで開き、上端と下端を含む長い多段リストを確認する。

## 完了条件

- 五つのsubprojectが個別のtestを持つ。
- unit test、lint、full testがすべて通る。
- ガイド操作は実Obsidian integration specで開閉できる。
- dist/main.jsは追跡しない。
- 各commitは単独で目的と変更内容を説明できる。

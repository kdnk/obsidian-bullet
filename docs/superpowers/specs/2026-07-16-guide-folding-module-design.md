# ガイド折りたたみmodule設計

## 目的

ガイド折りたたみ操作のtarget解決、hover同期、fold transactionを一つのdeep moduleへ集約する。

既存の表示と開閉挙動は変更しない。

## moduleの責務

新しいguide folding moduleは次を担当する。

- inner guideとouter guideのDOM target解決
- raw indent prefixとlist ancestorの対応付け
- outer list chunkの検出とdecoration
- 同じ実リスト祖先またはchunkに属するhover segmentの同期
- child branchのfold planning
- selection退避とscroll snapshotを含む一括transaction
- event listenerと一時classのcleanup

VerticalLines featureはbody class、設定に応じたextension配列、ViewPlugin登録だけを担当する。

## CodeMirror adapter

ガイド専用のscroll-preserving fold処理は、汎用MyEditor interfaceからguide folding moduleへ移す。

通常のchevron、fold command、ChangesApplicatorが使うfold処理はMyEditorに残す。

guide folding moduleはEditorViewからfold rangeを解決し、一回のtransactionをdispatchする。

scrollPastEndの有効化はVerticalLines featureが保持する。

実DOMのpadding復元はguide folding actionの直前だけに実行する。

## inner guide

クリックsegmentより前にある同じindent containerのtextをraw indent prefixとする。

一致する実リスト祖先がない場合は操作を無視する。

対象祖先の直下にある空でないchildだけを開閉する。

## outer guide

chunkは文書位置で識別する。

DOM属性は入力として信用せず、現在の文書を再解析して一致を確認する。

空行、空白だけの行、見出し、通常段落でchunkを分割する既存仕様を維持する。

## hover

hover対象はclick時と同じresolverで決める。

CodeMirrorのmeasure read phaseで対象segmentを収集し、write phaseでclassを同期する。

pointer leave、設定無効化、ViewPlugin destroy時にclassを除去する。

## module interface

production callerが使うinterfaceはViewPlugin valueのlifecycleとdecorationだけに絞る。

target resolverやfold plannerはmodule内のimplementationとして保持する。

testは公開interfaceからevent、decoration、transactionを観測する。

## テスト

- inner guideとouter guideの全既存unit testを新しいmoduleのtestへ移す。
- MyEditorから移したscroll anchor testをguide folding moduleで維持する。
- publicでなくなるhelperのtestは、同じ挙動を公開interface経由で検証する。
- semantic Obsidian test driverでfold、unfold、native marker、scroll位置を検証する。

## 完了条件

- OuterListGuide helper bagを削除する。
- MyEditorがguide専用fold interfaceを公開しない。
- VerticalLines featureがtarget解決とfold planningを行わない。
- unit testと実Obsidian integration testが既存挙動を維持する。

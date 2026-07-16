# モバイル右端折りたたみコントロール設計

## 目的

モバイルのLive Previewでは、深くインデントされたリストの左側にある折りたたみコントロールをタップしにくい。

折りたたみ可能な各リスト行の右端へObsidian標準のコントロールを移し、ネストの深さにかかわらず同じ場所から操作できるようにする。

## 対象範囲

この機能はモバイルのLive Previewだけを変更する。

デスクトップ、閲覧モード、見出しの折りたたみコントロールは変更しない。

縦線の表示設定と縦線クリックによる折りたたみ設定には依存しない。

右端コントロールを無効にしたときは、プラグインが追加した配置と向きの変更をすべて解除し、既存の表示へ戻す。

## 設定

設定画面へ `Show fold controls on the right on mobile` を追加する。

説明は `Move fold controls to the right edge in Live Preview on mobile.` とする。

保存値はbooleanとし、初期値を`true`にする。

この設定が存在しない旧バージョンの保存データを読み込んだときも、有効な状態で開始する。

設定変更は保存直後に開いているエディタへ反映する。

## 表示と操作

折りたたみ可能な各リスト行には、右端へ一つだけコントロールを表示する。

左側へ別のコントロールを残さず、同じnative `.collapse-indicator`を右端へ移動する。

展開中のアイコンは下向き、折りたたみ中のアイコンは左向きにする。

コントロールの横幅は48pxとし、行の高さ全体をタップ領域にする。

折りたたみ可能な行だけ本文の右側へ同じ48pxの余白を確保し、長い本文とコントロールが重ならないようにする。

タップ時はObsidian標準のシェブロンと同じ処理を使い、その行の子孫全体を開閉する。

独自のfold transaction、イベントハンドラー、遅延処理は追加しない。

## 実装構成

`MobileRightFoldControls`を独立したFeatureとして追加する。

このFeatureは設定変更を購読し、モバイルかつ設定が有効なときだけ`bullet-plugin-mobile-right-fold-controls` body classをmain documentとpop-out documentへ付ける。

body classの管理には既存の`DocumentBodyClass`を再利用する。

CSSはbody class配下の`.markdown-source-view.mod-cm6 .HyperMD-list-line`へ限定する。

`.cm-line`はObsidianが`position: relative`にしているため、`.cm-fold-indicator`を`position: static`へ変更し、内側のnative `.collapse-indicator`をリスト行の右端へabsolute配置する。

独自DOM、decoration、overlay、画面座標の測定、スクロール同期は追加しない。

## 縦線機能との優先関係

縦線による折りたたみが有効なとき、既存CSSはnative list chevronへ`visibility: hidden`と`pointer-events: none`を適用する。

モバイル右端コントロールが有効なときは、後続の同等以上の詳細度を持つselectorで`visibility: visible`と`pointer-events: auto`を復元する。

この優先関係により、縦線設定の状態にかかわらず右端コントロールを表示して操作できる。

モバイル右端コントロールを無効にしたときは、この上書きを解除し、縦線機能を含む既存設定の表示規則へ戻す。

## 例外と後始末

折りたたみ対象を持たずnative `.cm-fold-indicator`がない行には、コントロールも右側余白も追加しない。

Featureのunload時には設定購読を解除し、すべての管理対象documentからbody classを除去する。

モバイル判定または設定が無効な場合、Featureはbody classを付けない。

## テスト

Settingsのunit testでは、旧保存データから読み込んだときに新設定が`true`になること、setterが変更通知を発行することを確認する。

SettingsTabのunit testでは、設定名、説明、初期状態、切り替え後の保存を確認する。

Featureのunit testでは、モバイルでのbody class追加、設定を無効にしたときの除去、デスクトップで追加しないこと、pop-out documentとunloadの後始末を確認する。

CSS contract testでは、Live Previewのlist lineだけを対象にすること、native indicatorを右端へ配置すること、48pxの操作領域と本文余白を確保すること、折りたたみ中を左向きにすること、縦線機能の非表示指定を上書きすることを確認する。

既存のunit test、lint、型検査、build、full testを実行する。

実Obsidianではリポジトリ内の`vault`だけを使い、モバイルbody classを一時的に再現して展開中と折りたたみ中の位置、向き、タップ動作、長い行の折り返し、縦線設定との組み合わせを確認する。

## 完了条件

- モバイルのLive Previewで、折りたたみ可能な各リスト行の右端に一つだけコントロールが表示される。
- 展開中は下向き、折りたたみ中は左向きになる。
- 右端のコントロールがObsidian標準と同じ単一リスト折りたたみ動作を行う。
- 長い本文がコントロールと重ならない。
- 新設定はデフォルトで有効になり、無効化すると既存表示へ戻る。
- デスクトップ、閲覧モード、見出し、縦線の折りたたみ動作に回帰がない。

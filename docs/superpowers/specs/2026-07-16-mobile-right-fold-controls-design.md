# モバイル右端折りたたみコントロール設計

## 目的

モバイルのLive Previewでは、深くインデントされたリストの左側にある折りたたみコントロールをタップしにくい。

折りたたみ可能な各リスト行の右端へObsidian標準のコントロールを移し、ネストの深さにかかわらず同じ場所から操作できるようにする。

## 対象範囲

この機能はモバイルのLive Previewだけを変更する。

見出しのnative折りたたみコントロールも、同じ右端へ移動する。

デスクトップ、閲覧モード、Propertiesの折りたたみコントロールは変更しない。

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

コントロールの横幅は48pxとする。

Obsidianのnative `height: 100%`は、1行分のline heightと上下のlist spacingを足した高さで上書きする。

折り返した親項目でも、シェブロンとタップ領域を一緒に1行目へ揃える。

48px幅のコントロール全体をリスト行右端から35px外側へ出し、中心のシェブロンを右端から11px外側へ置く。

この位置は、内容領域左端から約11px外側にあるPropertiesなどのnativeシェブロンを左右反転した位置である。

コントロールのうち行内に残る13pxを、機能が有効なLive Previewの全リスト行で本文の右側余白として確保する。

fold indicatorの有無で余白を変えず、子項目を追加または削除しても親項目の本文幅と折り返し位置を維持する。

見出しではnative `.cm-fold-indicator`を`position: static`へ変更し、内側の`.collapse-indicator`を15px幅、`inset-inline-end: -15px`、`height: 1lh`で右端へ配置する。

折りたたみ中の見出しシェブロンは`rotate(90deg)`で左を向き、展開中は下を向く。

タップ時はObsidian標準のシェブロンと同じ処理を使い、その行の子孫全体を開閉する。

native fold transactionは置き換えず、preventまたはstopしない。

## スクロール位置

文末付近のbranchを開閉しても、clicked bulletとそれより上の表示位置を維持する。

ObsidianはMarkdown editorを開いた後にCodeMirrorの下端余白を`100px`へ上書きするため、そのままbranchを閉じると最大`scrollTop`へclampされる。

ただし、下端余白の復元だけではモバイルの上端付近を固定できない。

CodeMirrorはnative fold transactionでviewport anchorを自動選択する。

clicked bulletがmobile header付近にある場合、その直下のchildがanchorになり、foldによってanchor自体が消えるためclicked bulletが下へ移動する。

mobile controlの`pointerdown` capture時に、実DOMの下端余白がCodeMirror標準の計算値より小さい場合だけ復元する。

余白の変更後は`scrollDOM.scrollHeight`を読み、native click handlerがdocument heightを変える前にlayoutへ反映する。

`mousedown`はObsidian側で`contentDOM`より前に止まるため主経路に使わない。

`click` captureでも同じ準備を行い、keyboardまたはprogrammatic clickのfallbackとする。

`click` captureでは、実viewport上端へanchorを補正した`scrollSnapshot()`も準備する。

Obsidianのnative handlerはclick後のmicrotaskでfoldをdispatchするため、pending snapshotはmicrotaskを越えて保持する。

CodeMirrorのtransaction extenderは、次のnative `foldEffect`または`unfoldEffect`と同じtransactionへpending snapshotを追加する。

この処理はnative clickを消費せず、独自のfold effect、手動の`scrollTop`復元、遅延したscroll補正を追加しない。

## 実装構成

`MobileRightFoldControls`を独立したFeatureとして追加する。

このFeatureは設定変更を購読し、モバイルかつ設定が有効なときだけ`bullet-plugin-mobile-right-fold-controls` body classをmain documentとpop-out documentへ付ける。

body classの管理には既存の`DocumentBodyClass`を再利用する。

同じFeatureがCodeMirror ViewPluginを登録し、mobile body class配下のnative list controlに対する`pointerdown`と`click`をcapture phaseで観測する。

同じFeatureはtransaction extenderも登録し、native fold transactionへpending snapshotを追加する。

下端余白の計算、実viewport上端へのanchor補正、物理pixel単位へのmargin正規化は、縦線操作とmobile controlが共有する`FoldScroll` moduleへ置く。

CSSはbody class配下の`.markdown-source-view.mod-cm6 .HyperMD-list-line`へ限定する。

`.cm-line`はObsidianが`position: relative`にしているため、`.cm-fold-indicator`を`position: static`へ変更し、内側のnative `.collapse-indicator`を`inset-inline-end: -35px`で配置する。

pluginはnative `.collapse-indicator`の`height: 100%`を、`calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`で上書きする。

独自DOM、decoration、overlay、画面座標の測定、native transactionの置換は追加しない。

## 縦線機能との優先関係

縦線による折りたたみが有効なとき、既存CSSはnative list chevronへ`visibility: hidden`と`pointer-events: none`を適用する。

モバイル右端コントロールが有効なときは、後続の同等以上の詳細度を持つselectorで`visibility: visible`と`pointer-events: auto`を復元する。

この優先関係により、縦線設定の状態にかかわらず右端コントロールを表示して操作できる。

モバイル右端コントロールを無効にしたときは、この上書きを解除し、縦線機能を含む既存設定の表示規則へ戻す。

## 例外と後始末

折りたたみ対象を持たずnative `.cm-fold-indicator`がない行には、コントロールも右側余白も追加しない。

Featureのunload時には設定購読を解除し、すべての管理対象documentからbody classを除去し、ViewPluginのcapture listenerを解除する。

モバイル判定または設定が無効な場合、Featureはbody classを付けない。

## テスト

Settingsのunit testでは、旧保存データから読み込んだときに新設定が`true`になること、setterが変更通知を発行することを確認する。

SettingsTabのunit testでは、設定名、説明、初期状態、切り替え後の保存を確認する。

Featureのunit testでは、モバイルでのbody class追加、設定を無効にしたときの除去、デスクトップで追加しないこと、pop-out documentとunloadの後始末を確認する。

native interactionのunit testでは、mobile body class内のlist controlだけが`pointerdown`時に不足した下端余白を復元すること、layoutを確定すること、eventを消費しないこと、destroy時にlistenerを解除することを確認する。

native transactionのunit testでは、clickとnative dispatchの間にmicrotaskがあっても、補正済みsnapshotがfoldとunfoldの各transactionへ追加されることを確認する。

CSS contract testでは、Live Previewの全list lineへ13pxの本文余白を確保すること、native indicatorを行の右端から35px外側へ配置すること、横幅48pxと1行目高の計算式を持つこと、折りたたみ中を左向きにすること、縦線機能の非表示指定を上書きすることを確認する。

既存のunit test、lint、型検査、build、full testを実行する。

実Obsidianではリポジトリ内の`vault`だけを使い、DevTools Console相当から`app.emulateMobile(true)`を実行する。

続けてDevice Toolbar相当でviewport、DPR、touch emulationを設定し、`pointerType="touch"`のtapで展開中と折りたたみ中の位置、向き、タップ動作、長い行の折り返し、縦線設定との組み合わせを確認する。

同じ長文を持つfoldable行とnon-foldable行の折り返し位置が一致し、折り返した親行の1行目より下にある右端をタップしてもfoldしないことを確認する。

mobile body classを手動で付けるだけの検証は、Obsidian内部のmobile behaviorを再現しないため完了条件に使わない。

文末の長いbranchでは、実DOMの下端余白を`100px`へ戻してから`pointerdown`、`pointerup`、`click`を実行し、foldとunfoldの両方でclicked rowの画面上Y座標差と`scrollTop`差が0であることを確認する。

clicked rowはviewport上端から100px、160px、400pxに置き、child数とbranch後続行の有無を変えて確認する。

## 完了条件

- モバイルのLive Previewで、折りたたみ可能な各リスト行の右端から35px外側に一つだけコントロールが表示される。
- 展開中は下向き、折りたたみ中は左向きになる。
- 右端のコントロールがObsidian標準と同じ単一リスト折りたたみ動作を行う。
- 長い本文がコントロールと重ならない。
- 子項目の有無によって親項目の本文幅と折り返し位置が変わらない。
- 折り返した親項目では、シェブロンとタップ領域が1行目にだけ配置される。
- 文末branchのfoldとunfoldで、clicked bulletとそれより上の表示位置が動かない。
- 新設定はデフォルトで有効になり、無効化すると既存表示へ戻る。
- モバイルのLive Previewで、見出しとリストのnative controlが同じ右端に並ぶ。
- デスクトップ、閲覧モード、Properties、縦線の折りたたみ動作に回帰がない。

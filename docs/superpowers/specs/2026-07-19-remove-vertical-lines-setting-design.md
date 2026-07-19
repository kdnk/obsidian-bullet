# 縦線表示設定の廃止設計

## 背景

通常のインデントガイドは、Bulletが独自に描画する線ではなく、Obsidianの`.cm-indent::before`を使っている。

それにもかかわらず、「Draw vertical indentation lines」は通常線の表示設定に見える。
実際には、完全に折りたたんだ親のガイドを残す処理、縦線クリックによる折りたたみ、最外線の表示をまとめて無効にする親ゲートとして働いている。

この構造では、「Fold lists from vertical indentation lines」や「Draw outer list lines」がオンでも、別グループにある親設定がオフなら動作しない。
設定画面が示す状態と実際の動作が一致していない。

## 決定

「Draw vertical indentation lines」を設定画面と永続化モデルから削除する。

Obsidianが描画する通常のインデントガイドは、Obsidian自身の設定と描画規則だけに従う。
Bulletは通常線を表示または非表示にする設定を持たない。

Bullet固有の二つの責務は、既存の直接的な設定へ分離する。

- **縦線からの折りたたみ**：`listLineAction === "toggle-folding"`のときだけ、クリック処理、hover表示、chevron非表示、scroll余白、persistent guideを有効にする。
- **最外線**：`outerListLines === true`のときだけ表示する。クリックとhoverは、`listLineAction === "toggle-folding"`のときだけ有効にする。

persistent guideは、全child branchを閉じたあとも同じ縦線から再展開するための操作対象である。
表示機能として常時有効にせず、縦線からの折りたたみが有効なときにだけ`.cm-indent-spacing`を`.cm-indent`へ昇格する。

## 設定モデルと移行

`SettingsObject`、既定値、getter、setterから`listLines`と`verticalLines`を削除する。
設定画面の`verticalLines` controlも削除する。

保存済みデータに`listLines`が残っていても、次回保存時には除去する。

旧設定が`listLines: false`だった利用者については、現在の実効状態を保つ。
読込時に`outerListLines`を`false`、`listLineAction`を`"none"`へ移行する。
旧設定が`true`または未保存なら、二つの直接設定をそのまま使う。

この移行により、以前に縦線機能全体を無効化した利用者へ、最外線やクリック操作が突然再表示されることを防ぐ。
Obsidian自身の通常線は、移行前と同じくBulletの設定対象にはならない。

## 実装境界

`VerticalLines`は、折りたたみaction用body classとCodeMirror extensionだけを管理する。
通常表示用の`bullet-plugin-vertical-lines` body classは削除する。

`GuideFoldingPluginValue`は、`outerListLines`と`listLineAction`だけを購読する。
ネストガイドの操作可否とpersistent guideは`listLineAction`から、outer decorationは`outerListLines`から判定する。

outer guideの通常スタイルは、body classを前提にせずwidget classへ直接適用する。
persistent guideのlayout補正は、plugin markerへ直接限定する。
hover、pointer、chevron非表示は、引き続きaction用body classの配下に限定する。

`VerticalLines`というクラス名とファイル名は、今回の変更では維持する。
この機能は縦線操作とouter guideをまとめるCodeMirror integrationとしてまだ使われており、名称変更は利用者の問題を解決しないためである。

## 文書

READMEの設定一覧から「Draw vertical indentation lines」を削除する。
「Draw outer list lines」はBulletが追加する線であり、設定として残す。
互換性の説明では、通常のインデントガイドをBulletが描画するとは記載しない。

## テスト

自動テストでは次を確認する。

- 設定一覧とlegacy display fallbackに「Draw vertical indentation lines」が存在しない。
- `SettingsObject`の保存値に`listLines`が残らない。
- 旧`listLines: false`を読み込むと、outer lineと縦線クリックが無効へ移行する。
- 縦線クリックとpersistent guideは`listLineAction`だけで有効または無効になる。
- outer decorationは`outerListLines`だけで表示または非表示になる。
- outer lineの表示は、縦線クリックが無効でも維持される。
- action用body classと`scrollPastEnd()`は`listLineAction`だけに従う。
- CSSが通常のObsidian guideの位置、太さ、色を上書きしない。

設定、縦線機能、GuideFoldingの対象unit testをNode.js 22.23.1で実行する。
その後、build、全unit test、lintを同じruntimeで実行する。

## 対象外

Obsidian本体のインデントガイド設定をBulletから変更しない。
outer guideの見た目や折りたたみ動作は変更しない。
保存済みfoldの形式、mobile右端control、通常chevronの動作は変更しない。

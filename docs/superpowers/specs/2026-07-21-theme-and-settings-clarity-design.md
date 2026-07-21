# テーマ対応と編集設定の明確化設計

## 調査結果

`Keep body text in bullets`と`Stick the cursor to the content`は、似た言葉で別の状態を扱っている。

前者は直接入力や削除による文書変更を補正し、通常本文をlist itemまたはcontinuation lineへ所属させる。

後者はnavigationまたはclick後の単一caretだけをMarkdown markerの外へ戻し、文書の文字列を変更しない。

`BulletTypingGuard`のcontract testも、本文補正がcaret設定の値に依存しないことを固定している。

一方、`Improve the style of your lists`には過去の制約が残っている。

現在のCSSは`--text-muted`などactive themeの変数を使うが、`BetterListsStyles`はcustom themeを検出するとbody classを外しているため、設定画面とREADMEにある「default themeだけ」という説明どおり実際にも無効になる。

## 検討した案

### Caret設定を削除する

設定画面は短くなるが、bullet、number、checkboxのraw marker内へ通常操作でcaretを置きたい利用者が既存の選択肢を失う。

保存済みの`stickCursor`値も意味を失うため、採用しない。

### 二つの編集設定を統合する

文書補正とcaret補正の組み合わせを一つのcontrolで表せるが、独立した二軸から複数の複合optionが生まれる。

一方だけを使う意図が読みにくくなるため、採用しない。

### 独立性が分かる名前と順序へ直す

本文補正を先に置き、caret補正を次に置く。

名前、説明、dropdown optionの語彙を`typed text`、`cursor`、`markers`へ分け、片方は文書、もう片方はcaretだけを変えると説明する。

保存key、初期値、runtime contractを維持できるため、この案を採用する。

## 設定画面

Editing groupの先頭二項目を次の順序とcopyにする。

1. `Keep typed text in lists`
   直接入力された通常本文をlist itemまたはcontinuation lineへ所属させるtoggleである。
   Markdown structure、paste、drop、external changeを対象外とする現在の境界も説明する。
2. `Keep cursor out of list markers`
   navigationまたはclick後のcaretをbullet、number、checkbox prefixの外へ戻すdropdownである。
   文書文字列を変更しないことと、`Alt`または`Option`による一時解除を説明する。

Caret dropdownは次の表示名にする。

- `Allow cursor in markers`
- `Keep out of bullets`
- `Keep out of bullets and checkboxes`

Appearance groupの`Improve the style of your lists`は`Style list bullets`へ改名する。

説明はlist-marker spacing、larger dots、parent-item hover feedbackを対象として挙げ、色がactive Obsidian themeへ追従すると伝える。

## テーマ対応

`BetterListsStyles`は`betterListsStyles`の値だけでbody classを管理する。

Custom theme判定と、判定のためだけに使っていた`css-change` listenerを削除する。

その結果、設定が有効ならmain windowとpop-out windowの両方で同じclassを適用し、themeの切替後もCSS custom propertyを通じて現在の色へ追従する。

ほかのfeatureが利用していない`ObsidianSettings.isDefaultThemeEnabled()`も削除し、plugin wiringから`BetterListsStyles`への不要な依存を外す。

## README

Settings表では新しい三つの設定名と効果を使う。

Caret feature節も新しい名前とdropdown optionへ合わせる。

Appearanceの説明からdefault theme限定表現を除き、active themeの色を利用すると記す。

Compatibility節にあるdefault theme限定の箇条書きは削除する。

過去のrelease時点を記録する`CHANGELOG.md`と既存design documentは、履歴として書き換えない。

## テスト

- Custom themeを表すObsidian設定でも`bullet-plugin-better-lists`が付くことをunit testで確認する。
- `BetterListsStyles`がtheme serviceと`css-change` eventへ依存しないことを確認する。
- 宣言的設定定義と旧版fallbackの両方で、新しい名前、説明、順序、dropdown optionを確認する。
- `BulletTypingGuard`の既存独立性testと`KeepCursorWithinListContent`の既存operation testを維持する。
- Node.js 22.23.1でunit test、full test、type check、lint、test buildを実行する。

## 完了条件

- List stylingを有効にすると、default themeかcustom themeかにかかわらずbody classが付く。
- 現在のuser-facing copyにdefault theme限定の説明が残らない。
- 本文補正とcaret補正が別の設定である理由を、設定画面だけで判別できる。
- 保存済み設定、初期値、各編集featureのruntime behaviorは変わらない。

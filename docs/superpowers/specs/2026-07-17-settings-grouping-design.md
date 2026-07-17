# 設定項目のグループ化設計

## 目的

設定画面の12項目を用途別の4グループへ分け、目的の設定を見つけやすくする。

すべてのグループは同じ設定画面に見出し付きで表示する。

設定名、説明、保存key、初期値、変更時の処理は維持する。

## グループ構成

### Editing

- Stick the cursor to the content
- Enhance the Tab key
- Enhance the Enter key
- Vim-mode o/O inserts bullets
- Enhance the Ctrl+A or Cmd+A behavior
- Drag-and-Drop

### Appearance

- Improve the style of your lists
- Draw vertical indentation lines
- Draw outer list lines

### Folding

- Fold lists from vertical indentation lines
- Show fold controls on the right on mobile

### Advanced

- Debug mode

グループと項目はこの順序で表示する。

## 定義構造

設定項目の定義を、見出しと項目配列を持つ共通のグループ定義へまとめる。

Obsidian 1.13以降の宣言的設定画面では、各定義を`type: "group"`の`SettingDefinitionGroup`として返す。

旧版向けの`display()`も同じグループ定義を走査し、各グループの先頭へ`Setting.setHeading()`による見出しを追加してから設定行を描画する。

設定行を描画する処理は補助methodへ分離し、dropdownとtoggleの値取得、変更通知、保存処理を一箇所に保つ。

二つの表示経路が同じ定義を参照するため、項目の追加や移動で見出しと表示順が食い違わない。

## 設定値とエラー処理

設定値の取得と更新には既存の`getControlValue()`と`setControlValue()`を使う。

不正なdropdown値、boolean以外のtoggle値、未知のcontrol keyは、現在と同じ例外を返す。

グループ化は表示構造だけを変更し、保存dataのmigrationは追加しない。

## 互換性

宣言的設定画面では、グループ内の各項目を従来どおり検索対象にする。

旧版向け設定画面では、同じ4見出しと12設定行を同じ順序で表示する。

独自CSS、折りたたみ、サブページは追加しない。

## テスト

- 宣言的定義がEditing、Appearance、Folding、Advancedの4グループを返すことを確認する。
- 各グループの項目名と順序が設計どおりであることを確認する。
- 旧版向け表示が4見出しと12設定行を同じ構造で生成することを確認する。
- dropdownとtoggleが現在値を表示し、変更後に設定値を保存することを確認する。
- 不正なcontrol値を拒否する既存の検証を維持する。

## 完了条件

- 新旧両方の設定画面で4グループが同じ順序で表示される。
- 12項目が一つずつ適切なグループに属する。
- 設定値、説明、保存形式に回帰がない。
- 対象unit test、型検査、lint、buildが成功する。

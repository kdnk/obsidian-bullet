# Desktop Outer List Line Position Design

## 背景

`5.12.0` では、desktopのouter list lineをouter guide widgetのinline endへ描画していた。

`5.12.1` に入ったcommit `51034c2` は、desktopだけ疑似要素をwidgetのinline startへ移した。
この変更後、outer list lineが表示されない環境が生じた。

outer guide widgetと通常の疑似要素は現在も生成されている。
したがって、修正対象はdesktopの通常線を移動するCSS overrideに限る。

## 設計

desktop専用のinline start overrideを削除し、すべての環境でbase ruleの `inset-inline-end: 0` を使う。
これにより、desktopの通常線は`5.12.0`と同じwidget inline endへ戻る。

outer guide widgetの位置、幅、pointer event、chunk decorationは変更しない。
mobileはすでにbase ruleを使っているため、描画位置は変わらない。

hoverとselected stateの3px paintは既存のdesktop補正を維持する。
通常線の復元によって、hover幅、endpoint radius、active color、fold actionを変更しない。

## エラー処理

新しい入力、永続化、runtime分岐は追加しない。
既存のsetting validationとdecoration validationを維持する。

## テスト

CSS contract testは、base ruleが `inset-inline-end: 0` を持ち、通常線をwidget inline startへ移すdesktop selectorが存在しないことを確認する。

focused unit test、全unit test、lint、test buildをNode.js 22.23.1で実行する。
実Obsidianではtest vaultを使い、outer widgetの疑似要素がwidget inline endへ描画されることをcomputed styleで確認する。

## 完了条件

- desktopのouter list lineが`5.12.0`と同じwidget inline endへ描画される。
- mobileの通常線位置が変わらない。
- hover、selected state、fold action、pointer targetが変わらない。
- outer guideのunit testとintegration testが通る。

# Spaceによる空バレット開始設計

## 目的

`Keep body text in bullets`が有効なとき、完全に空の行でSpaceを押すと、その場で空のルートバレットを作る。

通常文字を入力するまでバレットが現れない現在の遅れをなくし、Spaceを新しい項目の開始操作として使えるようにする。

インデントされた継続行、既存テキスト、複数selectionの入力規則は変更しない。

## 発火条件

次の条件をすべて満たす直接入力だけを変換する。

- `Keep body text in bullets`が有効である。
- transactionのuser eventが`input.type`である。
- 挿入文字がASCII Space一文字である。
- selectionが空の単一カーソルである。
- 変更前の物理行が文字数0である。
- カーソルが物理行の0列目にある。

`input.type.compose`などのcomposition subtypeは対象にしない。

日本語IMEの変換中にSpaceが候補選択へ使われる場合、その入力へ介入しない。

## 変換結果

完全に空の行は、Space入力によって次のように変わる。

```md
|
```

```md
- |
```

元のSpace入力transactionを維持し、その入力後の同じ位置へ`-`を補正changeとして挿入する。

feature adapterは元のtransactionと補正を`sequential: true`で一つのtransactionへまとめる。

カーソル、effects、annotations、scroll requestは再構築せず、CodeMirrorのchange mappingへ任せる。

したがって、入力とバレット生成は一つのhistory eventになり、一度のundoで空行へ戻る。

## 変換しない行

空白だけを含む行は変換しない。

この区別により、`Shift+Enter`で作る継続行のindentを維持する。

```md
- item
  |
```

この位置でSpaceを押しても、子バレットへ変換しない。

通常のネスト項目にはすでにlist markerがあるため、この操作で補う必要はない。

既存テキストを持つ行の0列目、list item、Markdown構造行、非empty selection、複数selection、貼り付け、drop、remote transaction、programmatic transactionも、このSpace固有の変換の対象にしない。

対象外のtransactionは、既存の`BulletTypingPolicy`の規則へそのまま渡す。

たとえば、貼り付けられた非バレット本文の0列目へSpaceを入力した場合は、本文をバレットへ所属させる既存の補正だけが適用される。

`Keep body text in bullets`が無効なときは、Spaceを通常どおり入力する。

## 実装境界

判定は既存の`BulletTypingPolicy`へ追加する。

Space入力の認識、変更前行とカーソルの検査、補正changeの生成をpolicyが所有する。

`BulletTypingGuard`は既存のdecision解釈を維持し、新しいkeydown listenerやtimerを追加しない。

この境界により、Live PreviewとSource modeは同じtransaction規則を共有する。

## エラー処理

入力形状を一意に認識できない場合は変換せず、既存のpolicy判定を続ける。

解析中の予期しないerrorは既存どおりdebug logへ記録し、元のtransactionを通す。

## 検証

pure transaction testで次を確認する。

- 完全に空の行へのSpace入力が`- `になる。
- 補正changeが元のSpaceの直前へ`-`だけを挿入する。
- 空白だけの行を変換しない。
- 空の継続行を子バレットへ変換しない。
- 既存テキストを持つ行、非empty selection、複数selectionには、Space固有の補正を追加せず既存のpolicy結果を維持する。
- composition subtype、貼り付け、remote transaction、programmatic transactionを変換しない。

feature testで次を確認する。

- 変換後のカーソルがバレット後へ移る。
- Space入力と補正が一つのhistory eventになる。
- 設定を無効にすると元のSpace入力だけが残る。

実Obsidianでは、Live PreviewとSource modeの空行でSpaceを押し、バレット表示、カーソル位置、一度のundoを確認する。

リスト項目で`Shift+Enter`を押した直後の行では、Spaceを押しても子バレットへ変換されないことを確認する。

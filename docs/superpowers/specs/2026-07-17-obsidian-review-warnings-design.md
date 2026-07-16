# Obsidian review warning対応設計

## 目的

Obsidianのplugin reviewで報告されたsource code warningを解消する。

同じ問題をローカルのlintとtestで検出し、popout window、mobile、Obsidian 1.12.7との互換性を維持する。

## 調査結果

現在の`npm run lint`は、Obsidian reviewが使う規則の一部しか有効にしていない。

`eslint-plugin-obsidianmd` 0.4.1では、`globalThis`、native DOM生成、console logging、declarative settings APIが推奨規則に含まれる。

unsafe warningの一部は明示的な`any`ではなく、`lib`がES2015までであるのに`Array.prototype.flatMap`と`Array.prototype.includes`を使った結果、review環境で型を解決できないことから生じている。

`process`はdesktopのElectron rendererでは存在するが、mobile pluginのruntime dependencyとして保証されない。

`src/__mocks__.ts`はproduction source tree内でJest globalへ直接依存しているため、review側の型環境では`jest`がunsafe valueになる。

## 検討した方針

### 警告の抑制

ESLint disable commentや型assertionを追加すれば差分は小さい。

しかし、mobileでの`process`参照とES2015で未定義のmethodは残り、review環境との差も再発するため採用しない。

### 指摘行だけの置換

`globalThis`、console、DOM生成だけを置換し、unsafe warningへ個別のcastを追加する方法である。

reviewは通しやすいが、unsafe warningの原因であるruntime互換性とtest dependencyの漏出を隠すため採用しない。

### 原因ごとのmodule修正とlint parity

これを採用する。

runtime環境の取得、settings storage、logging sinkを小さなinterfaceへ集約し、ES2015で型付けできる処理へ置換する。

あわせてObsidian linterを更新し、今回のreview規則をローカルで実行する。

## runtime環境

test bundleが必要とするenvironment variableは、`window.process`をoptionalに読むtest platform moduleへ集約する。

moduleのinterfaceは、typed environment objectの取得とWebSocket URL生成だけにする。

mobileやNode integrationのないwindowでは空のenvironmentを返し、test platformを開始しない。

unit testはenvironment objectを引数で渡し、Node globalをmoduleのinterfaceへ漏らさない。

System Informationは、modalを所有する`contentEl.win`からoptionalなprocess metadataを読む。

`arch`と`platform`が文字列でない場合は`null`を記録し、mobileでもmodalを開けるようにする。

## ES2015互換

`flatMap`は明示的なloopと`push`へ置換する。

`includes`は`indexOf(...) !== -1`へ置換する。

`NodeList.forEach`は`Array.from(...)`を通した`for...of`へ置換する。

これにより、review環境でmethodをerror typeとして扱われる経路をなくす。

## DOM生成

popout windowのdocumentに属する要素は、そのdocumentの`win.createDiv()`または`win.createSpan()`で生成する。

global helperやmain windowへ固定せず、既存のowner documentを維持する。

独自DOM構造と見た目は変更しない。

## logging

plugin loadとunloadの常時logは削除する。

debug settingで明示的に有効化されるLoggerは、既定sinkとして`console.debug`を使う。

Loggerへsinkを注入できる内部seamを置き、test helperはJest globalを使わずno-op sinkを渡す。

error reportingの`console.error`は残す。

## settings tab

`minAppVersion` 1.12.7を維持するため、imperativeな`display()`はfallbackとして残す。

Obsidian 1.13以降では`getSettingDefinitions()`が同じ設定をdeclarative controlとして公開し、settings searchへ登録する。

custom Settings storageを使っているため、settings tabは`getControlValue()`と`setControlValue()`をoverrideする。

control keyは既存の公開getter名と一致させ、受け取った`unknown`をkeyごとに検証してから保存する。

`verticalLinesAction`はUI上のboolean controlと永続化された`"none" | "toggle-folding"`をsettings tab内で変換する。

dropdown optionsは型assertionではなく、`satisfies Record<KeepCursorWithinContent, string>`で完全性を検査する。

## test support

`parseState`はunion parameterを書き換えず、string arrayへ正規化したlocal variableをreduceする。

`src/__mocks__.ts`はLoggerへ注入するsinkを受け取り、Jest globalを参照しない。

Settingsのgeneric `setValue`はcomputed objectへのassertionをやめ、単一keyを直接assignして一回だけ通知する。

## lint

`eslint-plugin-obsidianmd`を0.4.1へ更新する。

local ESLint設定では、少なくとも今回報告された`no-global-this`、`prefer-create-el`、settings definition、console、unsafe operation、unnecessary assertionをerrorとして検査する。

Jestのcompile-only global contractもlint対象へ含める。

test implementationへObsidian runtime固有の規則を過剰適用しないよう、既存のtest lint範囲は維持する。

## 検証

- review warningを再現するfocused lintが修正前に失敗し、修正後に通る。
- Loggerはdebug無効時にsinkを呼ばず、有効時に`console.debug`相当のsinkへ転送する。
- test platform environmentは値あり、値なし、processなしを扱う。
- System Informationのprocess metadata readerはdesktop値とmobile相当の欠損を扱う。
- declarative settings definitionsが全設定を同じ順序で公開する。
- declarative controlの読取、更新、保存、`verticalLinesAction`変換を検証する。
- legacy `display()`の既存挙動を維持する。
- unit test、lint、TypeScript、production build、test build、full testを実行する。

## 完了条件

- ユーザーが列挙したwarning箇所に該当規則が残らない。
- `minAppVersion`と保存済みsettings形式を変更しない。
- production bundleはNode globalへ依存しない。
- popout windowで生成先documentを維持する。
- 既存の未コミット変更を今回のbranchへ含めない。

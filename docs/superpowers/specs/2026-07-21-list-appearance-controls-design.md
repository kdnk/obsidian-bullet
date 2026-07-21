# リストの見た目設定とWorkflowy風bullet

## 背景

縦線の折りたたみ操作には、3pxへ太くした角丸のhover表示がすでにある。
しかし、この見た目は折りたたみ操作の設定と結び付いており、操作を残したままObsidian標準の細いhover表示へ戻せない。

bulletは現在、組み込みテーマで直径`0.4em`の円を表示している。
実測では約6.4pxであり、hoverしても見た目が変わらない。
Workflowyは直径7pxのdotを18pxの操作面の中央に固定し、hover時だけ無彩色の円形haloを表示する。
dotの大きさと中心位置は変えず、transitionも使わない。

## 設定

既存の「Improve the style of your lists」は、Workflowy風bulletを含むリスト全体の見た目を制御する。
保存値`styleLists`の初期値は引き続き`true`とする。

Appearanceグループへ「Enhance vertical line hover」を追加する。
保存値はbooleanの`enhanceVerticalLineHover`とし、初期値は`true`とする。
説明文では、折りたたみ可能な縦線をhoverしたときに太く角丸にする設定だと明示する。

縦線の見た目と操作は独立させる。
「Enhance vertical line hover」を無効にしても、「Fold lists from vertical indentation lines」が有効ならクリックによる折りたたみを維持する。
反対に、折りたたみ操作が無効な場合は、見た目設定が有効でも操作可能に見える3px hoverを表示しない。

保存済みデータに`enhanceVerticalLineHover`がない場合は、既定値の`true`を補う。
resetでも`styleLists`と`enhanceVerticalLineHover`を`true`へ戻す。

## 縦線hover

折りたたみ操作のbody classと、見た目設定のbody classを分ける。
操作classはクリック領域、cursor、hover segmentの同期、fold処理、scroll保持を引き続き制御する。
見た目classは3pxの線、中心固定の1px補正、`border-radius: 2px`だけを制御する。

操作が有効で見た目設定が無効な場合、hover markerにはObsidianの`--indentation-guide-width-active`と`--indentation-guide-color-active`を適用する。
独自の太さ、角丸、位置補正は適用しない。
inner guideでは同じ実リスト祖先へ対応するsegment全体を、outer guideでは同じchunkのsegment全体を、標準の細いactive表示へ揃える。

操作と見た目の両方が有効な場合だけ、承認済みの3px角丸表示へ上書きする。
inner guideはLive PreviewとSource modeのnative marginから1pxを差し引き、outer guideは基準側のlogical insetを1pxずらす。
通常線、線の中心、active色、hover group、クリック領域は変更しない。
固定色、追加opacity、transition、overlay、box-shadow、gradient、座標cacheは追加しない。

## Workflowy風bullet

`bullet-plugin-better-lists`が有効なとき、通常の`.list-bullet::after`を直径7pxの円にする。
dotの色には`var(--text-muted)`を使い、組み込みテーマのlightとdarkへ追従させる。
task checkboxは対象にしない。

Live Previewでnative DOMが子を持つfoldable itemだと示すbulletだけに、desktop hoverの18px haloを表示する。
leaf itemは7pxのdotを維持し、haloを表示しない。
Reading viewではbullet自体が操作対象ではないため、7pxのdotだけを適用する。
mobileではsticky hoverを避けるためhaloを表示しない。

haloは`.list-bullet`のlayout寸法を変えず、dotと同じ中心へabsolute配置する。
直径は18px、角丸は50%とする。
RTLでも同じ中心へ置くため、logical insetだけで中心を算出し、横方向のphysical transformは使わない。
色はWorkflowyの`#4B5155`と`#BBBEC0`を固定せず、`var(--text-muted)`を38%混ぜた透明色としてテーマへ追従させる。
dotをhaloより手前に描き、hover前後でdotの直径と中心座標を変えない。
折りたたみ済みの親でもnativeのring、色、transitionを残さず、同じ7pxのdotとして表示する。
transitionとanimationは追加しない。

`BetterListsStyles`の既存条件は維持する。
組み込みテーマかつ「Improve the style of your lists」が有効な場合だけbody classを付け、カスタムテーマのbulletを上書きしない。

## 実装境界

`Settings`は新しい保存値、getter、setter、通知を担当する。
`SettingsTab`はAppearanceグループのtoggleと保存を担当する。
`VerticalLines`は操作classと見た目classを別々に同期する。
`GuideFoldingPluginValue`のmarker管理とfold処理は変更しない。
`BetterListsStyles`の有効条件も変更しない。
見た目は既存の`styles.css`だけで実現し、独自DOMや新しいeditor decorationは追加しない。

## 検証

設定のunit testでは、既定値、保存値の読み込み、旧データへの既定値補完、reset、変更通知を確認する。
Settings画面のtestでは、新しいtoggleがAppearanceグループにあり、値の取得、boolean検証、保存が正しく行われることを確認する。

VerticalLinesのtestでは、操作classと見た目classが各設定へ独立して追従することを確認する。
見た目設定だけを無効にしてもeditor extension、marker同期、fold action、scrollPastEnd extensionが維持されることを確認する。

CSS契約testでは、標準hover ruleがnative active幅とactive色を使い、3px、角丸、中心補正を含まないことを確認する。
enhanced ruleは操作classと見た目classの両方を要求し、3px、2px角丸、mode別の中心補正を含むことを確認する。

bulletのCSS契約testでは、dotが7px、haloが18px、中心配置、50%角丸、theme色を持ち、transitionを追加していないことを確認する。
foldable Live Previewだけがhalo selectorへ一致し、leaf、Reading view、mobile、task checkbox、カスタムテーマが対象外であることも確認する。

実Obsidianでは組み込みlightとdarkで、foldable bulletのhover前後にdotの中心座標差が0px、直径が7px、haloが18pxであることを確認する。
leaf bulletとtask checkboxにhaloが出ないこと、カスタムテーマでbody classが外れることも確認する。
縦線では見た目設定のオンとオフを切り替え、どちらでもクリックによるfoldが一度だけ反転すること、オンでは3px角丸、オフではnative active幅になることを確認する。

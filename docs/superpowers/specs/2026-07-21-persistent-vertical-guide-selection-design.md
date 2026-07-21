# 縦線ガイドの選択状態

## 背景

現在の縦線ガイドは、pointerが重なっている間だけ論理的なガイド全体を強調する。
`pointerleave`ではmarkerを除去するため、クリック後に操作対象を示す表示は残らない。

クリック処理もガイド折りたたみ操作と一体になっている。
折りたたみ設定が無効な場合、またはガイド直下に開閉対象がない場合、そのガイドはクリック対象として扱われない。

Logseqに近い操作感では、ガイドの選択と内容の開閉は別の状態である。
ガイドを一度クリックしたら選択表示を残し、別の場所をクリックしたときに解除する。
開閉対象の有無や折りたたみ設定は、この選択表示を左右しない。

## 表示契約

選択中のガイドは、現在のhoverと同じactive色と太さで表示する。
強調する範囲は、クリックした単一のガイドsegmentではなく、同じ実リスト祖先またはリストチャンクを表す表示中のガイドsegment全体とする。

選択とhoverは独立した状態として扱う。
選択中に別のガイドへpointerを移した場合は、選択中のガイドとhover中のガイドがそれぞれ同じactive表現を持てる。

別のガイドをクリックすると、選択は新しいガイドへ移る。
ガイド以外の場所をクリックすると、選択を解除する。
同じガイドを再度クリックした場合は選択を維持し、選択解除のtoggleにはしない。

## CodeMirrorとの責務分担

選択状態は`GuideFoldingPluginValue`が持つview固有の一時状態とする。
`ViewPlugin`はstateful valueをeditor viewへ関連づけるCodeMirrorのmoduleであり、履歴、永続化、別viewとの共有を必要としないガイド選択に合っている。

`StateField`と`StateEffect`は使わない。
これらを使うと、表示だけの選択変更にもeditor transactionが必要になり、ガイド折りたたみ操作や文書編集とは独立した状態がEditorStateへ漏れる。
選択状態を読む別moduleもないため、新しいseamを設けるだけのleverageがない。

選択対象はDOM elementではなく、現在のCodeMirror documentに対するsemantic keyとして保持する。
inner guideは対象リストの先頭本文位置を、outer guideはリストチャンクの開始行と終了行をkeyにする。

fold、unfold、scroll、viewport更新はdocumentを変更しないため、同じkeyから選択対象を再解決できる。
一方、文書編集まで選択を追従させる必要はない。
`ViewUpdate.docChanged`では選択を解除し、古いkeyを近隣の別ガイドへ対応付けない。

## native DOMへの反映

CodeMirrorの`Decoration.mark()`は文書範囲を包む要素を生成し、`Decoration.line()`は行wrapperへ属性を加える。
Obsidianが生成するnative `.cm-indent`は、どちらのDecorationからも直接所有できない。
選択表示のために追加Decoration、独立overlay、複製したガイドDOMは作らない。

既存のhover同期と同じく、`EditorView.requestMeasure()`を使う。
read phaseで保存したdocument位置から論理的な選択対象を解決し、現在表示中の候補segmentを集める。
write phaseで選択markerとendpoint markerを同期する。

CodeMirrorがfold、scroll、viewport更新でDOMを差し替えても、DOM elementの同一性は保持しない。
次のview updateでdocument位置から対象を再解決し、新しい表示segmentへmarkerを付け直す。

## markerとCSS

inner guideとouter guideには、それぞれhoverとは別のselected markerを使う。
各groupの先頭と末尾にもselected専用のendpoint markerを付ける。

CSSはhover markerとselected markerを同じruleへまとめ、active色、active幅、3pxのenhanced表示、中心補正、endpointの角丸を共有する。
selected selectorは折りたたみactionのbody classへ依存させない。
折りたたみ設定が無効でも、表示されているガイドは選択表示を持てる。

outer guideは、開閉対象がない場合も選択できるpointer targetにする。
pointer領域は既存widgetの幅だけを使い、追加のhit領域やoverlayは作らない。

## event処理

Obsidianはnative `.cm-indent`の`mousedown`をCodeMirrorの通常event handlerへ届く前に止める。
ガイド上のselection移動を防ぐ`mousedown`と、選択および任意のfoldを行う`click`は、既存どおり`contentDOM`のcapture phaseで受ける。

クリックでは、まずガイドの論理的な対象を解決して選択状態を更新する。
折りたたみ設定が有効で開閉対象がある場合だけ、続けて既存のガイド折りたたみ操作を実行する。
fold transaction、selection退避、scroll snapshotは変更しない。

ガイド以外のクリックによる解除は、`contentDOM.ownerDocument`のcapture phaseで受ける。
現在のview内のガイドをクリックしたeventは解除対象から外し、その後の`contentDOM` listenerが選択を設定する。
別view、editor外、設定画面をクリックした場合は、現在のviewの選択を解除する。

CodeMirrorの`domEventHandlers`は`contentDOM`のbubble phaseへ登録されるため、Obsidianが先に止めるガイド操作の代替にはしない。

## cleanupと失敗時の扱い

選択対象のsemantic key、Parser結果、raw indent prefix、outer chunk属性のいずれかを解決できないguide clickでは、新しい選択を作らず既存の選択を維持する。
ガイド以外をクリックした場合は、既存の選択を解除する。

文書変更が発生した場合、またはkeyから元の種類のガイドを再解決できない場合は選択を解除する。
表示中のsegmentが一時的に0個であるだけなら選択状態は保持し、再表示時にmarkerを復元する。

ViewPluginのdestroy時にはdocument listenerを外し、selected marker、selected endpoint marker、hover marker、persistent markerをすべて除去する。

## 検討した方式

### ViewPluginに意味を保持する

現在のdocumentに対するsemantic keyで選択対象を保持し、表示中のnative segmentへmarkerを同期する。
CodeMirrorのview固有状態とDOM lifecycleを利用しながら、document変更時には状態を破棄できるため、この方式を採用する。

### DOM classを状態として保持する

クリック時に現在のelementへclassを残せば実装量は少ない。
しかし、CodeMirrorの仮想化やfoldでelementが交換されると選択が失われ、古いdetached elementが意味の保持場所になるため採用しない。

### StateFieldとDecorationで表す

位置の写像はStateFieldで扱えるが、この選択は文書変更時に解除するため写像自体が不要である。
さらに、native `.cm-indent`へDecorationを直接付けられないためViewPluginによるDOM同期は残る。
一つのview固有状態に二つのmoduleとtransaction interfaceを持ち込むことになり、interfaceに見合うleverageがないため採用しない。

## 検証

unit testでは、次を確認する。

- 折りたたみ設定が無効でもinner guideとouter guideを選択できる。
- 開閉対象がないガイドも選択でき、fold transactionは発生しない。
- 選択した論理groupの全表示segmentにselected markerが付く。
- 別のガイドをクリックするとmarkerが移る。
- ガイド以外、別view、editor外のクリックでmarkerが消える。
- pointer leaveではhover markerだけが消え、selected markerは残る。
- fold、viewport更新、DOM交換後も選択groupが再同期される。
- 文書変更またはsemantic keyの再解決失敗時に解除する。
- 設定変更では選択を維持し、destroyではlistenerと全markerを除去する。

CSS contract testでは、hoverとselectedが同じactive表現を共有し、selected selectorが折りたたみactionのbody classへ依存しないことを確認する。
outer guideのpointer領域が既存widgetの範囲を超えないことも確認する。

実Obsidianではtest vaultを使い、desktopのclickとmobile emulationのtouch tapで確認する。
折りたたみ設定の有効時と無効時、開閉対象のあるガイドとないガイド、inner guideとouter guideをそれぞれ操作する。
別の場所をクリックした解除、fold後の再同期、scrollによるDOM交換後の再同期も確認する。

package versionの変更とreleaseは、この作業に含めない。

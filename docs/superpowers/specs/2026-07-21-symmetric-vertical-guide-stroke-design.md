# 左右対称な縦線hover

## test vaultのindent設定

実Obsidianの検証にはrepository内の`vault`だけを使う。
このvaultは`useTab: true`と`tabSize: 4`を持ち、Tab入力ではtab文字を挿入して4 column幅で表示する。

`vault/.obsidian/app.json`はgitignore対象なので、このfileを一度変更するだけではfull test後の値を保証できない。
trackedな`jest/test-config.js`へtest vault用app configを定義し、`jest/global-setup.js`がfull testのたびに同じ値を再適用する。
unit testはexportされたconfigを直接検証する。

今後の手動検証ではUI操作前のvault title確認に加え、runtimeの`app.vault.config.useTab`が`true`、`tabSize`が`4`であることを確認する。

## 非対称に見える原因

現在のenhanced hoverは、Obsidianが持つ1px幅の`.cm-indent::before`へ3pxの`border-inline-end`を付け、`margin-inline-start`を1px戻して中心を補正している。
直線部分を実Obsidian 1.13.2のscreenshotで測ると、通常線`x=91`に対してhover線は`x=90..92`だった。
Source modeのtab 4 columnによる4階層でも、通常線`x=189`に対してhover線は`x=188..190`であり、直線部分の中心は一致していた。

しかし、native pseudo-elementは1pxの透明contentと3pxのinline-end borderから成る4pxの非対称boxになる。
このboxへ2pxのradiusを付けると、上端の最初のpaint rowは`x=188,189`となり、中心`x=189`より左へ偏った。
直線の途中ではなく、丸い端点だけが片側へ広がって見える原因はこのbox modelである。

outer guideは透明contentが0pxだが、同じく片側borderを描画源にしている。
innerとouterで異なる描画方式を残さず、両方を同じ3pxの塗り面へ揃える。

## 描画方式

enhanced hover中のpseudo-elementは`border-inline-end`を0にし、`inline-size: 3px`と`background-color: var(--indentation-guide-color-active)`で線そのものを描く。
3px boxへ2pxのradiusを適用すると、実screenshotの上端は中心1px、その次のrowから左右へ1pxずつ増えた3pxになった。

inner guideはnativeの1px content boxが始まる位置を中心補正へ利用する。
Live Previewでは`margin-inline-start: var(--indentation-guide-editing-indent)`、Source modeでは`margin-inline-start: var(--indentation-guide-source-indent)`とし、従来の`- 1px`を外す。
3px boxの中央が従来の1px border位置に一致するため、通常線から左右へ1pxずつ広がる。

outer guideはcontent幅が0pxなので、現在の論理方向offsetを維持する。
mobile基準ruleの`inset-inline-end: -1px`とdesktop ruleの`inset-inline-start: -1px`は、3px boxを通常の1px border中心へ合わせる。

通常線の1px幅と20%色、hoverの30% active色、endpoint marker、startとendだけを丸める契約、fold対象、pointer領域、scroll保持は変更しない。

## 比較した代替案

1px borderへ左右のbox-shadowを足す案は中央を明示できるが、containerのclipとthemeのshadow処理へ依存する。
outlineを使う案は各segmentの上端と下端にも線を描き、連続線へ横方向の継ぎ目を作る。
4px線へ変える案はLogseqに近い偶数幅になるが、ユーザーが選んだ3px幅を変えてしまう。

3pxのbackground boxは、追加DOMやoverlayを作らず、既存pseudo-elementだけでpaint範囲を左右対称にできるため採用する。

## 検証契約

CSS contract testはinnerとouterのenhanced hoverが次を満たすことを確認する。

- `inline-size: 3px`
- `border-inline-end: 0`
- `background-color: var(--indentation-guide-color-active)`
- innerのmode別marginに`- 1px`がない
- outerのlogical offsetは`-1px`のままである
- endpoint radiusはstartの上側2角とendの下側2角だけに残る
- transition、box-shadow、outline、追加overlayを使わない

test configのunit testは`TEST_VAULT_APP_CONFIG.useTab === true`と`tabSize === 4`を確認する。

実Obsidianではtab文字で4階層にしたfixtureを使う。
Live PreviewとSource modeの各深さで通常線の中心columnとhover3pxの中央columnが一致し、start capが中央1pxから始まり、次のrowが左右1pxずつの3pxになることをscreenshot pixelで確認する。


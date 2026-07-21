# 通常時の縦線を濃くする設計

## 背景

「Enhance vertical lines」が有効な場合、通常時の縦線は`var(--text-normal)`を20%混ぜた色で描かれている。
この濃さではテーマによって背景へ沈み、リストの階層を追いにくい。

一方、hover時の縦線はテーマのactive色を使い、Obsidian既定dark themeでは約30%の濃さになる。
通常線を同じ30%まで上げると、hover時の色による差がなくなる。

## 表示契約

「Enhance vertical lines」が有効な場合の`--indentation-guide-color`を、`color-mix(in oklch, var(--text-normal) 26%, transparent)`へ変更する。
20%から一段濃くしながら、約30%のactive色との差を残す。

色の基準には引き続き`var(--text-normal)`を使う。
light themeでは暗く、dark themeでは明るくなるため、固定色は追加しない。

通常線の幅、位置、segmentの構造、outer guideの描画方法は変更しない。
hover時の3px幅、active色、角丸、選択表示も変更しない。

## 設定

新しい色または濃さの設定は追加しない。
既定で有効な「Enhance vertical lines」が、通常線の26%色と既存の強調hoverをまとめて提供する。

利用者が「Enhance vertical lines」を無効にした場合は、現在と同じくObsidianが提供する`--indentation-guide-color`へ戻す。
保存keyと既定値は変更しない。

## 検証

CSS contract testで、「Enhance vertical lines」の通常色がtext-normal 26%であることを確認する。
同じtestで、hover時の3px幅とactive色が維持されることを引き続き確認する。

対象unit testをCIと同じNode.js 22.23.1で実行する。
変更はCSS変数の値だけなので、実Obsidianのpointer操作やfold transactionの再検証は必要としない。

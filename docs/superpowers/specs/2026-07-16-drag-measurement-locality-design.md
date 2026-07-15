# drag measurement locality設計

## 目的

一つのcallerしか持たないmeasurement helperをDragAndDrop moduleへ戻し、drag plan全体をtest surfaceにする。

利用者向けdrag and drop挙動は変更しない。

## locality

left paddingはdrop variantの横位置を決める入力であり、tab widthとEditorView座標系から独立して使われない。

left paddingだけを別moduleに置くと、実際のdrop planを理解するためにfileを往復する。

measurement implementationをDragAndDrop fileへ戻す。

## drag plan

DragAndDropStateは候補収集、座標測定、pointerに最も近い候補の選択を一つの計算として扱う。

DOM描画とoperation適用は既存どおりDragAndDrop lifecycleが担当する。

この段階ではDragAndDropStateを別fileへ分割しない。

## テスト

独立したmeasurement test fileを削除する。

既存のDragAndDrop test fixtureへ次のcaseを移す。

- rendered lineを優先する。
- lineがない場合はscroller leftとpaddingを使う。
- DOM要素がない場合はzeroへfallbackする。

各caseはleft padding値だけでなく、drop variantのleftまたは描画位置まで検証する。

## 完了条件

- dragAndDropMeasurements moduleを削除する。
- measurementの回帰testがDragAndDrop testに残る。
- DragAndDropのproduction interfaceを増やさない。

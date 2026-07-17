# プロジェクトrelease skill設計

## 目的

このリポジトリの新version公開手順をrepo-local skillへ集約する。

release担当のagentは、version更新だけで終わらず、GitButlerによるdefault branchへの反映、annotated tagの作成、release workflowの成功、GitHub Releaseの公開まで確認する。

## 現状

release手順は`AGENTS.md`、`package.json`、`release.mjs`、`.github/workflows/release.yml`へ分散している。

個々のcommandはすでに整備されているが、実行順序、停止条件、中断後の再開方法をreleaseのたびに組み立て直す必要がある。

この再構成が、Git write commandの混入、重複したversion bump、未検証のland、tagだけが欠けたreleaseの取り違えを起こしやすくしている。

## 採用する構成

repo-local skillを`.agents/skills/release/SKILL.md`へ配置する。

skillは手順と判断基準だけを持ち、新しいshell scriptやrelease runnerは追加しない。

metadata同期は`npm version`と`release.mjs`、version controlはGitButler、GitHub操作は`gh` CLI、公開処理は既存のrelease workflowを引き続き担当する。

この構成では、既存の実装を唯一の実行源として保ちつつ、agentが各段階で何を確認し、どこで停止するかをskillが規定する。

## trigger

skillは、このリポジトリでユーザーが新versionのrelease、publish、version bumpを依頼したときに使う。

中断したreleaseの再開、欠けたtagやGitHub Releaseの復旧、release workflowの確認も対象に含める。

ユーザーがrelease種別を指定していない場合だけ、`major`、`minor`、`patch`の番号付き選択肢を提示する。

release種別が依頼に含まれていれば、重ねて確認せず処理を開始する。

## release flow

skillは最初にrepo rootの`AGENTS.md`を読み、そこにあるrelease規則を優先する。

次に`package.json`、`manifest.json`、`versions.json`、既存tag、GitHub Releaseを照合し、新しいversion bumpが必要か、中断したreleaseの再開かを判定する。

通常のreleaseでは、次の順序を固定する。

1. `but pull --check`が成功した後に`but pull`を実行する。
2. Node.jsが22系かつ22.23.1以上であることと、`gh auth status`が成功することを確認する。
3. 現versionから次versionを算出し、`but branch new codex/release-<version>`でrelease branchを作成する。
4. `npm version <major|minor|patch>`を追加flagなしで実行し、version lifecycleによるmetadata同期を完了させる。
5. `package.json`、`package-lock.json`、`manifest.json`、`versions.json`だけが新versionへ揃ったことを確認する。
6. projectの全テストを実行し、失敗が0件であることを確認する。
7. 四つのmetadata fileだけをrelease branchへGitButlerでcommitする。
8. `but land <branch-id> --yes`でdefault branchへ反映する。
9. default branchのrelease commitを指すannotated tagを`gh api`で作成する。
10. tagで起動したrelease workflowを`gh` CLIで監視し、成功を確認する。
11. 同じversionのGitHub Releaseが公開済みであることを確認する。

localの`git tag`、`git push`、その他のGit write commandは使わない。

## 停止条件

`but pull --check`、Node.js、GitHub認証、metadata同期、全テストのいずれかが失敗した場合は、release branchをlandしない。

metadata file以外の変更がrelease branchへ混入する場合はcommitせず、GitButler上の所有branchを切り分ける。

landが失敗した場合はrelease branchを保持し、認証またはupstreamの問題を解消して同じbranchから再開する。

annotated tagの作成後にworkflowが失敗した場合は、versionを進めず、同じtagとworkflowの状態を調査する。

## 中断したrelease

default branchの`manifest.json`が示すversionに対応するtagまたはGitHub Releaseだけが欠けている場合、新しいversion bumpを実行しない。

そのdefault branch commitで全テストを再実行し、欠けているannotated tagまたはrelease workflowだけを補う。

tag、workflow、GitHub Releaseのどこまで完了しているかを`gh` CLIで確認し、完了済みの操作を繰り返さない。

## 検証

skillのfrontmatter、名前、description、構造はskill作成ツールで検証する。

内容は、release種別未指定、release種別指定済み、全テスト失敗、中断したrelease、無関係なGitButler branchが適用中、GitHub認証失敗の各scenarioで自己レビューする。

最後に、このskillを使って次のpatch releaseを実行する。

metadataの整合、release commit、annotated tag、release workflow、GitHub Releaseまで確認できた時点を統合検証の成功とする。

## 対象外

release workflow、`release.mjs`、npm lifecycleの実装変更は行わない。

release noteの自動生成、changelogの導入、GitHub Release以外の配布先追加も行わない。

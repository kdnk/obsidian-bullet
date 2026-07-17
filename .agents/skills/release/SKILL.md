---
name: release
description: Use when releasing, publishing, version-bumping, or resuming an interrupted version of the obsidian-bullet repository, including major, minor, patch, tag, workflow, and GitHub Release requests.
---

# Release

## 原則

releaseをversion bumpではなく、default branch、annotated tag、release workflow、GitHub Releaseが同じversionで揃うまでの状態遷移として扱う。

最初にrepo rootの`AGENTS.md`を全文読み、release、version control、testの規則を確認する。

このskillと`AGENTS.md`が矛盾する場合は`AGENTS.md`を優先する。

**REQUIRED SUB-SKILL:** version controlの書き込みには`but`を使う。

## 入力を確定する

依頼または直前の回答に`major`、`minor`、`patch`、あるいは対応する番号が含まれている場合は、そのrelease種別を採用して再確認しない。

明示されたrelease種別は`AGENTS.md`の種別確認に対する回答済み入力として扱い、番号だけを改めて要求しない。

release種別が未指定の場合だけ、次を提示して回答を待つ。

1. major
2. minor
3. patch

種別が確定するまではrelease状態を変更しない。

## Preflight gate

1. `AGENTS.md`、`package.json`、`.npmrc`、`release.mjs`、`.github/workflows/release.yml`を読む。
2. `but status -fv`で適用中branch、uncommitted change、release metadataの所有branchを記録する。
3. `but pull --check`が成功した場合だけ`but pull`を実行する。
4. Node.jsが22系かつ22.23.1以上であることを確認する。
5. `gh auth status -h github.com`と`gh repo view`が成功することを確認する。

すべて成功するまでbranch作成、version更新、land、tag作成へ進まない。

## Release状態を判定する

GitButlerのworkspaceは複数branchを合成しているため、workspace上のfileをdefault branchの状態だと推定しない。

`gh` CLIでremoteのdefault branch名とcommit SHAを取得し、そのcommitにある次のmetadataを読む。

- `package.json`のversion
- `package-lock.json`のroot package version
- `manifest.json`のversion
- `versions.json`の対応entry

同じversionのremote tag、tag objectのtarget、tag-triggered workflow、GitHub Releaseも`gh` CLIで照合する。

完了済みtagは、現在のdefault branch HEADではなく、そのversionを公開した過去のrelease commitを指していてよい。

tag targetの四metadataがtag versionと一致し、そのcommitがdefault branch historyにあり、対応workflowとGitHub Releaseが完了していれば正常とする。

| 状態 | 選ぶ処理 |
|---|---|
| default branchのversionに対応するtag、workflow、GitHub Releaseがすべて完了 | 指定種別で次versionをreleaseする |
| default branchのversionは更新済みだが、tag、workflow、GitHub Releaseのいずれかが未完了 | 同じversionを復旧する |
| tagがlightweight、target metadataがtag versionと不一致、またはtargetがdefault branch history外 | 変更せず停止して矛盾を報告する |

復旧処理では`npm version`を再実行せず、次versionへ進めない。

## 通常releaseを準備する

1. default branchのversionと指定種別からtarget versionを算出する。
2. `but status -fv`を再確認し、四つのrelease metadata fileを無関係なbranchが所有していないことを確認する。
3. `but branch new codex/release-<version>`で専用branchを作り、branch IDを保持する。
4. `AGENTS.md`が指定する`npm version <major|minor|patch>` flowを実行する。
5. `but diff`で変更fileと所有branchを確認する。

無関係なbranchがrelease metadataや安全なnpm lifecycleの前提を所有する場合、そのbranchをunapply、rewrite、commit、landしない。

release branchを独立して作れない場合は、必要なbranchと理由を示してユーザーの権限を確認する。

Metadata gateは、次のすべてが成立したときだけ通過とする。

- `package.json`、`package-lock.json`、`manifest.json`がtarget versionで一致する。
- `versions.json`にtarget versionのentryがある。
- release branchの変更対象がこの四fileだけである。
- npm lifecycleがGit commit、staging、local tagを作成していない。

不一致または余分な変更があればcommitせず停止する。

## 検証してlandする

`AGENTS.md`のfull-test規則をそのまま適用する。

特に`vault/test.md`をvault外へbackupし、test rendererの終了後にrestoreし、hashまたはsizeの一致を再確認する。

CI相当のlint、test build、full test、release buildをすべて実行する。

一つでも失敗した場合はrelease branchを保持し、commit、land、tag作成を行わない。

全検証成功後に`but diff`から四fileのchange IDだけを選び、WhyとWhatを含む英語のConventional Commitをrelease branchへ作成する。

land直前に`but pull --check`を再実行し、必要なら`but pull`でupstreamを取り込んで検証状態を再確認する。

`but land <branch-id> --yes`が成功するまでtagを作成しない。

## Annotated tagを公開する

land後に`gh` CLIからdefault branchのcommit SHAを取得し、そのcommitのmetadataがtarget versionであることを確認する。

同名tagが存在しないことを確認した後、`gh api`でannotated tag objectとtag refを作成する。

```bash
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
default_branch=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
release_sha=$(gh api "repos/$repo/commits/$default_branch" --jq .sha)
tag_object_sha=$(gh api --method POST "repos/$repo/git/tags" \
  -f tag="$version" \
  -f message="Release $version" \
  -f object="$release_sha" \
  -f type=commit \
  --jq .sha)
gh api --method POST "repos/$repo/git/refs" \
  -f ref="refs/tags/$version" \
  -f sha="$tag_object_sha"
```

localの`git tag`と`git push`は使わない。

同名tagが存在する場合は移動、削除、上書きせず、target commitのmetadataとdefault branch history上の位置を検証して復旧処理へ切り替える。

## WorkflowとGitHub Releaseを確認する

作成したtagで起動したrelease workflowを`gh run list`で特定し、`gh run watch <run-id> --exit-status`で終了まで監視する。

失敗した場合は`gh run view <run-id> --log-failed`で原因を収集し、同versionを未完了として報告する。

workflow成功後、`gh release view <version>`でpublished Releaseと期待するassetを確認する。

## 復旧する

default branch metadataが示すversionを固定し、完了済みの段階を繰り返さない。

- tagがない場合は、full verification後にdefault branch commitへannotated tagを作る。
- tagが正しく存在しworkflowが未完了の場合は、そのrunの状態を調査する。
- workflowが成功しGitHub Releaseだけがない場合は、workflow logとrelease stateを調査する。
- tag作成後に失敗した場合は、新しいversion bumpで回避しない。

## 停止と完了

| 失敗地点 | 停止後の状態 |
|---|---|
| pull、Node.js、GitHub認証 | release mutationなし |
| metadata gate、full verification | release branchを保持し、landとtagなし |
| land | release branchを保持し、tagなし |
| tagまたはworkflow | default branch versionを未完了として保持し、追加bumpなし |

次のすべてを実測できた場合だけrelease完了と報告する。

- default branchの四metadataが同じversionである。
- annotated tagがversion一致のrelease commitを指し、そのcommitがdefault branch historyにある。
- tag-triggered release workflowが成功している。
- 同versionのGitHub Releaseがpublishedで、workflow所定のassetを含む。

途中で停止した場合は、成功済みの最後のgate、失敗したgate、保持されているbranchまたはremote state、再開に必要な操作を報告する。

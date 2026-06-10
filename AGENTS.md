- git の操作は、ユーザーに再確認せず `but` (GitButler) を使ってください。
    - `but status -fv` が `Setup required: Not currently on a gitbutler/* branch.` で失敗した場合は、ユーザーに確認せず `but setup` を実行してから `but status -fv` を再試行してください。
    - 作業開始時、PR 作成前、リリース作業前、長めの作業の区切りでは定期的に `but pull --check` を実行し、upstream に更新がある場合は `but pull --status-after` で取り込んでください。
    - `but` が利用不能な理由を調べる場合に限り、read-only の `git` コマンド（例: `git status --short --branch`, `git branch --show-current`, `git remote -v`）を診断目的で使ってかまいません。`git` の write 操作は使わないでください。
- github の URL に直接アクセス禁止。必要な GitHub 操作は `gh` CLI を使ってください。
- commit について
    - commit するときは、Conventional Commits に従ってください。英語で commit メッセージを書いてください。
    - commit description も丁寧に書いてください。Why と What がわかるように書いてください。
- release について
    - ユーザーが「リリースして」と依頼した場合は、まずリリース種別を次の番号付き選択肢で確認してください。ユーザーは数字で回答します。
        1. major
        2. minor
        3. patch
    - リリース種別の回答を受けたら、現在取り組んでいるブランチに対して pull request を作成し、マージしてください。GitHub 操作は URL に直接アクセスせず `gh` CLI を使ってください。
    - `gh pr create` が権限エラーで失敗した場合は、branch が push 済みか、`gh repo view --json viewerPermission` で権限があるかを確認し、REST API (`gh api`) と `but pr new` も試してください。それでも失敗する場合は認証・forge 権限の問題としてブロックしてください。
    - pull request をマージする前に全テストを実行し、すべて通ることを確認してください。全テストが通らない状態ではマージしないでください。
    - pull request のマージ後、デフォルトブランチに対して `npm version <major|minor|patch>` を実行し、新しいバージョンをリリースしてください。
- テストについて
    - `.spec.md` の統合 spec やフルテストは `dist/main.js` を実行するため、`src` を変更した後に実行する場合は先に `npm run build-with-tests` を実行してください。
- エージェント向けのローカル指示について
    - 作業中に、このファイルや同等のエージェント向け指示に不足、矛盾、繰り返し確認を生む表現を見つけた場合は、ユーザーに追加確認せず、同じ変更範囲に含めて改善してください。
    - 作業中に「指示通りに進められない」「ツールやコマンドが失敗する」「どの手順を使うべきか不明」といった状況に当たった場合は、ユーザーに繰り返し確認せず、まずローカルのヘルプ、CLI の `--help`、プロジェクト内ドキュメント、利用可能なスキル/プラグインの説明を自分で調べてください。
    - 調べた結果、再発防止のためにエージェント向け指示へ残すべき運用ルール・例外・診断手順が分かった場合は、同じ変更範囲に含めてこのファイルを改善してください。
    - ただし、既存のユーザー意図を弱める変更、危険な権限拡大、リポジトリの運用方針を大きく変える変更は避けてください。

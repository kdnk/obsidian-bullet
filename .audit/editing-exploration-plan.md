# Editing exploration playbook

## Done predicate

The run is complete when the high-risk editing paths below have been exercised in the managed test vault with native input, every observed mismatch has a reproducible artifact, and each confirmed Bullet defect is either fixed with a regression check or recorded as open with the blocking fact.

## Scope and rigor

This run covers five feature families and their editing intersections: structural editing, branch zoom, guides and folding, drag and drop, and list, task, and code rendering. The highest-risk cases combine selections, descendants, tabs, code fences, zoom, multiple panes, and Undo/Redo. The rigor level is high because a wrong edit can silently change saved Markdown.

## Phases

1. Capture the GitButler baseline and existing native-test coverage.
2. Split static inspection by feature family and aggregate candidate risks.
3. Start one managed real-Obsidian lifecycle, run doctor, and capture the baseline.
4. Run the broad structural-editing native suites with fresh output directories.
5. Run focused cross-feature cases chosen from the static audit and coverage gaps.
6. For each failure, reproduce from a fresh fixture and trace the first incorrect state.
7. Add a behavior-level regression check, make the smallest source change, and rerun the failing real-product case.
8. Run the affected unit, policy, type, lint, and native verification gates.
9. Review the diff and audit trail, commit the verified work to the dedicated GitButler branch, and report open gaps.

## Throughput checkpoint

Do not start a fix until a managed native-input artifact proves the defect. End every fix unit with the same native case green before moving to another finding.

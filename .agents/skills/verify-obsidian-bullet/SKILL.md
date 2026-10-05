---
name: verify-obsidian-bullet
description: "Verify Bullet in real Obsidian desktop Live Preview using the vault-scoped Obsidian CLI/CDP harness. Use after changing list editing, folding, zoom, drag and drop, or list/code rendering, or when screenshots and native input evidence are needed."
---

# Verify Obsidian Bullet

Drive the real Electron renderer in this checkout's `vault`. Start with the
[feature map](features/README.md), select the affected sub-features and entry
points, and record which ones were exercised. The primary surface is desktop
Live Preview. Source mode and Obsidian mobile emulation need separate cases;
emulation does not certify a physical phone.

## Launch

Run from the repository root on macOS with Obsidian, `obsidian-cli`, dependencies
from `package-lock.json`, and Node.js 22.23.1 available through `n`. If dependencies
are missing, run `n exec 22.23.1 npm ci` first. Keep `vault/.obsidian/app.json` at
`useTab: true`, `tabSize: 4`; start outside mobile emulation. Read the repository's
`AGENTS.md` before driving.

```sh
export PROOF_DIR="/tmp/obsidian-bullet-verify-$(uuidgen)"
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs start "$PROOF_DIR"
```

`start` builds with `npm run build`, backs up the test fixture, workspace, app
configuration, community-plugin list, and Bullet assets/settings, then deploys
only `bullet` to `vault/.obsidian/plugins/bullet/`. It disables Bullet, replaces
the assets, calls `app.plugins.loadManifest(".obsidian/plugins/bullet")`, enables
it, and opens `test.md` with `obsidian-cli vault=vault`. The readiness assertion
requires the exact vault path, desktop Live Preview, an editable CodeMirror
view, matching runtime version, and the deployed build hashes. Build output is
in `build.log`; `session.json` records ownership and restoration state.

Obsidian is shared. The helper acquires
`vault/.obsidian/bullet-verification-lock`; one lifecycle owns this test window
until cleanup. Do not run another standalone verifier, Computer Use driver,
Jest, watch deployment, or release deployment concurrently. A lock conflict
means stop and read that lock file's token/proof fields, not delete it. This is cooperative
isolation; existing scripts do not acquire it themselves. Never operate or
deploy to the personal `base` vault. An already open test window is borrowed and
reopened with its original workspace after cleanup. A window opened by this
run is closed without reopening.

Teardown command, also required after a failed drive:

```sh
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs cleanup "$PROOF_DIR"
```

## Doctor

```sh
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs doctor "$PROOF_DIR"
```

Doctor reads the renderer and asset hashes without changing focus, settings,
notes, or selection. It writes `doctor.json` and requires the same renderer
owned by this run, exact test vault, tab configuration, desktop Live Preview,
runtime manifest, and deployed assets. Run it before driving and whenever
anything looks wrong. If source changes after launch, clean up and start a
fresh lifecycle to build that source; version equality alone is insufficient.
Transport timeouts, a changed renderer, mobile mode, or a guard failure are
failures to investigate, not permission to drive another window.

## Drive

Use the [feature map](features/README.md) for commands, selectors, expected end
states, alternate entry points, and gaps. Run scripts serially with fresh output
directories. The following is a complete native-fold proof, including cleanup
on failure; run it after Launch:

```sh
(
  set -eu
  trap 'n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs cleanup "$PROOF_DIR"' EXIT
  n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs doctor "$PROOF_DIR"
  n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs capture "$PROOF_DIR"
  n exec 22.23.1 node scripts/verify-fold-parent-position.cjs "$PROOF_DIR/folding" --new-pane --collapsed-properties --screenshots > "$PROOF_DIR/folding.log" 2>&1
  n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs capture "$PROOF_DIR"
)
test -s "$PROOF_DIR/folding/results.json"
test -s "$PROOF_DIR/cleanup.json"
find "$PROOF_DIR/folding/screenshots" -name '*.png'
```

This creates a UUID test note with eight frontmatter properties, closes the
Properties display, and sends four native chevron clicks in a fresh pane.
`results.json` must show alternating folded state, `delta: 0` including painted
post-click frames, unchanged Markdown, shrinking editable content, a persistent
noneditable reserve outside `.cm-content`, unchanged editable padding, and zero
reserve after unfolding. Its `finally` restores the original pane/settings and
trashes its own note. This covers the native-arrow entry point only; use the
map for guide clicks, commands, zoom/font matrices, and mobile taps.

For a new manual case, reuse `scripts/obsidian-scroll-driver.cjs` from a Node
script launched with `n exec 22.23.1 node`. Its `evaluate(fn, ...args)` guards the
exact vault path and tab configuration. Resolve selectors and source rows in
the renderer, focus it, require a fresh title containing `vault` and excluding
`base`, and hit-test the target with `document.elementFromPoint()`. Send native
CDP input through `cdp("Input.dispatchMouseEvent", ...)`,
`Input.dispatchTouchEvent`, `Input.dispatchKeyEvent`, or `Input.insertText`.
Recheck the guarded target immediately before each input. Use both press and
release; a synthetic DOM event or direct command invocation proves only that
programmatic entry point. Record source/cursor state before and after input and
wait for the file save before comparing persisted Markdown.

When using Computer Use, follow `AGENTS.md`'s per-action vault focus/title checks
and fresh screenshot rules. Before editing a `selectText()` selection, confirm
its actual CodeMirror range. Before entering Console diagnostics, require fresh
AX focus to say `Console prompt`.

Standalone scripts work on the production bundle deployed by this lifecycle.
Jest's global setup restarts Obsidian by name and overwrites the fixture; run
integration specs only after managed cleanup, under `AGENTS.md`'s separate
backup, test-build, renderer-exit, and restore procedure. Unit tests need
`SKIP_OBSIDIAN=1` or `npm run test:unit`.

## Evidence

```sh
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs capture "$PROOF_DIR"
```

Capture saves a timestamped PNG and JSON containing renderer identity, asset
hashes, active file, Markdown, cursor, scroll position, and DOM. Inspect the
actual PNG. Capture before input and after its resulting state, not only after
a verifier has already deleted its fixture. The folding recipe's
`--screenshots` saves before/after PNGs for every click while the fixture is
open and references them from `results.json`.

Keep command invocations, stdout/stderr, exit status, JSON assertions, and
screenshots together under `PROOF_DIR`. For scroll/paint claims, start recording
from the event actually received by the renderer and assert that post-event
frames exist. CLI shutdown can lag its CDP response: the shared transport
consumes one complete reply on timeout and never retries an editing mutation.

API-created notes and settings are setup. Native input must exercise the named
user path. Synthetic events, internal setters, editor transactions, and command
calls must be labeled separately. Verify persisted Markdown and other side
effects alongside what is visible; mocks and screenshots alone cannot certify
the production interaction. Do not describe unrun mapped paths as covered.

## Cleanup

Run `cleanup "$PROOF_DIR"` from Helpers after every success or failure. `start`
attempts it automatically if launch fails. Feature scripts own their UUID
fixtures and restore them in `finally`; if that fails, identify and remove only
that run's recorded fixture under the guarded test vault before completing
cleanup. Never remove a note just because its name looks like a test.

The helper closes only the recorded test-vault window, waits for that exact
renderer PID to exit, restores backed-up file bytes and hashes, and reopens a
borrowed window. It clears CDP emulation and returns mobile emulation to desktop
before closing. It never kills by process name. If the renderer has changed or
has not exited, cleanup fails and retains the lease/backup; inspect
`cleanup-error.json` when present and retry the same cleanup after resolving the
cause. Do not restore files under a live renderer or steal the lease.

`session.json` records original hashes; `cleanup.json` records restored hashes
and window ownership. Reopening
may cause Obsidian to serialize `workspace.json` again; byte restoration is
checked before reopening, and the original bundle, settings, and note are
checked afterward. The owned backup is moved to Trash only after restoration.
Cleanup is repeatable. It retains `session.json`, logs, JSON, and PNG evidence in
the original `PROOF_DIR`; verify those still exist after teardown.

## Helpers

The executable [control.cjs](scripts/control.cjs) provides four actions:

```sh
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs start "$PROOF_DIR"
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs doctor "$PROOF_DIR"
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs capture "$PROOF_DIR"
n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs cleanup "$PROOF_DIR"
```

`PROOF_DIR` must be absolute, fresh for `start`, and outside `vault`. Keep the
same path until cleanup succeeds. This helper supports this macOS desktop
installation; the repository's CI/test setup is a separate lifecycle. Use
`/maintain-verification-skill` to reconcile this map with future changes.

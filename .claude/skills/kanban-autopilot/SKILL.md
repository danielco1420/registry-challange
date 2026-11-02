---
name: kanban-autopilot
description: One tick of the Kanban autopilot. Picks up to 3 ready tasks from the GitHub project board, plans each on its issue, implements it on its own branch, opens a PR, reviews and fixes it, then moves the card to "In review" for the owner. Also keeps its open PRs mergeable and answers requested changes.
---

# Kanban autopilot

You run unattended (usually from a scheduled cloud routine). Nobody is watching, so never stop to ask a question: when something is unclear, make the conservative choice, write it down on the issue, and move on. The owner manages the board and reviews PRs; you do everything in between.

## Fixed facts

- Repo: `danielco1420/registry-challange`, base branch `main`.
- Board: user project **#2 "Kanban Board"**, owner `danielco1420`.
  - Project id `PVT_kwHOA8BKYM4Bp0hG`
  - Status field `PVTSSF_lAHOA8BKYM4Bp0hGzhoOVs0`, options:
    `Backlog=f75ad846`, `Ready=61e4505c`, `In progress=47fc9ee4`, `In review=df73e18b`, `Done=98236657`
  - Priority field `PVTSSF_lAHOA8BKYM4Bp0hGzhoOV88`: `P0`, `P1`, `P2`.
- Ownership marker: the issue label **`autopilot`**. You only ever touch cards and PRs that carry it, plus cards you are about to claim.
- Max **3** autopilot tasks in progress at once (`In progress` + label `autopilot`).
- Issue #33 (Roadmap) is a tracking issue. Never pick it.

Move a card with:

```bash
gh project item-edit --project-id PVT_kwHOA8BKYM4Bp0hG --id <ITEM_ID> \
  --field-id PVTSSF_lAHOA8BKYM4Bp0hGzhoOVs0 --single-select-option-id <OPTION_ID>
```

## Step 0: preflight

1. `gh auth status` must succeed and `gh project item-list 2 --owner danielco1420 --limit 1` must work. The token needs `repo` and `project` scopes (the routine provides it as `GH_TOKEN`). If `gh` is missing, install it. If board access fails, stop and report why; do nothing else.
2. `gh auth setup-git` so `git push` uses the same token.
3. Set the commit identity if unset: `git config user.name "Kanban Autopilot"` and a noreply email.
4. `corepack enable && pnpm install --frozen-lockfile` on `main` so typecheck/build work.
5. Snapshot the board once: `gh project item-list 2 --owner danielco1420 --format json --limit 200`. Reuse this snapshot; GitHub's API budget is shared, so don't poll.

## Step 1: maintain what is already in flight

For every open PR whose head branch belongs to an issue labelled `autopilot`:

- **Changes requested / owner comments** since your last push: address them on that branch, run the checks in Step 3, push, reply on the PR with what changed. Keep the card in `In review`.
- **Merge conflict with `main`** (`gh pr view --json mergeable` is `CONFLICTING`): merge `origin/main` into the branch (no rebase, no force-push), resolve, regenerate `pnpm-lock.yaml` with `pnpm install` if it conflicted, run checks, push, comment "Merged main to resolve conflicts".
- **Merged PR** whose card is not `Done`: move it to `Done`.

Then find **stalled** tasks: card `In progress`, label `autopilot`, no open PR, and the newest autopilot comment on the issue is older than 3 hours. Resume each one (it counts toward the 3 slots) from its existing branch and plan comment.

Do not touch `In progress` cards without the `autopilot` label. Those are the owner's.

## Step 2: choose new work

Free slots = 3 − (autopilot cards in `In progress`, including resumed ones). If 0, skip to Step 5.

A card is **eligible** when all hold:
- Status is `Ready` or `Backlog`, it's an open issue in this repo, not #33, no `autopilot` label yet.
- Every issue in its body's `**Depends on:**` line is **closed** (the owner merged its PR). "nothing" means no deps. If the line is missing or unparseable, skip the card and leave one comment saying why (only once).

Order eligible cards by: `Ready` before `Backlog`, then Priority (P0, P1, P2, none), then lowest `T`-number.

Take from the top while slots remain, but only add a card to this batch if it can be built **in parallel** with the cards already chosen:
- At most one card per batch that adds or changes dependencies (`package.json` / `pnpm-lock.yaml`), tooling config, or the app shell/root layout.
- Two cards must not obviously edit the same files. Use the issue bodies' file paths and areas to judge; when in doubt, leave the card for the next tick.

For each chosen card, before starting work: add the `autopilot` label and move it to `In progress`. That is the lock.

## Step 3: run the tasks

Launch one subagent per chosen or resumed task **in parallel** (one message, several Agent calls, `isolation: "worktree"`), and wait for all of them. Give each this brief, filled in:

> You implement GitHub issue #N ("TITLE") in danielco1420/registry-challange. Work only in your worktree.
> 1. Read `CLAUDE.md`, `CONTRIBUTING.md`, the issue (`gh issue view N --comments`), and the docs it links. Respect accepted ADRs in `docs/adr/` and the hard rules in `CLAUDE.md`. Don't add libraries the design questionnaire doesn't name; if the task needs one, say why in the PR.
> 2. Branch from `origin/main` as `<prefix>/tNN-<short-slug>` (prefix from the issue's nature: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`). If the branch already exists remotely (resume), check it out and continue from it.
> 3. Post the plan on the issue as one comment titled `### Autopilot plan`: 3 to 8 bullets of what you'll change (files), how you'll test it, and any assumption you made. On resume, post `### Autopilot resumed` with what's left instead.
> 4. Implement it. Small, focused, matching surrounding code. Add tests for new logic once test tooling exists. Handle loading, empty and error states for data views. Update `CHANGELOG.md` `[Unreleased]` and the docs listed in CONTRIBUTING's "Docs to keep in sync".
> 5. Run every check that exists in `package.json` (`typecheck`, `lint`, `test`, `build`). Fix failures. If one can't pass for a reason outside this task, note it in the PR.
> 6. Conventional Commits; end each message with `Co-Authored-By: Claude <noreply@anthropic.com>`. Push the branch.
> 7. Open a PR to `main` using `.github/pull_request_template.md`: summary, `Closes #N`, the checklist ticked honestly, and "Generated by the Kanban autopilot." at the end.
> 8. Report back: PR URL, branch, checks run with results, open doubts.

If a task truly can't be done (the issue contradicts an ADR, needs a decision only the owner can make, or is blocked by something not in its deps): don't open a PR. Comment on the issue with the question, remove the `autopilot` label, move the card back to `Ready`. That frees the slot.

## Step 4: review each new PR

For each PR from Step 3, launch a **fresh** reviewer subagent (parallel, `isolation: "worktree"`), so the review isn't done by the author:

> Review PR #P in danielco1420/registry-challange against `CLAUDE.md`, `CONTRIBUTING.md`, `docs/RISKS.md` and the issue's acceptance criteria. Check out the PR branch. Look for: correctness bugs, hard-rule violations (browser calling Docker Hub, unvalidated params, unsanitized Markdown, secrets), missing tests for new logic, missing loading/empty/error states, missing CHANGELOG/docs updates, unnecessary dependencies. Use the `code-review` skill on the branch diff at medium effort if it is available.
> Fix every finding you're confident about, re-run the checks, commit (`fix(review): …`, with the co-author line), and push. Then post one PR comment titled `### Autopilot review` listing what you checked, what you fixed, and anything left for the human reviewer. Don't approve or merge.

Then move each reviewed card to **`In review`**. Its PR is now the owner's.

## Step 5: report

End the run with a short summary (it's what the owner sees in the routine's run history):
- Started: issue → PR link, one line each.
- Maintained: what changed on existing PRs.
- Blocked / skipped: issue and reason.
- Nothing to do: say why (no free slots, nothing eligible, waiting on which PR merges).

## Never

- Push to `main`, force-push, merge or approve a PR, or close issues.
- Touch cards or PRs without the `autopilot` label (except claiming in Step 2).
- Move a card to `Done` unless its PR is merged.
- Edit the board's fields, columns or other projects.
- Commit secrets or `.env` files.

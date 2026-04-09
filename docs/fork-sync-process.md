# DGCoder Fork Sync Process

This fork should stay close to the upstream T3Code codebase while preserving DGCoder-specific improvements.

## Working Rules

1. Treat upstream T3Code as the source of truth for the base product.
2. Keep DGCoder-only features documented, easy to identify, and covered by targeted verification.
3. Update the GitHub repository description when user-facing improvements land so the repo summary stays accurate.
4. Before opening a PR that changes the fork in a meaningful way, verify the latest upstream T3Code state first instead of assuming this fork is still current.

## Standard Update Flow

1. Confirm the current upstream repository and default branch.
   Use the current T3Code source repository as `upstream`. If that ever changes, update this process before doing more sync work.
2. Fetch the latest upstream branch immediately before the PR.
   Example:

   ```bash
   git remote add upstream <t3code-repo-url>
   git fetch upstream
   git checkout main
   git pull --ff-only origin main
   ```

3. Create a fresh sync branch from the latest upstream base.
   Example:

   ```bash
   git checkout -B sync/upstream-<date> upstream/<default-branch>
   ```

4. Reapply DGCoder changes onto that fresh base.
   Preferred method:
   Use an agent/worker in an isolated branch or worktree to port the fork-specific changes onto the new upstream checkout.

   The agent should:
   - identify DGCoder-only changes relative to upstream
   - re-implement or cherry-pick them onto the fresh upstream branch
   - keep behavioral changes intentional instead of copying stale files wholesale
   - flag conflicts where upstream changed the same area substantially

5. Validate the refreshed branch.
   At minimum:
   - run `bun run typecheck`
   - run targeted tests for touched areas
   - manually verify key UI features that are fork-specific

6. Review the DGCoder delta before PR creation.
   Make sure the diff only contains:
   - the new upstream version
   - intentional DGCoder improvements
   - any required migrations or compatibility fixes

7. Update GitHub metadata before or with the PR.
   - refresh the repository description if the visible feature set changed
   - mention upstream sync status in the PR summary
   - note any fork-only behaviors that must be preserved

## DGCoder-Specific Areas To Preserve

- Beans integration and related task-management UI
- fork maintenance documentation
- any DGCoder workflow tweaks that are intentionally different from upstream

When upstream changes overlap with these areas, prefer adapting the DGCoder behavior to the new upstream structure rather than reverting upstream work.

## PR Checklist

- Upstream was fetched on the same day the PR was prepared.
- The branch was rebuilt from the latest upstream base, not from a stale fork branch.
- DGCoder-only changes were re-applied intentionally.
- Typecheck passed.
- Targeted tests passed.
- The repo description still matches the current feature set.
- The PR summary clearly separates upstream updates from DGCoder changes.

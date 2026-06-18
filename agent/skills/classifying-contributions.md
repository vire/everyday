# Classifying contributions

The `contributions` tool pre-classifies commits into four buckets. Use these definitions to describe them accurately in the digest:

| Bucket | Meaning |
|---|---|
| `me` | Commits authored by the GitHub-authenticated user (`GITHUB_LOGIN` or the result of `gh api user`) with no AI co-author trailer. |
| `meAiAssist` | Commits authored by the same user that include a `Co-authored-by:` trailer whose name/email matches a known AI assistant: Claude, Cursor, Copilot, Devin, or an `@anthropic.com` address. |
| `agent` | Commits whose author login ends with `[bot]` (e.g. `dependabot[bot]`, `github-actions[bot]`). |
| `other` | All other commits — human contributors who are not the authenticated user. |

## How to describe them in the digest

Use plain English, e.g.:
- "3 commits by you, 1 AI-assisted, 2 bot/automated, 4 by others"
- Omit a bucket from the one-liner if its count is zero.

## Keeping the classifier current

If you notice a commit in the raw data whose author looks like an AI agent or bot but is being counted in `other`, record it in memory under **"Notes & recurring patterns"** with the author login. A human can then add it to the tool's marker list. Do not guess or reclassify on your own — report the discrepancy and leave the tool's count unchanged.

---
description: Generate Vietravel test items via vietravel-test-author, append to data/banks.json, validate against the schema, commit, push, and open a PR
argument-hint: [bank=staff|mgr|both] [track=listening,reading,writing|all] [count=N|fill-to-10] [audio=existing|new]
allowed-tools: Bash(git:*), Bash(jq:*), Bash(node:*), Read, Write, Edit, Glob, Task, mcp__github__create_pull_request
---

Generate Vietravel English Test items and open a pull request that adds them to `data/banks.json`.

## Arguments

User supplied: `$ARGUMENTS`

Defaults: `bank=both  track=all  count=fill-to-10  audio=existing`.

`fill-to-10` means: for every requested (bank, track), if current count < 10, add enough to reach 10. Otherwise add 5 by default.

Writing items must be the `short_answer` (LLM-rubric-graded) shape — see the `vietravel-test-author` subagent for the schema. Gap-fill / template+keywords formats are not accepted by the scoring engine.

## Steps

1. `git branch --show-current`. If on `main`/`master`, create a branch:
   ```bash
   git checkout -b content/vietravel-$(date +%Y%m%d-%H%M%S)
   ```

2. Inventory current counts:
   ```bash
   jq '{
     staff: { L: (.BANK_STAFF.listening      | length),
              R: (.BANK_STAFF.reading        | length),
              W: (.BANK_STAFF.writing        | length) },
     mgr:   { L: (.BANK_OFFICE_MGR.listening | length),
              R: (.BANK_OFFICE_MGR.reading   | length),
              W: (.BANK_OFFICE_MGR.writing   | length) }
   }' data/banks.json
   ```

3. Invoke `vietravel-test-author` via the Task tool with the parsed args, inventory, and current topic list. Wait for completion.

4. Run the project's own schema validator on every item (not just JSON.parse):
   ```bash
   node -e "
     const bank = require('./src/lib/bank');
     bank.reload();
     for (const b of ['BANK_STAFF', 'BANK_OFFICE_MGR']) {
       for (const t of ['listening', 'reading', 'writing']) {
         for (const item of bank.listItems(b, t)) {
           try { bank.validateItemShape(t, item); }
           catch (e) { console.error('FAIL', b, t, item.id, '→', e.message); process.exit(1); }
         }
         if (bank.listItems(b, t).length < 10) {
           console.error('FAIL', b, t, 'has fewer than 10 items');
           process.exit(1);
         }
       }
     }
     console.log('✓ all items valid; all tracks ≥ 10');
   "
   ```
   If this fails, ask the subagent to fix and re-validate. Do not commit until it passes.

5. Stage & commit:
   ```bash
   git add data/banks.json
   git diff --cached --stat
   ```
   If nothing is staged, stop with the message *"no new content"*. Otherwise (never amend, never skip hooks):
   ```bash
   git commit -m "Add Vietravel test items: <summary>"
   ```

6. Push with retry on network errors (2 / 4 / 8 / 16 s backoff):
   ```bash
   git push -u origin <branch>
   ```

7. Open a PR via `mcp__github__create_pull_request`:
   - base: `main`
   - title: `Add Vietravel test items: <summary>`
   - body: markdown table of (bank | track | items added | id range) + `audioPending` list (if any) + subagent's validation summary + a note for HR if any new writing rubric criteria differ from the per-CEFR defaults.

8. Return the PR URL.

## Hard rules

- Never push to `main`. Never amend commits. Never bypass hooks.
- Never renumber existing ids.
- If schema validation fails, do NOT commit.
- Audio-pending items must be clearly flagged in the PR body so the recording engineer picks them up.
- Writing items must validate under `bank.validateItemShape('writing', item)` — `type === 'short_answer'`, rubric weights summing to 1.0, `minWords` < `maxWords`.

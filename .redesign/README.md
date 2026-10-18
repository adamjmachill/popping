# Redesign deep-dive tooling

Working files for the planning session, kept on the plan branch so a later
session can pick up after a quota cutoff. Not part of the app.

- `workflow.js`: the deep-dive workflow (readers, three designs, judges,
  synthesis, ten verifiers, completeness critic). Resume in the same
  session with
  `Workflow({scriptPath: <session copy of this file>, resumeFromRunId: "wf_14a9af43-da9"})`.
  The journal lives in the session's container under
  `/root/.claude/projects/-home-user-popping/<session>/subagents/workflows/wf_14a9af43-da9/journal.jsonl`.
- `dump_deepdive.py`: turns that journal into `REDESIGN_DEEP_DIVE.md`.
- `checkpoint.sh`: runs the dump, commits and pushes if anything changed.

If the container was reclaimed, the journal is gone. Everything finished
before that is already in `REDESIGN_DEEP_DIVE.md`; run only the missing
stages, feeding them that file.

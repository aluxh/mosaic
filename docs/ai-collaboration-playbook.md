# AI Agent Collaboration Playbook

A reusable, tech-stack-agnostic setup for working with an AI coding agent
(Claude Code or similar) on any project. It is the generalized version of how
Mosaic is set up. Copy this into a new repo and follow the bootstrap section.

The goal: **the agent's working state never silently goes stale, durable
knowledge survives machine changes, and friction (re-prompts, drift, lost
context) is minimized** — independent of language, framework, or runtime.

---

## Core principles

These are stack-independent. Adapt the *tools*, keep the *rules*.

1. **Spec-driven** — no production code without a written spec. Specs capture
   context, goals, non-goals, data changes, tests, acceptance criteria.
2. **Test-driven** — write the failing test first for anything unit-testable;
   the spec's "Tests" section is the contract.
3. **Single source of truth (SSOT)** — every fact lives in exactly one place.
   Never copy a fact (version, status, history) into a second file; point to
   it. Copies are what rot.
4. **Simplicity & surgical changes** — minimum code; touch only what the task
   needs; match existing style.
5. **Explicit communication** — surface tradeoffs, state assumptions, ask when
   unclear, push back when warranted.

## The three tiers of agent state

The single most important idea: **classify every piece of state into one of
three tiers, and never let a higher tier depend on a lower one.**

| Tier | Lives in | Portable? | Holds | Rule |
|---|---|---|---|---|
| **Contract** | `CLAUDE.md` / `AGENTS.md` (committed, auto-loaded) | ✅ travels with repo | ground rules + a pointer to durable context | the only auto-loaded, always-present layer |
| **Durable** | a **private** repo file (e.g. `agent-context.md`) | ✅ on clone | who you are, preferences, "where things live" map | pointers + non-derivable facts only — **never** copied data |
| **Scratch** | the agent's local memory dir | ❌ machine-local | session notes the harness writes | disposable; promote anything worth keeping up to Durable |

**Why this works on a new machine:** you clone the repos, the agent auto-loads
the Contract (`CLAUDE.md`), which points to the Durable file, which restores
everything. The Scratch tier being wiped costs nothing because nothing
load-bearing lives only there. **No manual "restore my memory" step.**

**The trap to avoid:** putting the bootstrap pointer in the local memory dir.
That dir doesn't exist on a fresh machine, so the pointer that tells the agent
where durable context lives would itself be gone. The pointer MUST live in the
committed, auto-loaded Contract file.

## Anti-staleness: compute, don't store

Any fact that changes often (latest version, current branch, build status)
should be **computed live at session start by a hook**, never written into a
file. Stored mutable facts are the #1 cause of drift.

- ✅ A `SessionStart` hook runs `<vcs> latest-tag` and injects it into context.
- ❌ A memory file that says "we're currently on v1.2.3" (it will lag).

If a fact is in version control already (changelog, roadmap, README), the agent
should **read it on demand**, not mirror it into memory.

## Privacy split: public code vs private context

- Personal/working context (who you are, preferences, internal notes) goes in a
  **private** repo, never in a public one.
- If your main repo is public, keep the Durable file in a private sibling repo
  and point to it by relative path from `CLAUDE.md`
  (e.g. `../<project>-specs/agent-context.md`).

## Hooks: two high-value, portable patterns

Hooks run shell commands at lifecycle events — they cannot reason, but they can
compute and remind. Two patterns pay for themselves on any stack:

**1. SessionStart — inject live ground truth** (kills version staleness):

```jsonc
// .claude/settings.json → hooks.SessionStart[].hooks[]
{
  "type": "command",
  "command": "<command that prints current version/branch/status as JSON additionalContext>"
}
```

The command should emit:
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<live facts>"}}`

**2. PostToolUse — remind at the moment of a milestone** (e.g. a release):

```jsonc
// hooks.PostToolUse[] with matcher "Bash", filtered by `if` to your VCS
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "if": "Bash(git *)",
    "command": "<read the command from stdin; if it cuts a release, print a systemMessage reminder>"
  }]
}
```

Verify any hook before trusting it: pipe a synthetic stdin payload to the raw
command and check the output, then validate the JSON with `jq`.

## Permissions hygiene

The agent's allow-list accretes one-off entries over time. Keep it healthy:

- **Allow durable, broad verbs** (`<vcs> commit *`, `<pkg-mgr> test *`,
  `<build> *`) — not specific invocations.
- **Drop one-offs** — baked-in payloads, throwaway script one-liners, file-
  specific searches. They never recur verbatim; let them re-prompt.
- **Scope file reads narrowly** — to the project and its sibling repos, not the
  whole home directory.
- Periodically prune; collapse redundant specific entries into the broad verb
  that already covers them.

---

## Bootstrap a new project (tech-agnostic)

1. **Write the Contract.** Create `CLAUDE.md` at the repo root with your ground
   rules (start from the Core Principles above). Add a pointer block:

   > Session context & preferences: at the start of every session, read
   > `<path-to-durable-file>`. Current version/status is injected live by a
   > SessionStart hook — do not rely on any hardcoded version.

   Symlink `AGENTS.md → CLAUDE.md` so non-Claude agents read the same file:
   `ln -s CLAUDE.md AGENTS.md`.

2. **Create the Durable file.** In a private repo (or private sibling), create
   `agent-context.md`: who you are, how you like to work, and a "where things
   live" table pointing at your changelog/roadmap/README/build config. **No
   copied status or history.**

3. **Add the two hooks** to `.claude/settings.json` — SessionStart (live
   version/branch) and PostToolUse (release reminder). Adapt the commands to
   your VCS and release ritual. Verify each before relying on it.

4. **Seed the permission allow-list** with broad durable verbs for your stack's
   package manager, build tool, test runner, and VCS. Scope reads narrowly.

5. **Treat the local memory dir as scratch.** Don't store load-bearing facts
   there; promote durable ones into `agent-context.md` and commit.

## Reproduce on a new machine

```
1. Clone the code repo and the private context/specs repo as siblings.
2. Start the agent → it auto-loads CLAUDE.md → reads agent-context.md.
3. The SessionStart hook supplies the live version/branch.
   → Nothing to restore by hand.
```

## Extend it

- New durable fact about how you work → add to `agent-context.md`, commit.
- New mutable fact that would go stale → make a hook compute it instead.
- New recurring command the agent keeps asking about → add the broad verb to
  the allow-list (or run a permission-pruning pass).
- New automated behavior on an event → add a hook (memory/preferences cannot
  trigger actions; only hooks can).

## Map: this playbook ↔ Mosaic's files

| Playbook concept | Mosaic's instance |
|---|---|
| Contract | [`CLAUDE.md`](../CLAUDE.md) (= `AGENTS.md` symlink) |
| Durable context (private) | `../mosaic-specs/agent-context.md` |
| Changelog/roadmap (SSOT) | `../mosaic-specs/roadmap.md` |
| SessionStart + PostToolUse hooks | [`.claude/settings.json`](../.claude/settings.json) |
| Permission allow-list | [`.claude/settings.json`](../.claude/settings.json) |
| Scratch | local agent memory dir (ephemeral) |

# Mosaic — Project Ground Rules

These rules apply to every change in this repository. They override default
behavior. Read them at the start of every session.

## 1. Spec-Driven Development — NO code without a spec

- The high-level roadmap lives at `/spec/roadmap.md`. Update it when a phase
  ships or scope shifts.
- Every feature gets its own `/spec/<feature-name>-spec.md` BEFORE any
  implementation. The spec lists: context, goals, non-goals, user stories,
  data model changes (if any), tests, acceptance criteria, open questions.
- If you're about to write code and there is no spec for what you're
  building, STOP. Write the spec first, get user approval, then implement.

## 2. Test-Driven Development

- Every feature is testable, either via Vitest (preferred for logic +
  components) or via browser verification (for visual/animation work that
  isn't worth asserting in code).
- Write the failing test first when the logic is unit-testable. Pure
  functions (e.g., sequence builders, validators, image-pipeline helpers,
  token signers) must have tests. UI animations are exempt.
- A spec's "Tests" section is the contract — it lists exactly what must
  pass before the feature is considered done.

## 3. Communication preferences

- **Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 4. Simplicity first

- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Test: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 5. Surgical changes

- Touch only what you must. Clean up only your own mess.
- When editing existing code:
  - Don't "improve" adjacent code, comments, or formatting.
  - Don't refactor things that aren't broken.
  - Match existing style, even if you'd do it differently.
  - If you notice unrelated dead code, mention it — don't delete it.
- When your changes create orphans (unused imports/vars/functions),
  remove them. Don't remove pre-existing dead code unless asked.
- The test: every changed line should trace directly to the user's request.

## 6. Goal-driven execution

- Define success criteria before starting. Loop until verified.
- Transform vague tasks into verifiable goals:
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Write a test that reproduces it, then make it pass"
  - "Refactor X" → "Ensure tests pass before and after"
- For multi-step tasks, state the brief plan:
  - `1. [Step] → verify: [check]`
  - `2. [Step] → verify: [check]`
- Strong success criteria let the assistant loop independently. Weak
  criteria ("make it work") require constant clarification.

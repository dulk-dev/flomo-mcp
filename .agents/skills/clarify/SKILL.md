---
name: clarify
description: Use when the user proposes a feature, improvement, refactoring, or bug fix that needs deeper discussion before implementation — or when requirements are vague, scope is unclear, or multiple directions exist. Scans project code, identifies affected layers, and resolves decision branches one at a time.
metadata:
  author: chaochun
  version: "2.1"
  source: dulk-dev/my-skills
  remark: Rewritten from v1. Inspired by grill-me-clarify's concise English style, one-at-a-time questioning, and diagram usage. Adds layer coverage awareness, code-first resolution, evidence-grounded unknown handling, and lightweight high-confidence convergence.
---

## Clarify

Turn vague requirements into actionable scope through code-aware interview.

**Scan** the project to understand structure, tech stack, and relevant modules. Common layers: UI/Interaction, API/Contract, Business Logic, Data/Storage — add others (Auth, Async, External Services, Infra) as needed.

**Ground unknowns** — when an answer is unknown, don't guess. Ground factual uncertainty in available evidence when possible. If the answer still isn't clear, state the uncertainty and ask the user.

**Clarify** each branch that needs resolving, one question at a time — each answer may reveal new branches to explore — until all directions are clear. If the codebase already answers a question, state it and move on.

**Converge** — summarize decisions, output a final diagram, suggest next actions. Only converge or recommend execution when you are highly confident the remaining decisions are clear enough to implement; otherwise continue clarifying.

Exit is user-driven. Never auto-exit.

## Rules

- Ask one question at a time for decisions with dependencies. Batch independent confirmations when natural. For each question, provide your recommended answer.
- Before asking the user, check if the codebase already provides the answer. Only ask when it doesn't.
- For project-specific factual questions, make a reasonable, bounded effort to check local code and project docs before asking the user.
- For external factual questions, use authoritative sources when useful, such as Context7 for library/framework docs, DeepWiki for GitHub repository knowledge, and WebFetch/WebSearch for web facts.
- Don't get tunnel-visioned on one layer. If other directions remain unexplored, nudge the conversation toward them.
- Challenge the user when their words conflict with what the code shows or when something doesn't add up.
- When the user uses vague or overloaded terms, propose a precise canonical term.
- When a concept is better explained visually, use diagrams (ASCII or Mermaid).
- Don't treat unresolved factual uncertainty as clarified scope.
- Only converge or recommend execution when the plan is clear enough to implement with high confidence.
- End each question with the structured question tool.
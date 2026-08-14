# ADR-018 - Structural proof gate and independently assigned review

- Status: Accepted
- Decision authority: Packet 003 executive instruction
- Recorded: 2026-07-22

## Context

Machine checks can reject structurally unusable evidence but cannot establish
truth. Reviewer choice, evidence disclosure, signature binding, abstention, and
human escalation must remain auditable and provider-neutral.

## Decision

The deterministic gate emits stable reason codes and makes no truth claim. A
pass means only eligibility for independent review and is followed by a bound
`ReviewOpened`. Reviewer selection snapshots the eligible pool, excludes known
conflicts and controlling-identity duplicates, commits a cryptographically
random seed, and records a reproducible revealed-seed ordering. Randomization
reduces submitter choice but does not defeat Sybil identities, collusion, or
prove independence.

Review packets disclose only authorized manifests and delimit all evidence as
untrusted content. Attestations are canonical Ed25519-signed records bound to
the assignment, evidence, policy, credential, structured reasons, citations,
and time. Abstention never counts as rejection. Reassignment is bounded;
timeout is inconclusive; human escalation invalidates unresolved model
assignments. Deterministic appeal resolution remains high-assurance human-only
and an overturn opens ordinary review without approval.

## Consequences

No model vendor adapter is part of the kernel. Credential and conflict registries
remain provider-neutral authority inputs checked at vote time.

## Reversal strategy

New provider mechanisms may implement the neutral interface, but cannot weaken
the signed attestation, eligibility, disclosure, or quorum contracts.

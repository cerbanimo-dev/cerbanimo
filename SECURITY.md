# Security policy

## Reporting

Do not disclose a suspected vulnerability, leaked credential, identity record,
or evidence artifact in a public issue, discussion, pull request, test fixture,
or commit.

Use GitHub private vulnerability reporting for this repository when it is
available. If that channel is unavailable, contact the repository maintainers
through an already established private channel and include only the minimum
information needed to coordinate a safer transfer. Do not attach production
evidence or live secrets to the first message.

If a secret has entered Git history, treat it as compromised immediately:
revoke or rotate it first, preserve the incident facts privately, then
coordinate history remediation. Removing a visible file is not sufficient.

## Supported state

This repository is a pre-release Packet 003 foundation. There is no supported
production deployment or public API release yet. Security fixes apply to the
current `main` line unless a release notice explicitly states otherwise.

## Sensitive material policy

Never commit:

- access tokens, API keys, private/signing keys, passphrases, recovery material,
  or environment files
- database files, backups, logs, crash dumps, instantiated vaults, or custody
  keys
- real evidence narratives or artifact bytes
- root identities, membership records, device authorizations, or local identity
  exports
- the frozen reference ZIP

Use synthetic data in tests. Run `npm run verify:publication` before committing
and inspect the staged diff even when the boundary check passes.

## Scope notes

Hash chains and receipt digests are corruption-detection controls, not
authenticity claims. Structural proof establishes eligibility for independent
review, not factual truth. Reviewer randomization does not eliminate collusion
or Sybil identities. See the packet reports for the complete residual-threat
record.

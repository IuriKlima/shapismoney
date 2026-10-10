# Local durable drafts - production remains closed

Complete current anamnesis creates durable intentions in `operations`, in the same
transaction as its update. Missing professional context/consent blocks the intention.
The worker generates only after current service access, assigned active professional,
current purpose consent, professional review and existing engine guards all pass.
Every dependency version has one job. Duplicate events/scans do not call again.
Changes supersede pending work and discard in-flight output; published plans are never
updated. A new result is a new `draft`, with `automaticDraft`, provenance and reservation,
without `confirmedBy` or approval. Existing submit/approve/publish transitions apply.
Publication queues the separate protocol notice atomically; drafts do not notify students.

The coordinator does not fabricate sessions. A reviewed worker delegation authorizes
work for the currently assigned professional; authorization is rechecked before dispatch
and inside the draft transaction. The worker cannot widen role, organization or service.
Queries: `GET /api/local/students/:id/draft-jobs`. The linked professional may POST
`/:jobId/retry` or `/:jobId/reconcile` with `{version,reason,confirmed:true}` and an
idempotency key. Retry permits only a known offline failure, at most three attempts.
An external failure/expired lease is reconciled and closed, never automatically resent.
Lease recovery does not refund or retry. Raw provider errors/output are not stored in jobs.

## Opt-in contract, no credentials here

`draftJobConfiguration` reads no files or secrets and returns `{}` while disabled.
Runtime flags required for a bounded *local* pilot:

| Flag | Constraint |
| --- | --- |
| `SIM_DRAFT_JOBS_ENABLED` | `true`; default off |
| `SIM_DRAFT_JOBS_REVIEWED` | `true`; reviewed automatic draft delegation |
| `SIM_DRAFT_JOBS_EXPIRES_AT` | future Unix milliseconds, at most 24 hours |
| `SIM_DRAFT_JOBS_MAX_ATTEMPT_USD` | positive, at most 0.05 |
| `SIM_DRAFT_JOBS_TOTAL_USD` | positive, at most 0.10 per reviewed window, installation-wide |
| `SIM_DRAFT_JOBS_MAX_CALLS` | 1 or 2 attempts, default 2; durable across restart |
| `SIM_DRAFT_JOBS_NETWORK_REVIEWED` | separate explicit `true` before any network dispatch |

Before each attempt: shared installation/student monthly ledger (including chat),
conservative token reservation, per-attempt and total cap, five preparations/messages per
professional/minute and four draft attempts/student/day. Failed/uncertain attempts retain
the reservation. These are conservative reservations, not verified invoice costs.
Inputs are bounded to 8,000 token upper bound and 18,000 bytes; output cap is 4,000.
Timer is 15 seconds, lease 30 seconds, provider timeout at most 20 seconds, no automatic retry.

The existing independent engine gates still apply. Training needs
`SIM_TRAINING_EXTERNAL_ENABLED`, `SIM_TRAINING_MODEL`, `SIM_TRAINING_EXPIRES_AT`,
`SIM_TRAINING_METHOD_FILE`, `SIM_TRAINING_GLOBAL_MONTHLY_USD`,
`SIM_TRAINING_ADMIN_MONTHLY_USD`, `SIM_TRAINING_INPUT_RATE`, `SIM_TRAINING_OUTPUT_RATE`.
Nutrition needs corresponding `SIM_NUTRITION_EXTERNAL_ENABLED`, `SIM_NUTRITION_MODEL`,
`SIM_NUTRITION_EXPIRES_AT`, `SIM_NUTRITION_GLOBAL_MONTHLY_USD`,
`SIM_NUTRITION_ADMIN_MONTHLY_USD`, `SIM_NUTRITION_INPUT_RATE`, `SIM_NUTRITION_OUTPUT_RATE`.
Both engines and the worker reject production. Flags alone cannot activate production.
Existing project credentials are not changed or inspected by this increment.

Real prerequisites: reviewed `SIM_PRIVATE_METHOD_V1` with sources/rules and eligible
exercise catalog; authorized source/rule transfer; linked current professional and
student consent; resolved intake review. Training with risk remains closed externally
until structured restrictions exist. Nutrition also needs an actually checked CRN,
approved food/preparation/composition catalog, professional targets/tolerances/meals,
current reviewed per-student context and its transfer/consent. Private corpus search
does not supply food composition or clinical approval.

## Private sources and integration boundary

`scripts/index-private-sources.py SOURCE_DIR .qa/private-corpus.json` extracts only the
named DOCX, PRD and seven chapters with SHA-256 and page/paragraph/offset provenance.
`retrievePrivateSources` searches this local index for local inspection. Extraction
does not approve or connect the real corpus. Optional `SIM_TRAINING_REFERENCES_ENABLED`
and `SIM_TRAINING_REFERENCES_FILE` (nutrition: `SIM_NUTRITION_REFERENCES_ENABLED` and
`SIM_NUTRITION_REFERENCES_FILE`) load a separate bundle only when the corresponding
engine is explicitly enabled locally. The file must resolve inside `.qa`, not be a
symlink, and be at most 2 MB. No reads while the engine is off; production rejects it.

`SIM_APPROVED_REFERENCE_BUNDLE_V1` has kind, orgId, version, current professional
review (by/role/at; nutrition credentialRevision) and a `SIM_LOCAL_CORPUS_V1` corpus.
Its approvals identify chunkId, approved status, exact textSha256, sourceId/version/hash,
ruleIds and explicit providerTransferApproved. Reviewer role/org/active status and
nutrition credential are checked against the DB, not accepted solely from the file.
Only approved matching source/rule/text enters `untrustedMethod.retrievedReferences`;
network-capable modes also require reviewed transfer permission. Pending entries never
substitute for approval. Selection is bounded to three chunks / 6,000 bytes and the
existing total input cap. No eligible approved match fails closed, without fallback.
Draft provenance stores the bundle hash/version, reviewer and retrieved source/locator/
text hashes, not raw reference text. Changes invalidate pending output and approval.
Nutrition targets/composition still come from the professional context/catalog. Training
parameters remain drafts requiring professional review; retrieval creates no quantitative
rules or prescription defaults from general principles. The real 676 chunks remain
unapproved and unconfigured; only synthetic fixtures exercised this integration.
No embeddings or external calls were used.
Keep source files, corpus, approvals and MP4s out of Git.

No new migration: this patch uses existing `operations` and ledger tables through 007.
UX's 008 remains reserved for Radar/student profile. Merge service/server/persistent UI
and Docker whitelist changes deliberately; do not overwrite the UX routes/options.
If normalized jobs become necessary, use 009 after merging 008 in SQLite and PostgreSQL.
Commerce checkout is separate and unmerged; there is no production purchase-to-protocol proof.

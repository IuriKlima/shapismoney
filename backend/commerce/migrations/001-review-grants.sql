-- REVIEW ONLY: PostgreSQL role exercise in PGlite, never normal migrations.
-- Runtime is still fixture-only SQLite. Do not execute in production.
GRANT SELECT,INSERT,UPDATE,DELETE ON commerce_buyers,commerce_orders,commerce_events,commerce_entitlements,commerce_tasks,commerce_interest,commerce_audit,commerce_payments,commerce_registrations,commerce_student_sources,commerce_buyer_sessions,commerce_outbox,commerce_identity_proofs TO sim_commerce_fixture;
-- No DDL, migration-table writes or provider-fixture table grants.

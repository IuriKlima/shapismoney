CREATE TABLE radar_leads(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',marketing INTEGER NOT NULL CHECK(marketing IN (0,1)),consent_version TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(org_id,email));
CREATE TABLE radar_runs(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES radar_leads(id),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,state TEXT NOT NULL,version TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE radar_events(run_id TEXT NOT NULL REFERENCES radar_runs(id),event TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,event));
CREATE TABLE radar_registrations(operation_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES radar_runs(id));
CREATE TABLE radar_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE INDEX radar_leads_org ON radar_leads(org_id,updated_at);
CREATE TABLE student_profiles(student_id TEXT PRIMARY KEY REFERENCES students(id),display_name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',photo TEXT,revision INTEGER NOT NULL DEFAULT 1);

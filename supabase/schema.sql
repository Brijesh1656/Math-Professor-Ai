-- ============================================================
-- Math Professor AI — Research Logging Schema
-- Run this SQL in your Supabase project's SQL editor.
-- ============================================================

-- Enable UUID extension (required for uuid_generate_v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- Main research logs table
-- One row per agentic reasoning turn (sub-query), not per user
-- message.  Multiple rows share the same session_id when they
-- belong to the same agentic chain.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_logs (
  id                    UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- Session & turn identification
  session_id            TEXT          NOT NULL,
  turn_number           INTEGER       NOT NULL,

  -- Query content
  sub_query             TEXT          NOT NULL,          -- Decomposed sub-query text
  original_query        TEXT          NOT NULL,          -- Original user question

  -- Retrieval metrics
  rag_chunk_count       INTEGER       NOT NULL DEFAULT 0, -- Chunks from TF-IDF (Tier 1)
  grounding_chunk_count INTEGER       NOT NULL DEFAULT 0, -- Chunks from Google Search (Tier 3)
  context_token_count   INTEGER       NOT NULL DEFAULT 0, -- Approximate tokens in accumulated context
  used_web_search       BOOLEAN       NOT NULL DEFAULT FALSE,
  retrieval_tier        INTEGER       NOT NULL DEFAULT 3
                          CHECK (retrieval_tier IN (1, 2, 3)),
  similarity_score      FLOAT         NOT NULL DEFAULT 0.0,

  -- Experiment condition
  anchoring_enabled     BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Human feedback
  was_correct           BOOLEAN,                         -- NULL until feedback received

  -- Classification
  problem_type          TEXT          DEFAULT 'other',

  -- Timestamps
  timestamp             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ   DEFAULT NOW(),

  -- Privacy: hashed IP — raw IP is NEVER stored
  ip_hash               TEXT          NOT NULL
);

-- ------------------------------------------------------------
-- Indexes for common query patterns
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rag_logs_session_id
  ON rag_logs (session_id);

CREATE INDEX IF NOT EXISTS idx_rag_logs_ip_timestamp
  ON rag_logs (ip_hash, timestamp);

CREATE INDEX IF NOT EXISTS idx_rag_logs_timestamp
  ON rag_logs (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_rag_logs_problem_type
  ON rag_logs (problem_type);

CREATE INDEX IF NOT EXISTS idx_rag_logs_retrieval_tier
  ON rag_logs (retrieval_tier);

-- ------------------------------------------------------------
-- Row Level Security
-- Public reads are blocked.  Only the service role (used by the
-- Flask backend) may insert rows.
-- ------------------------------------------------------------
ALTER TABLE rag_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running this script
DROP POLICY IF EXISTS "service_role_insert" ON rag_logs;

CREATE POLICY "service_role_insert"
  ON rag_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Optional: allow authenticated researchers to SELECT for analysis
-- Uncomment and adjust the role as needed:
-- CREATE POLICY "researcher_select"
--   ON rag_logs
--   FOR SELECT
--   TO authenticated
--   USING (true);

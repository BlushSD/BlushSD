-- Blush SD inquiries database (Cloudflare D1)
-- Paste this into the D1 console once, when the database is first created.
-- The database is only reachable through the blush-inquiries Worker;
-- it has no public URL and no browser-facing keys.

CREATE TABLE IF NOT EXISTS inquiries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT    NOT NULL UNIQUE,   -- shown to the customer, e.g. BL-7K3Q-M9XD (random, not sequential)
  ig_token       TEXT    NOT NULL UNIQUE,   -- long random token used only in the Instagram link (Phase 5)
  submission_id  TEXT    NOT NULL UNIQUE,   -- one per form load; stops double-submits creating duplicates
  service        TEXT    NOT NULL CHECK (service IN ('florals', 'catering')),
  name           TEXT    NOT NULL,
  email          TEXT,                      -- optional
  phone          TEXT    NOT NULL,          -- required: Noor replies by text
  event_date     TEXT,                      -- YYYY-MM-DD
  venue          TEXT,                      -- florals form
  guests         INTEGER,                   -- catering form
  message        TEXT,
  ip_hash        TEXT,                      -- salted hash for rate limiting; the raw IP is never stored
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  notified_at    TEXT,                      -- set when Noor's phone alert is delivered
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  ig_user_id     TEXT,                      -- set when the customer opens the Instagram chat (Phase 5)
  ig_linked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_ip      ON inquiries (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_notify  ON inquiries (notified_at, created_at);

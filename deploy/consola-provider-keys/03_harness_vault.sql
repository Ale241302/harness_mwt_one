CREATE TABLE IF NOT EXISTS core.harness_provider_keys (
  owner_email text NOT NULL,
  ref text NOT NULL,
  ciphertext text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_email, ref)
);
ALTER TABLE core.harness_provider_keys
  ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS harness_provider_keys_owner_idx
  ON core.harness_provider_keys (owner_email);

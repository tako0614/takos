ALTER TABLE accounts
ADD COLUMN security_posture TEXT NOT NULL DEFAULT 'standard'
CHECK (security_posture IN ('standard', 'restricted_egress'));

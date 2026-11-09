-- Existing members keep their identities and data and choose a nickname on next login.
-- Nicknames need not be unique: the internal member ID remains the account identity.
ALTER TABLE member_users ADD COLUMN nickname TEXT;

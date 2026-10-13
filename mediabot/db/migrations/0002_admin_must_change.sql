-- Forces an administrator to choose a new password at the next sign-in. Used by the default
-- administrator that is created on the first start when no administrator exists.
ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

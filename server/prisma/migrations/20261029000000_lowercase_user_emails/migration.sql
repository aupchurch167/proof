-- Normalize account emails that can be lowercased without colliding with
-- another row. Mixed-case duplicates (Admin@x.com and admin@x.com both
-- present) are left untouched: this migration does not delete, merge, or
-- overwrite a second account. The app looks those up case-insensitively and
-- keeps the oldest row when several still differ only by case.
UPDATE "User" AS u
SET email = lower(btrim(u.email))
WHERE u.email IS NOT NULL
  AND u.email <> lower(btrim(u.email))
  AND NOT EXISTS (
    SELECT 1
    FROM "User" AS other
    WHERE other.id <> u.id
      AND lower(btrim(other.email)) = lower(btrim(u.email))
  );

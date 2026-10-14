ALTER TABLE "ClinicMembership" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;

WITH ranked_members AS (
  SELECT
    membership.id,
    ROW_NUMBER() OVER (PARTITION BY membership."clinicId" ORDER BY (users.email = 'admin') DESC, (membership."userId" = 'admin-user') DESC, users."createdAt", membership.id) AS position
  FROM "ClinicMembership" AS membership
  INNER JOIN "User" AS users ON users.id = membership."userId"
  WHERE membership.role = 'ADMIN'
)
UPDATE "ClinicMembership" AS membership
SET "isOwner" = true
FROM ranked_members
WHERE membership.id = ranked_members.id
  AND ranked_members.position = 1;

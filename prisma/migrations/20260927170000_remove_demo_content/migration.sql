-- Remove only the repository's seeded demo records and the flag used to expose them.
DELETE FROM "Interview"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "isDemo" = true);

DELETE FROM "Interview"
WHERE "candidateId" IN (SELECT "id" FROM "Candidate" WHERE "email" = 'maya.demo@example.com');

DELETE FROM "Candidate"
WHERE "email" = 'maya.demo@example.com'
  AND NOT EXISTS (SELECT 1 FROM "Interview" WHERE "candidateId" = "Candidate"."id");

DELETE FROM "Role" WHERE "isDemo" = true;

ALTER TABLE "Role" DROP COLUMN "isDemo";

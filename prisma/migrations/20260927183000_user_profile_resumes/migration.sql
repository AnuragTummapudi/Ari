CREATE TABLE "UserProfile" (
  "userId" TEXT NOT NULL,
  "targetRole" TEXT,
  "preferredResumeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "UserResume" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "claims" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserResume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserResume_storageKey_key" ON "UserResume"("storageKey");
CREATE INDEX "UserResume_userId_createdAt_idx" ON "UserResume"("userId", "createdAt");

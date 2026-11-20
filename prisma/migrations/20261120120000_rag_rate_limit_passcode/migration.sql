CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Interview" ADD COLUMN "passcodeHash" TEXT;
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

CREATE TABLE "ResumeChunk" (
  "id" TEXT NOT NULL,
  "interviewId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(384) NOT NULL,
  CONSTRAINT "ResumeChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResumeChunk_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ResumeChunk_interviewId_idx" ON "ResumeChunk"("interviewId");
CREATE INDEX "ResumeChunk_embedding_idx" ON "ResumeChunk" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "RateLimit" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('INVITED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "Speaker" AS ENUM ('ARI', 'CANDIDATE');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "rubric" JSONB NOT NULL,
    "blueprint" JSONB NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "resumeText" TEXT,
    "resumeClaims" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'INVITED',
    "stage" TEXT NOT NULL DEFAULT 'opening',
    "coverage" JSONB NOT NULL DEFAULT '[]',
    "blueprint" JSONB,
    "consent" JSONB,
    "integrityEvents" JSONB NOT NULL DEFAULT '[]',
    "roomName" TEXT,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "speaker" "Speaker" NOT NULL,
    "text" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "skillTags" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "final" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "improvementPlan" JSONB NOT NULL DEFAULT '[]',
    "reviewerOverrides" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_email_key" ON "Candidate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_roomName_key" ON "Interview"("roomName");

-- CreateIndex
CREATE INDEX "Interview_roleId_status_idx" ON "Interview"("roleId", "status");

-- CreateIndex
CREATE INDEX "Turn_interviewId_startedAt_idx" ON "Turn"("interviewId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_interviewId_key" ON "Report"("interviewId");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;


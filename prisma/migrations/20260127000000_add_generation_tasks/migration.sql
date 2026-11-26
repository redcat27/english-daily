-- CreateTable
CREATE TABLE IF NOT EXISTS "english"."generation_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskKey" VARCHAR(40) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "error" VARCHAR(300) NOT NULL DEFAULT '',
    "summary" VARCHAR(400) NOT NULL DEFAULT '',

    CONSTRAINT "generation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "generation_tasks_userId_taskKey_key" ON "english"."generation_tasks"("userId", "taskKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "generation_tasks_userId_status_idx" ON "english"."generation_tasks"("userId", "status");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "english"."generation_tasks" ADD CONSTRAINT "generation_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


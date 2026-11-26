-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "english";

-- CreateTable
CREATE TABLE "english"."users" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'A2',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "english"."daily_lessons" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "scene" VARCHAR(60) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "english"."word_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "word" VARCHAR(80) NOT NULL,
    "phonetic" VARCHAR(80) NOT NULL DEFAULT '',
    "pos" VARCHAR(20) NOT NULL DEFAULT '',
    "meaning" VARCHAR(160) NOT NULL,
    "example" VARCHAR(300) NOT NULL DEFAULT '',
    "exampleCn" VARCHAR(300) NOT NULL DEFAULT '',
    "scene" VARCHAR(60) NOT NULL DEFAULT '',
    "box" INTEGER NOT NULL DEFAULT 1,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "word_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "english"."review_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "word" VARCHAR(80) NOT NULL,
    "result" VARCHAR(10) NOT NULL,
    "boxBefore" INTEGER NOT NULL,
    "boxAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "english"."feedbacks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shadowing" INTEGER NOT NULL,
    "reading" INTEGER NOT NULL,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_key_key" ON "english"."users"("key");

-- CreateIndex
CREATE INDEX "daily_lessons_userId_date_idx" ON "english"."daily_lessons"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_lessons_userId_date_key" ON "english"."daily_lessons"("userId", "date");

-- CreateIndex
CREATE INDEX "word_progress_userId_dueDate_idx" ON "english"."word_progress"("userId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "word_progress_userId_word_key" ON "english"."word_progress"("userId", "word");

-- CreateIndex
CREATE INDEX "review_events_userId_createdAt_idx" ON "english"."review_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "feedbacks_userId_date_idx" ON "english"."feedbacks"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "feedbacks_userId_date_key" ON "english"."feedbacks"("userId", "date");

-- AddForeignKey
ALTER TABLE "english"."daily_lessons" ADD CONSTRAINT "daily_lessons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "english"."word_progress" ADD CONSTRAINT "word_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "english"."review_events" ADD CONSTRAINT "review_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "english"."feedbacks" ADD CONSTRAINT "feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


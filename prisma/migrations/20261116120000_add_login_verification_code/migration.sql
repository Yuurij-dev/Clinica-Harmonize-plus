-- CreateTable
CREATE TABLE "LoginVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sends" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMPTZ(6) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginVerificationCode_userId_key" ON "LoginVerificationCode"("userId");

-- AddForeignKey
ALTER TABLE "LoginVerificationCode" ADD CONSTRAINT "LoginVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

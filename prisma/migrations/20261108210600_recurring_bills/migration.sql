-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "period" TEXT,
ADD COLUMN     "recurringBillId" TEXT;

-- CreateTable
CREATE TABLE "RecurringBill" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payerId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'rent',
    "splitMethod" "SplitMethod" NOT NULL DEFAULT 'EQUAL',
    "participants" JSONB NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringBill_householdId_idx" ON "RecurringBill"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringBillId_period_key" ON "Expense"("recurringBillId", "period");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringBillId_fkey" FOREIGN KEY ("recurringBillId") REFERENCES "RecurringBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;


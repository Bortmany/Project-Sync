-- Completion gating queries dependencies by successor; the unique index only serves the predecessor direction.
CREATE INDEX "TaskDependency_successorId_idx" ON "TaskDependency"("successorId");

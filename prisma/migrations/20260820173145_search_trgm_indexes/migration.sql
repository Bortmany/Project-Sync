-- Trigram indexes so global search stays fast on partial-word matches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE INDEX IF NOT EXISTS "Project_name_trgm_idx" ON "Project" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MainTask_title_trgm_idx" ON "MainTask" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DisciplineTask_title_trgm_idx" ON "DisciplineTask" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Document_title_trgm_idx" ON "Document" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_name_trgm_idx" ON "User" USING gin ("name" gin_trgm_ops);

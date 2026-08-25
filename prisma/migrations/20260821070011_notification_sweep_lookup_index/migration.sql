-- The hourly deadline sweep asks "have I already told this person about this task?" by
-- notification type + link, which was a full scan of the fastest-growing table in the app.
-- Additive only: no column, model or enum value changes.
CREATE INDEX "Notification_type_linkUrl_idx" ON "Notification"("type", "linkUrl");

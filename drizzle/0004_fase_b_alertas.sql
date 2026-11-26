ALTER TABLE `deal_alert` ADD `ack_at` integer;--> statement-breakpoint
ALTER TABLE `deal_alert` ADD `action` text;--> statement-breakpoint
ALTER TABLE `deal_alert` ADD `snooze_until` integer;--> statement-breakpoint
CREATE INDEX `i_alert_action` ON `deal_alert` (`action`,`snooze_until`);--> statement-breakpoint
ALTER TABLE `run` ADD `alerts` integer DEFAULT 0 NOT NULL;
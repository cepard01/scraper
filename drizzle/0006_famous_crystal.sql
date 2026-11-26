CREATE TABLE `ai_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`task` text NOT NULL,
	`combo` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_ai_cache_key` ON `ai_cache` (`key`);--> statement-breakpoint
CREATE INDEX `i_ai_cache_task` ON `ai_cache` (`task`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_call_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`batch_size` integer DEFAULT 0 NOT NULL,
	`cache_key` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `i_ai_call_task_time` ON `ai_call_log` (`task`,`created_at`);--> statement-breakpoint
ALTER TABLE `deal_alert` ADD `flags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `run` ADD `ai_cache_hits` integer DEFAULT 0 NOT NULL;
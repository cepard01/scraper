CREATE TABLE `ai_deferred` (
	`listing_id` integer PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `i_ai_deferred_task` ON `ai_deferred` (`task`,`created_at`);
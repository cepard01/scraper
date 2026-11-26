CREATE TABLE `deal_alert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`listing_id` integer NOT NULL,
	`channel` text DEFAULT 'ntfy' NOT NULL,
	`alerted_at_cents` integer NOT NULL,
	`delivered_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `i_alert_listing` ON `deal_alert` (`listing_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `search_monitor` ADD `muted_until` integer;
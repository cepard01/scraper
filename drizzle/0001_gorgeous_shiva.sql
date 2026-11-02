CREATE TABLE `purchase` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer,
	`fingerprint_id` integer,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`paid_cents` integer NOT NULL,
	`shipping_in_cents` integer DEFAULT 0 NOT NULL,
	`repair_cents` integer DEFAULT 0 NOT NULL,
	`other_costs_cents` integer DEFAULT 0 NOT NULL,
	`fees_in_cents` integer DEFAULT 0 NOT NULL,
	`ref_median_cents` integer,
	`bought_at` integer NOT NULL,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`closed_at` integer,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `i_purchase_status` ON `purchase` (`status`);--> statement-breakpoint
CREATE INDEX `i_purchase_fp` ON `purchase` (`fingerprint_id`,`category`);--> statement-breakpoint
CREATE TABLE `sale` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`sold_cents` integer NOT NULL,
	`platform` text NOT NULL,
	`platform_fee_cents` integer NOT NULL,
	`shipping_out_cents` integer DEFAULT 0 NOT NULL,
	`other_costs_cents` integer DEFAULT 0 NOT NULL,
	`sold_at` integer NOT NULL,
	`buyer_ref` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchase`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_sale_purchase` ON `sale` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `i_sale_time` ON `sale` (`sold_at`);
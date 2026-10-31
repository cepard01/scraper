CREATE TABLE `comparable_ref` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`valuation_id` integer NOT NULL,
	`listing_id` integer NOT NULL,
	`asking_cents` integer NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`valuation_id`) REFERENCES `valuation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listing`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fingerprint` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`category` text NOT NULL,
	`brand` text,
	`model` text,
	`variant` text,
	`grade` text,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_fingerprint_key` ON `fingerprint` (`key`);--> statement-breakpoint
CREATE INDEX `i_fingerprint_model` ON `fingerprint` (`category`,`brand`,`model`);--> statement-breakpoint
CREATE TABLE `listing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`monitor_id` integer,
	`fingerprint_id` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`asking_cents` integer NOT NULL,
	`asking_raw` text DEFAULT '' NOT NULL,
	`grade` text,
	`city` text,
	`uf` text,
	`image_urls` text DEFAULT '[]' NOT NULL,
	`seller_ref` text,
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`dupe_of` integer,
	`raw_payload` text,
	`parser_version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_listing_source_ext` ON `listing` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `i_listing_fingerprint` ON `listing` (`fingerprint_id`);--> statement-breakpoint
CREATE INDEX `i_listing_status_seen` ON `listing` (`status`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `opportunity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`valuation_id` integer,
	`asking_cents` integer NOT NULL,
	`fair_gross_cents` integer,
	`costs_in_cents` integer NOT NULL,
	`net_realizable_cents` integer,
	`margin_cents` integer,
	`margin_pct` real,
	`expected_per_day_cents` integer,
	`liquidity_days` integer NOT NULL,
	`score` real NOT NULL,
	`breakdown` text NOT NULL,
	`gate_passed` integer DEFAULT false NOT NULL,
	`gate_reason` text NOT NULL,
	`ai_verdict` text,
	`ai_reasons` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listing`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `i_opp_score` ON `opportunity` (`gate_passed`,`score`);--> statement-breakpoint
CREATE INDEX `i_opp_listing` ON `opportunity` (`listing_id`);--> statement-breakpoint
CREATE TABLE `price_point` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`asking_cents` integer NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listing`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `i_pricepoint_listing_time` ON `price_point` (`listing_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text,
	`fetched` integer DEFAULT 0 NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`repriced` integer DEFAULT 0 NOT NULL,
	`unchanged` integer DEFAULT 0 NOT NULL,
	`rejected` text DEFAULT '{}' NOT NULL,
	`unmatched` integer DEFAULT 0 NOT NULL,
	`ai_calls` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `search_monitor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`query` text NOT NULL,
	`category` text,
	`params` text DEFAULT '{}' NOT NULL,
	`interval_minutes` integer DEFAULT 30 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`last_yield` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `valuation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint_id` integer NOT NULL,
	`sample_size` integer NOT NULL,
	`median_cents` integer,
	`p25_cents` integer,
	`p75_cents` integer,
	`fair_gross_cents` integer,
	`delta` real NOT NULL,
	`liquidity_days` integer NOT NULL,
	`liquidity_source` text NOT NULL,
	`confidence` text NOT NULL,
	`variant_agnostic` integer DEFAULT false NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`fingerprint_id`) REFERENCES `fingerprint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `i_valuation_fp` ON `valuation` (`fingerprint_id`,`computed_at`);
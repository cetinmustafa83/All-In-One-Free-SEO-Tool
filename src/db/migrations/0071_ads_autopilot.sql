-- Ads Autopilot — self-hosted ad watchdog for Google + Meta accounts.
--
-- Ported from AdCrewOS's PostgreSQL model and flattened for SQLite:
-- the per-account Target row became columns on ad_accounts (the engine
-- only ever read targets[0]), and MetricSnapshot became
-- ad_metric_snapshots with a revenue column so ROAS is auditable.

CREATE TABLE `ad_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`client_id` integer,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`daily_budget` real DEFAULT 50 NOT NULL,
	`metric` text DEFAULT 'ROAS' NOT NULL,
	`target_value` real DEFAULT 3 NOT NULL,
	`pause_threshold` real DEFAULT 1.6 NOT NULL,
	`scale_threshold` real DEFAULT 4.2 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_accounts_platform_external_idx` ON `ad_accounts` (`platform`,`external_id`);
--> statement-breakpoint
CREATE TABLE `ad_metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ad_account_id` integer NOT NULL,
	`ts` integer DEFAULT (unixepoch()) NOT NULL,
	`spend` real DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`conversions` real DEFAULT 0 NOT NULL,
	`revenue` real DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`cpc` real DEFAULT 0 NOT NULL,
	`cpa` real DEFAULT 0 NOT NULL,
	`roas` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ad_metric_snapshots_account_ts_idx` ON `ad_metric_snapshots` (`ad_account_id`,`ts`);
--> statement-breakpoint
CREATE TABLE `ad_automation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ad_account_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'LOGGED' NOT NULL,
	`reason` text NOT NULL,
	`metric` text,
	`observed` real,
	`threshold` real,
	`proposed_pct` integer,
	`proposed_budget` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ad_automation_events_account_created_idx` ON `ad_automation_events` (`ad_account_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `ad_automation_events_status_idx` ON `ad_automation_events` (`status`);

CREATE TABLE `client_metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`kind` text DEFAULT 'weekly' NOT NULL,
	`health_score` integer,
	`organic_clicks` integer,
	`organic_impressions` integer,
	`organic_avg_position_x100` integer,
	`ga4_sessions` integer,
	`ga4_users` integer,
	`keyword_count` integer,
	`avg_rank_x100` integer,
	`top10_count` integer,
	`critical_issues` integer,
	`high_issues` integer,
	`backlink_count` integer,
	`gbp_score` integer,
	`mention_count` integer,
	`tasks_done_recent` integer,
	`captured_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_metric_snapshots_idx` ON `client_metric_snapshots` (`client_id`, `captured_at`);

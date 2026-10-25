ALTER TABLE `keyword_rankings` ADD `has_ai_overview` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `keyword_rankings` ADD `has_featured_snippet` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `keyword_rankings` ADD `has_local_pack` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `keyword_rankings` ADD `paa_count` integer DEFAULT 0;--> statement-breakpoint
CREATE TABLE `bot_log_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`source_name` text,
	`raw_byte_size` integer,
	`line_count` integer,
	`bot_counts` text,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);

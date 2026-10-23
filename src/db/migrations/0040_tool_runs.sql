CREATE TABLE `tool_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`tool_id` text NOT NULL,
	`label` text NOT NULL,
	`input_json` text,
	`result_json` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tool_runs_tool_idx` ON `tool_runs` (`tool_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `tool_runs_client_idx` ON `tool_runs` (`client_id`, `created_at`);

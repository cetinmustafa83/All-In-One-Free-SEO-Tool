CREATE TABLE `ai_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature` text NOT NULL,
	`client_id` integer,
	`ai_output` text NOT NULL,
	`corrected_output` text,
	`rating` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`feature` text NOT NULL,
	`rule` text NOT NULL,
	`confidence` text DEFAULT 'low' NOT NULL,
	`derived_from` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);

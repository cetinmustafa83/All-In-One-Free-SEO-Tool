ALTER TABLE `backlinks` ADD `source` text DEFAULT 'discovered' NOT NULL;--> statement-breakpoint
ALTER TABLE `backlinks` ADD `method` text;--> statement-breakpoint
ALTER TABLE `backlinks` ADD `rel` text;--> statement-breakpoint
ALTER TABLE `backlinks` ADD `placed_at` integer;

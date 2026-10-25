CREATE TABLE `outreach_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`variables` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outreach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`template_id` integer,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `outreach_contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `outreach_templates`(`id`) ON UPDATE no action ON DELETE set null
);

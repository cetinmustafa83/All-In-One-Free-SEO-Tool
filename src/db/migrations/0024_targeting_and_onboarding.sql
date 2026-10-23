ALTER TABLE `clients` ADD `country` text DEFAULT 'US';--> statement-breakpoint
ALTER TABLE `clients` ADD `language` text DEFAULT 'en';--> statement-breakpoint
ALTER TABLE `clients` ADD `city` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `geo_target` text DEFAULT 'country';--> statement-breakpoint
ALTER TABLE `clients` ADD `business_type` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `service_radius_km` integer;--> statement-breakpoint
ALTER TABLE `clients` ADD `onboarding_step` text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `clients` ADD `plan_generated_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `keywords` ADD `city` text;--> statement-breakpoint
ALTER TABLE `keywords` ADD `language` text DEFAULT 'en';--> statement-breakpoint
ALTER TABLE `keywords` ADD `source` text;

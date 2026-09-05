CREATE TABLE `saved_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`label` text NOT NULL,
	`latitude` text NOT NULL,
	`longitude` text NOT NULL,
	`timezone` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`pending` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_saved_locations_user` ON `saved_locations` (`user_id`);
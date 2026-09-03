CREATE TABLE `ask_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_ask_exchanges_created` ON `ask_exchanges` (`created_at`);--> statement-breakpoint
CREATE TABLE `saved_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`activity` text NOT NULL,
	`temp_min` integer NOT NULL,
	`temp_max` integer NOT NULL,
	`wind_max_kmh` integer NOT NULL,
	`precip_max_pct` integer NOT NULL,
	`uv_max` integer,
	`preferred_from` integer NOT NULL,
	`preferred_to` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`pending` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_saved_profiles_user` ON `saved_profiles` (`user_id`);
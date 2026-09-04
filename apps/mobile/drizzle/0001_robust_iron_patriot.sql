CREATE TABLE `plan_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_plan_cache_fetched` ON `plan_cache` (`fetched_at`);
# ADR-0003 — Open-Meteo as the forecast data source

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The application needs hourly and daily forecast data, historical normals for
comparisons, and ideally air quality. The candidates are the usual public weather APIs,
which differ mainly in their access model.

For an open-source project, the access model is the deciding factor: a reader who has
to register for an API key before the project runs will usually not run it.

## Decision

Use **Open-Meteo** as the sole forecast data source.

## Consequences

**Positive**

- No API key. `docker compose up` is genuinely the whole installation.
- Free for non-commercial use, with generous limits.
- Separate endpoints for forecast, historical archive, air quality, and marine
  conditions — enough surface for the planner without a second provider.
- Hourly resolution, which the window-scoring engine depends on.

**Negative**

- Single point of failure. Mitigated by aggressive caching and by the client's
  offline-first behaviour, but if Open-Meteo is down and the cache is cold, we have
  nothing to show.
- No severe-weather alerting; if we want warnings later, that is a second source.
- We inherit their model choices and cannot explain a forecast we disagree with.

## Alternatives considered

| Option | Why not |
|---|---|
| OpenWeatherMap | Requires a key. Every reader would face a registration step before seeing anything. |
| Tomorrow.io | Richer data, stricter free tier, key required. |
| National meteorological services | Best regional accuracy, but inconsistent APIs and poor global coverage. |

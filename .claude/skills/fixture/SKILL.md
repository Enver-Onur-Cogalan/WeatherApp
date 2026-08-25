---
name: fixture
description: Add a recorded Open-Meteo forecast fixture to WeatherApp for benchmarks and evals. Use when a test or specimen needs weather the existing fixtures do not contain — rain, snow, high wind, freezing, or a heatwave.
---

# Adding a forecast fixture

Fixtures live in `benchmarks/fixtures/` as `<place>.json`, recorded once. Evaluations must
be reproducible; live API calls would make results change with the weather.

## Why this keeps coming up

The first fixture was an August week in Istanbul: 72 hours without a single drop of rain.
Anything exercising precipitation had nothing to work with, and the gap was invisible until
something tried to render it. **An agent tested only in fair weather is untested for the
cases users most need it in.**

`docs/08-evaluation-strategy.md` tracks which conditions are still missing.

## Fetching

Always request the full field set, so one fixture serves every purpose:

```bash
curl -s "https://api.open-meteo.com/v1/forecast\
?latitude=<LAT>&longitude=<LON>\
&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,\
wind_gusts_10m,uv_index,cloud_cover,weather_code\
&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max\
&timezone=<IANA>&forecast_days=7" \
  -o benchmarks/fixtures/<place>.json
```

`weather_code` is not optional — WMO codes are what distinguish snow from rain and hail
from a shower. See the mapping in `docs/12-data-model.md`.

## Verify it contains what you came for

A fixture that does not hold the weather you needed is worse than no fixture, because it
looks like coverage. Check before committing:

```bash
python3 -c "
import json,sys
h=json.load(open('benchmarks/fixtures/<place>.json'))['hourly']
for k in ('precipitation_probability','wind_speed_10m','temperature_2m','cloud_cover'):
    v=h[k][:72]; print(f'{k:26} min={min(v):6} max={max(v):6}')
print('weather codes:', sorted(set(h['weather_code'][:72])))
"
```

If the conditions you wanted are not there, pick a different place or season rather than
committing it and moving on.

## Places that reliably have weather

| Need | Try |
|---|---|
| Rain, heavy cloud | Rize (41.02, 40.52) |
| Snow, freezing | Erzurum (39.90, 41.27) |
| High wind | Çanakkale (40.15, 26.41) |
| Heat, high UV | Şanlıurfa (37.16, 38.79) |

## After adding

Note the new fixture in `docs/08-evaluation-strategy.md` and remove the condition from the
list of what is still missing.

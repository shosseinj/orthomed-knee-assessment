# Targeted access log

Set `ACCESS_AUDIT_PHONE_NUMBER=09198071351` in the deployment `.env`. The
backend then appends one JSON object per line to
`backend/logs/access-audit.jsonl` in the project. This file is ignored by Git
and is bind-mounted into the production container, so it survives rebuilds.
`ACCESS_AUDIT_LOG_PATH` can override the path (use an absolute path writable by
the backend process). Leave `ACCESS_AUDIT_PHONE_NUMBER` blank to disable it.

Successful OTP panel logins, authenticated React route visits, successful
Django admin logins, and authenticated admin HTML page views are recorded.
Each line contains UTC time, account identifier, event type, route, IP address,
browser User-Agent, language header, and client-reported timezone. It never
contains OTPs, passwords, tokens, medical forms, or request bodies. Nothing is
written to an audit database table or displayed in Django admin.

Logging is best-effort: unexpected lookup or file errors are reported to the
backend error log but do not fail login or page requests. A busy log lock skips
that event instead of waiting. This protects app availability at the cost of
possibly missing an audit entry when storage is unavailable.

To inspect recent events on the server:

```bash
tail -n 50 backend/logs/access-audit.jsonl
```

The React app is served by Nginx, not Django. A signed-out visit cannot be
reliably linked to a phone number, so it is not attributed to this account.

## IP address and optional location

Production Nginx overwrites `X-Real-IP` and Django has no public host port, so
the production Compose file enables `ACCESS_AUDIT_TRUST_PROXY_IP`. Do not
enable it if clients can reach Django directly or the proxy does not replace
that header. The `X-Forwarded-For` chain is intentionally ignored.

For approximate country/city, place a current, licensed MaxMind
`GeoLite2-City.mmdb` at `backend/geoip/GeoLite2-City.mmdb`. The database is
mounted read-only, and lookups happen locally without sending IPs to a third
party. Without it, country/city fields are absent. A database result may also
be absent or inaccurate; `accuracy_radius_km` is included when available. It
is not GPS or a street address.

A remote website cannot obtain the visitor's device MAC address. Browser
location permission would be required for precise coordinates and is not
requested by this feature.

## Size limit and privacy

The single log file is capped at 10 MiB. When the next event would cross that
limit, the oldest entries are discarded and the newest complete entries (up
to roughly 5 MiB) are kept before appending the new event. There are no backup
files, so disk use stays bounded; old events are permanently lost at rollover.
Restrict access to the project directory, and avoid committing or sharing the
JSONL file because IPs and browsing metadata are personal data.

# KneeWebsite deployment on `knee.nafasbooking.ir`

This deployment uses the server's existing edge Nginx and Docker network. It
does not publish ports `5173` or `8000` on the host. One hostname is enough:

- `https://knee.nafasbooking.ir/` — React application
- `https://knee.nafasbooking.ir/api/v1/` — Django REST API
- `https://knee.nafasbooking.ir/admin/` — Django Admin

SQLite, uploaded media, and collected admin static files use named Docker
volumes. Do not use `docker compose down -v`; that would delete application
data.

## 1. DNS

In the authoritative DNS panel add:

| Type | Name | Value | TTL | Mode |
| --- | --- | --- | --- | --- |
| A | `knee` | `82.115.20.247` | `300` | DNS only |

Do not add an AAAA record unless this server is given working public IPv6. A
second API or admin hostname is not required.

Wait until both public resolvers return the server address:

```bash
dig @1.1.1.1 +short A knee.nafasbooking.ir
dig @8.8.8.8 +short A knee.nafasbooking.ir
```

Both must print only `82.115.20.247` before requesting the certificate.

## 2. Review production environment

Set the production `.env` to the correct hostname, same-origin API, and
`DJANGO_DEBUG=false`. The production Compose file disables mock OTP. The
development code `11111` is unavailable when debug is disabled; production
uses randomly generated codes through the configured OTP provider.
Confirm the non-secret values without printing credentials:

```bash
cd /root/sharifclinic/AI/KneeWebsite
grep -E '^(DJANGO_DEBUG|DJANGO_ALLOWED_HOSTS|CORS_ALLOWED_ORIGINS|CSRF_TRUSTED_ORIGINS|OTP_BACKEND|ENABLE_MOCK_OTP|VITE_API_URL)=' .env
```

`OTP_BACKEND=smsir` also requires valid `SMSIR_API_KEY` and
`SMSIR_TEMPLATE_ID`. AI assessment requires a valid `OPENAI_API_KEY`.

## 3. Build and start the private application containers

```bash
cd /root/sharifclinic/AI/KneeWebsite
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 backend frontend
```

The backend command runs migrations and `collectstatic` before Gunicorn. No
host port should appear in `docker compose ... ps`; the services are reachable
only as `knee-backend:8000` and `knee-frontend:80` on the shared edge network.

## 4. Expand the existing Let's Encrypt certificate

The existing `nafasbooking.ir` certificate must retain all current names when
adding `knee.nafasbooking.ir`.

```bash
cd /root/sharifclinic/main/Sharif-Clinic-Infrastructure/environments/ip-http
export LETSENCRYPT_EMAIL='replace-with-the-certificate-contact-email'

DOMAIN_DC=(docker compose --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.app.yml \
  -f docker-compose.tls.yml \
  -f docker-compose.domain.yml)

"${DOMAIN_DC[@]}" --profile tls-tools run --rm --no-deps certbot certonly \
  --non-interactive \
  --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  --webroot \
  --webroot-path /var/www/certbot \
  --cert-name nafasbooking.ir \
  --expand \
  -d nafasbooking.ir \
  -d www.nafasbooking.ir \
  -d gitlab.nafasbooking.ir \
  -d jira.nafasbooking.ir \
  -d upload.nafasbooking.ir \
  -d knee.nafasbooking.ir

"${DOMAIN_DC[@]}" --profile tls-tools run --rm --no-deps certbot certificates
```

Do not omit an existing `-d` name; doing so can remove it from the renewed
certificate.

## 5. Validate and reload only the existing edge proxy

The KneeWebsite server blocks are already present in
`environments/ip-http/domain/nginx.conf`.

```bash
"${DOMAIN_DC[@]}" exec edge nginx -c /etc/nginx/nginx-domain.conf -t
"${DOMAIN_DC[@]}" exec edge nginx -c /etc/nginx/nginx-domain.conf -s reload

curl -I http://knee.nafasbooking.ir/
curl -I https://knee.nafasbooking.ir/
curl -fsS https://knee.nafasbooking.ir/api/v1/health/
curl -I https://knee.nafasbooking.ir/admin/
```

Expected results are an HTTP-to-HTTPS redirect, a successful frontend
response, `{"status":"ok","service":"orthomed-api"}`, and an admin login
redirect/page without a certificate warning.

## 6. Create the first Django administrator

The custom username is an 11-digit phone number. Run the interactive command
and enter that phone number and a strong password:

```bash
cd /root/sharifclinic/AI/KneeWebsite
docker compose -f docker-compose.production.yml exec backend python manage.py createsuperuser
```

Then sign in at `https://knee.nafasbooking.ir/admin/`. Django Admin is part of
the backend; it does not need a second subdomain or a public backend port.

## Routine operation

```bash
cd /root/sharifclinic/AI/KneeWebsite

# Deploy a newer Git revision
git pull --ff-only
docker compose -f docker-compose.production.yml up -d --build

# Inspect status and logs
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f --tail=200

# Stop without deleting SQLite/media volumes
docker compose -f docker-compose.production.yml stop
```

Back up the `knee-website-db` and `knee-website-media` volumes before upgrades.
SQLite is sufficient for a small, low-concurrency MVP, but it is not a good
long-term choice for concurrent clinical use.

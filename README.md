# Orthomed — Knee Surgery Assessment

A bilingual **English and Persian** platform for knee surgery assessment, connecting patients, doctors, and insurance reviewers. Built with React, TypeScript, and Django REST Framework.

![Orthomed English interface](docs/images/orthomed-english.png)

## Features

- **English and Persian:** switch languages from the sign-in screen or application header. Your preference is saved in your browser; layouts switch between left-to-right and right-to-left.
- **Patient workspace:** register with a mobile verification code, manage your profile, record medical history, complete the 24-item WOMAC questionnaire, upload knee X-rays, and track cases.
- **Doctor workspace:** manage patients, review clinical and radiographic findings, record a Kellgren–Lawrence grade, and submit a medical assessment.
- **Insurance workspace:** review medical and AI assessments and record a surgical coverage decision.
- **Localized dates and catalogs:** Gregorian birth-date input in English, a Persian calendar in Persian, locale-aware date and number formatting, and searchable English/Persian medical catalogs.
- **Access controls:** role-based permissions, administrator approval for doctors and insurance reviewers, authenticated medical image access, and optional access auditing.

User-entered names, notes, and clinical assessments retain their original language. Switching the interface language does not translate clinical records or change saved medical values. The app currently uses Iranian mobile numbers and national IDs in both languages.

## Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router, Lucide icons |
| Backend | Django, Django REST Framework, JWT authentication |
| Database | SQLite |
| Optional services | SMS.ir for SMS, an OpenAI-compatible API for AI assessment, GeoIP for access auditing |
| Deployment | Docker Compose; Nginx and Gunicorn production templates |

## Run locally

Requirements: **Node.js 22.12 or newer** and **Python 3.12 or newer**.

```bash
git clone https://github.com/shosseinj/orthomed-knee-assessment.git
cd orthomed-knee-assessment
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
python backend/manage.py migrate
python backend/manage.py runserver 0.0.0.0:8000
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

The frontend binds to **`0.0.0.0:5173`** and the backend to **`0.0.0.0:8000`**. Open [http://localhost:5173](http://localhost:5173) on this machine, or `http://<your-machine-ip>:5173` from another device on the same network. `0.0.0.0` is the listen address, not an Internet hostname.

The frontend proxies `/api` and `/media` to the backend, so browsers on other devices do not need a separate API address. These commands run the development environment; use the production templates for an HTTPS deployment.

### Launch with one command

```bash
./run.sh
```

The runner works from any directory, creates `.env` from `.env.example` when missing, installs dependencies on first launch or when the dependency files change, applies database migrations, and starts both servers on `0.0.0.0:5173` and `0.0.0.0:8000`. If your Node.js version is too old, it downloads and uses Node.js 22 through `npx`. Python 3.12 or newer and npm are required. Press **Ctrl+C** to stop both servers. Restart the runner after changing `.env` or backend code. When either port is occupied, the runner uses `lsof` to find and stop its listener, waits up to five seconds, and force-stops it if necessary before restarting the project. Processes owned by another user still require that user's permission to stop.

### SMS.ir sign-in codes

Set these values in the root `.env` before requesting a sign-in or registration code:

```dotenv
OTP_BACKEND=smsir
ENABLE_MOCK_OTP=false
SMSIR_API_KEY=your-api-key
SMSIR_TEMPLATE_ID=your-numeric-template-id
SMSIR_CODE_PARAMETER=CODE
```

Use the ID of your approved SMS.ir verification template. `SMSIR_CODE_PARAMETER` must match the template's OTP placeholder name without `#` characters: for `#PARAMETER1#`, set it to `PARAMETER1`. Use a verification template with one code placeholder; the website generates a random five-digit code for that parameter. The backend sends the request to SMS.ir's [`POST /v1/send/verify` endpoint](https://api.sms.ir/swagger/index.html), with the API key in the `x-api-key` header. The key stays on the backend.

Enter a mobile number to receive a code immediately; no terms checkbox is required. The backend verifies the code before looking up the account. Existing users sign in immediately. New users then complete registration without requesting a second code. Their verified phone is carried in a signed registration token that expires after 15 minutes and only permits creating that phone's account; it cannot be reused to sign in. Account status is not disclosed before verification.

Codes expire after two minutes and can be used once. If configuration is missing or SMS.ir rejects the request, the website shows a delivery error and the failed challenge is removed. The environment example enables SMS.ir delivery, so enter your credentials before using sign-in. To develop without sending SMS, explicitly set `OTP_BACKEND=console` and `ENABLE_MOCK_OTP=true` with `DJANGO_DEBUG=true`.

If SMS.ir delivery returns HTTP 503, check the backend log for the upstream HTTP status, numeric provider status, or network error type. The API key, recipient, and verification code are omitted from these diagnostics. The template ID must belong to the account associated with your API key, be approved for use, and contain the configured code parameter. You can check credit and templates without sending SMS using SMS.ir's `GET /v1/credit` and `GET /v1/templates` APIs.

Create an administrator account when needed:

```bash
source .venv/bin/activate
python backend/manage.py createsuperuser
```

The app's **System administrator** page is available at [http://localhost:5173/management](http://localhost:5173/management). Sign in through the normal verification-code flow with an administrator account. Administrators can search doctor and insurance accounts, filter by approval status, approve/activate accounts, and revoke approval. A doctor's existing session can use the **Check approval status** button after approval; a new login is not required. Account changes are recorded in Django's admin log.

Superusers created with `createsuperuser` can access this page. To grant only account-verification management to an existing registered account, run this locally, substituting that account's mobile number:

```bash
python backend/manage.py grant_account_manager <registered-mobile-number>

.venv/bin/python backend/manage.py grant_account_manager 09XXXXXXXXX
```

This grants the dedicated `accounts.manage_account_verifications` permission, without superuser access or permission to edit account roles. Administrator access cannot be selected at public registration or granted from the account-approval page. Django Admin remains available at [http://localhost:8000/admin/](http://localhost:8000/admin/).

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). Both services listen on all network interfaces. Docker configures the frontend proxy to use the backend container automatically.

## Development authentication

With `DJANGO_DEBUG=true`, `OTP_BACKEND=console`, and `ENABLE_MOCK_OTP=true`, all mobile numbers use the development verification code **`11111`** without sending SMS. The sign-in screen shows the configured development code. Request a new code before entering it; codes still expire and can only be used once. New users still complete registration and identity fields. With `DJANGO_DEBUG=false`, fixed development codes are disabled, even if the mock flag is enabled. Configure the production OTP provider and set `ENABLE_MOCK_OTP=false` for deployment.

## Configuration

Copy `.env.example` to `.env`; keep real credentials out of Git.

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Django secret; replace for deployment |
| `DJANGO_DEBUG` | Enables development behavior |
| `DJANGO_ALLOWED_HOSTS` | Hosts permitted by Django |
| `VITE_API_URL` | API base path; defaults to `/api/v1` |
| `API_PROXY_TARGET` | Optional development proxy target; defaults to `http://127.0.0.1:8000` |
| `OTP_BACKEND` | `console` for local development or `smsir` for SMS delivery |
| `ENABLE_MOCK_OTP` | Enables the development test-number flow |
| `SMSIR_API_KEY`, `SMSIR_TEMPLATE_ID` | SMS.ir API key and numeric verification template ID |
| `SMSIR_CODE_PARAMETER` | Template's OTP placeholder name, without `#`; defaults to `CODE` |
| `OPENAI_API_KEY`, `OPENAI_API_URL`, `OPENAI_MODEL` | AI analysis provider configuration |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Optional stable secret for personal API key encryption; defaults to `DJANGO_SECRET_KEY` |
| `ACCESS_AUDIT_PHONE_NUMBER` | Opt-in access auditing for one account |
| `GEOIP_CITY_DB_PATH` | Optional local GeoIP database |

Users can open **Settings → AI settings** and enter their own `OPENAI_API_KEY`. They can replace or remove it from the same page. The key is encrypted in the database for that account; the frontend receives only its last four characters and does not keep it in browser storage. Saving checks the key's format; OpenAI validates it when an analysis is requested. API requests run on the backend, following the [official OpenAI authentication guidance](https://developers.openai.com/api/reference/overview#authentication).

The requesting user's saved key takes precedence over the server's `OPENAI_API_KEY`. Removing it restores the server fallback, if configured. A patient's key is never used for another user's request. Keep the encryption secret stable across restarts; changing it requires users to re-enter their saved keys. Personal keys are separate from patient records and are not included in account or case API responses.

Without either a personal or server key, AI analysis is unavailable; the interface links to Settings and does not fabricate clinical results.

## Validation

```bash
# Backend regression tests
.venv/bin/python backend/manage.py test apps.accounts apps.cases

# Frontend type checking and production build
cd frontend
npm run build

# Browser regression tests (install Chromium once)
npx playwright install chromium
npm run test:e2e
```

## Repository structure

```text
backend/                 Django API, accounts, cases, catalogs, and tests
frontend/src/            React application
frontend/src/i18n/       Locale state and English translations
frontend/public/         Brand assets and bundled Persian font
docs/images/             Actual English and Persian interface screenshots
docs/                    Architecture, access auditing, and deployment notes
deploy/                  Existing Nginx deployment template
```

<details>
<summary>Persian interface preview</summary>

![Orthomed Persian interface](docs/images/orthomed-persian.png)

</details>

## Production deployment

The existing [deployment guide](docs/DEPLOYMENT.md), `docker-compose.production.yml`, and `deploy/nginx-knee.conf` describe a specific server installation. Adapt its hostname, network, storage, and environment settings for your infrastructure. The production Compose template disables mock OTP.

Before clinical use, configure HTTPS, private medical file storage, backups, consent, retention policies, and account verification. AI output supports clinical review and requires clinical validation; it does not replace a qualified physician's diagnosis. Verify the WOMAC instrument's translation, validation, and licensing before clinical or insurance use.

import logging
import secrets

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from .models import OTPChallenge

logger = logging.getLogger(__name__)


class SMSDeliveryError(Exception):
    """A verification message could not be accepted by the SMS provider."""


class SMSGateway:
    def send_otp(self, phone_number: str, code: str) -> None:
        raise NotImplementedError


class ConsoleSMSGateway(SMSGateway):
    def send_otp(self, phone_number: str, code: str) -> None:
        logger.warning("Development OTP for %s: %s", phone_number, code)


class SMSIRGateway(SMSGateway):
    endpoint = "https://api.sms.ir/v1/send/verify"

    def send_otp(self, phone_number: str, code: str) -> None:
        if not settings.SMSIR_API_KEY or not settings.SMSIR_TEMPLATE_ID:
            logger.error("SMS.ir requires SMSIR_API_KEY and SMSIR_TEMPLATE_ID.")
            raise SMSDeliveryError("SMS.ir is not configured.")
        try:
            template_id = int(settings.SMSIR_TEMPLATE_ID)
            if template_id <= 0 or not settings.SMSIR_CODE_PARAMETER.strip():
                raise ValueError
        except (TypeError, ValueError):
            logger.error("SMS.ir requires a positive SMSIR_TEMPLATE_ID and SMSIR_CODE_PARAMETER.")
            raise SMSDeliveryError("SMS.ir template configuration is invalid.") from None

        try:
            response = requests.post(
                self.endpoint,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/plain",
                    "x-api-key": settings.SMSIR_API_KEY,
                },
                json={
                    "mobile": phone_number,
                    "templateId": template_id,
                    "parameters": [{"name": settings.SMSIR_CODE_PARAMETER, "value": code}],
                },
                timeout=10,
            )
            response.raise_for_status()
            result = response.json()
        except requests.HTTPError:
            try:
                body = response.json()
            except ValueError:
                body = None
            provider_status = body.get("status") if isinstance(body, dict) else None
            logger.error(
                "SMS.ir rejected verification: HTTP %s, provider status %s. "
                "Check the API key, verification template ID, code parameter, and account credit.",
                response.status_code,
                provider_status if type(provider_status) is int else "unknown",
            )
            raise SMSDeliveryError("SMS.ir rejected the verification message.") from None
        except requests.RequestException as exc:
            # Provider exceptions can include credentials, the code, or recipient.
            logger.error("SMS.ir verification request failed (%s).", type(exc).__name__)
            raise SMSDeliveryError("SMS.ir is temporarily unavailable.") from None
        except ValueError:
            logger.error("SMS.ir returned invalid JSON (HTTP %s).", response.status_code)
            raise SMSDeliveryError("SMS.ir returned an invalid response.") from None
        if not isinstance(result, dict) or result.get("status") != 1:
            provider_status = result.get("status") if isinstance(result, dict) else None
            logger.error(
                "SMS.ir did not accept verification (provider status %s).",
                provider_status if type(provider_status) is int else "unknown",
            )
            raise SMSDeliveryError("SMS.ir rejected the verification message.")


def get_sms_gateway() -> SMSGateway:
    return SMSIRGateway() if settings.OTP_BACKEND == "smsir" else ConsoleSMSGateway()


def is_mock_otp(phone_number: str) -> bool:
    return settings.DEBUG and settings.ENABLE_MOCK_OTP and (
        settings.OTP_BACKEND == "console" or phone_number.startswith(settings.MOCK_OTP_PREFIX)
    )


def otp_metadata(phone_number: str) -> dict:
    is_mock = is_mock_otp(phone_number)
    return {"is_mock": is_mock, **({"development_code": settings.MOCK_OTP_CODE} if is_mock else {})}


def issue_otp(phone_number: str) -> OTPChallenge:
    is_mock = is_mock_otp(phone_number)
    code = settings.MOCK_OTP_CODE if is_mock else str(secrets.randbelow(90000) + 10000)
    challenge = OTPChallenge.objects.create(
        phone_number=phone_number,
        code_hash=make_password(code),
        expires_at=OTPChallenge.expiry_time(),
    )
    if is_mock:
        logger.info("Development OTP issued for %s", phone_number)
    else:
        try:
            get_sms_gateway().send_otp(phone_number, code)
        except SMSDeliveryError:
            challenge.delete()
            raise
    return challenge


def verify_otp(phone_number: str, code: str) -> bool:
    challenge = OTPChallenge.objects.filter(phone_number=phone_number, consumed_at__isnull=True).order_by("-created_at").first()
    if not challenge or not challenge.is_usable:
        return False
    challenge.attempts += 1
    valid = check_password(code, challenge.code_hash)
    if valid:
        challenge.consumed_at = timezone.now()
    challenge.save(update_fields=["attempts", "consumed_at"])
    return valid

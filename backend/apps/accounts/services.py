import logging
import secrets

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from .models import OTPChallenge

logger = logging.getLogger(__name__)


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
            raise RuntimeError("SMS.ir API key and verification template ID are required.")
        response = requests.post(
            self.endpoint,
            headers={"X-API-KEY": settings.SMSIR_API_KEY},
            json={
                "mobile": phone_number,
                "templateId": int(settings.SMSIR_TEMPLATE_ID),
                "parameters": [{"name": settings.SMSIR_CODE_PARAMETER, "value": code}],
            },
            timeout=10,
        )
        response.raise_for_status()


def get_sms_gateway() -> SMSGateway:
    return SMSIRGateway() if settings.OTP_BACKEND == "smsir" else ConsoleSMSGateway()


def issue_otp(phone_number: str) -> OTPChallenge:
    is_mock = settings.ENABLE_MOCK_OTP and phone_number.startswith(settings.MOCK_OTP_PREFIX)
    code = settings.MOCK_OTP_CODE if is_mock else str(secrets.randbelow(90000) + 10000)
    challenge = OTPChallenge.objects.create(
        phone_number=phone_number,
        code_hash=make_password(code),
        expires_at=OTPChallenge.expiry_time(),
    )
    if is_mock:
        logger.info("Mock OTP issued for test number %s", phone_number)
    else:
        get_sms_gateway().send_otp(phone_number, code)
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

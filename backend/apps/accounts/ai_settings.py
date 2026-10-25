"""User-owned credentials. Plaintext keys never appear in account/case serializers."""
import base64

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils.crypto import salted_hmac

from .models import AISettings


class AIKeyUnavailable(RuntimeError):
    pass


def _cipher(user):
    # A stable server secret and per-user derivation keep database copies encrypted.
    secret = settings.AI_SETTINGS_ENCRYPTION_SECRET or settings.SECRET_KEY
    key = salted_hmac("orthomed.ai-settings.v1", str(user.pk), secret=secret, algorithm="sha256").digest()
    return Fernet(base64.urlsafe_b64encode(key))


def save_api_key(user, api_key):
    AISettings.objects.update_or_create(user=user, defaults={
        "encrypted_api_key": _cipher(user).encrypt(api_key.encode()).decode(),
        "key_last_four": api_key[-4:],
    })


def get_api_key(user):
    record = AISettings.objects.filter(user=user).first()
    if record:
        try:
            return _cipher(user).decrypt(record.encrypted_api_key.encode()).decode()
        except InvalidToken:
            raise AIKeyUnavailable("Saved API key cannot be decrypted.") from None
    return settings.OPENAI_API_KEY


def settings_status(user):
    record = AISettings.objects.filter(user=user).first()
    return {
        "has_api_key": record is not None,
        "key_last_four": record.key_last_four if record else "",
        "server_key_configured": bool(settings.OPENAI_API_KEY),
    }

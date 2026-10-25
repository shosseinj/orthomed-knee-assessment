from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .ai_settings import AIKeyUnavailable, get_api_key
from .models import AISettings, User


@override_settings(OPENAI_API_KEY="", AI_SETTINGS_ENCRYPTION_SECRET="test-encryption-secret")
class AISettingsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("09500001111", role="doctor", is_verified=True)
        self.other = User.objects.create_user("09500002222", role="doctor", is_verified=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/v1/auth/settings/ai/"
        self.key = "sk-proj-unit-test-credential-1234"

    def save_key(self, key=None):
        return self.client.put(self.url, {"openai_api_key": key or self.key}, format="json")

    def test_key_is_encrypted_and_never_returned_in_settings_or_profile(self):
        saved = self.save_key()
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data, {"has_api_key": True, "key_last_four": "1234", "server_key_configured": False})
        record = AISettings.objects.get(user=self.user)
        self.assertNotIn(self.key, record.encrypted_api_key)
        self.assertEqual(get_api_key(self.user), self.key)
        self.assertNotIn(self.key, str(self.client.get(self.url).data))
        self.assertNotIn("encrypted_api_key", str(self.client.get("/api/v1/auth/me/").data))
        self.assertEqual(saved["Cache-Control"], "private, no-store")

    def test_saved_key_is_scoped_to_its_account_and_cannot_be_decrypted_as_another_user(self):
        self.save_key()
        self.client.force_authenticate(self.other)
        self.assertFalse(self.client.get(self.url).data["has_api_key"])
        self.assertEqual(get_api_key(self.other), "")
        self.client.delete(self.url)
        self.assertTrue(AISettings.objects.filter(user=self.user).exists())
        stolen = AISettings.objects.get(user=self.user)
        AISettings.objects.create(user=self.other, encrypted_api_key=stolen.encrypted_api_key, key_last_four="1234")
        with self.assertRaises(AIKeyUnavailable):
            get_api_key(self.other)

    @override_settings(OPENAI_API_KEY="server-fallback")
    def test_replace_remove_and_server_fallback(self):
        self.assertEqual(get_api_key(self.user), "server-fallback")
        self.save_key()
        self.assertEqual(get_api_key(self.user), self.key)
        replacement = "sk-proj-replacement-test-key-5678"
        self.assertEqual(self.save_key(replacement).data["key_last_four"], "5678")
        self.assertEqual(get_api_key(self.user), replacement)
        self.assertEqual(AISettings.objects.filter(user=self.user).count(), 1)
        removed = self.client.delete(self.url)
        self.assertEqual(removed.status_code, 200)
        self.assertFalse(removed.data["has_api_key"])
        self.assertTrue(removed.data["server_key_configured"])
        self.assertEqual(get_api_key(self.user), "server-fallback")

    def test_invalid_input_does_not_replace_saved_key(self):
        self.save_key()
        for invalid in ("", "not-an-openai-key-at-all", "sk-key with spaces in it", "sk-" + "x" * 600):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.client.put(self.url, {"openai_api_key": invalid}, format="json").status_code, 400)
                self.assertEqual(get_api_key(self.user), self.key)

    def test_anonymous_user_cannot_read_write_or_delete_settings(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.save_key().status_code, 401)
        self.assertEqual(self.client.delete(self.url).status_code, 401)

    def test_key_rotation_returns_recoverable_error(self):
        self.save_key()
        with override_settings(AI_SETTINGS_ENCRYPTION_SECRET="rotated-secret"):
            with self.assertRaises(AIKeyUnavailable):
                get_api_key(self.user)

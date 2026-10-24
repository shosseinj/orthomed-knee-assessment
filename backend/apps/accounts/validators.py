from datetime import date

from django.core.exceptions import ValidationError
from django.utils import timezone


_DIGIT_TRANSLATION = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_national_code(value: str) -> str:
    code = str(value).strip().translate(_DIGIT_TRANSLATION)
    if len(code) != 10 or not code.isascii() or not code.isdigit() or len(set(code)) == 1:
        raise ValidationError("کد ملی باید ۱۰ رقم معتبر باشد.")
    remainder = sum(int(digit) * (10 - index) for index, digit in enumerate(code[:9])) % 11
    expected = remainder if remainder < 2 else 11 - remainder
    if int(code[-1]) != expected:
        raise ValidationError("رقم کنترل کد ملی معتبر نیست.")
    return code


def validate_national_code(value: str) -> None:
    normalize_national_code(value)


def validate_birth_date(value: date) -> date:
    if value < date(1900, 1, 1) or value > timezone.localdate():
        raise ValidationError("تاریخ تولد باید بین سال ۱۹۰۰ و امروز باشد.")
    return value

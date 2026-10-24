"""Versioned questionnaire definitions kept outside transport and persistence code."""

WOMAC_ITEMS = {
    "pain": (
        ("p1", "درد هنگام راه رفتن روی سطح صاف"),  # PDF P5
        ("p2", "درد هنگام بالا یا پایین رفتن از پله‌ها"),  # PDF P6
        ("p3", "درد شب‌ها در بستر"),  # PDF P7
        ("p4", "درد هنگام نشستن یا دراز کشیدن"),  # PDF P8
        ("p5", "درد هنگام ایستادن"),  # PDF P9
    ),
    "stiffness": (
        ("s1", "شدت خشکی مفصل زانو پس از بیدار شدن در صبح"),  # PDF S6
        ("s2", "شدت خشکی مفصل پس از نشستن، خوابیدن یا استراحت در پایان روز"),  # PDF S7
    ),
    "function": (
        ("f1", "پایین رفتن از پله"),
        ("f2", "بالا رفتن از پله"),
        ("f3", "بلند شدن از حالت نشسته"),
        ("f4", "ایستادن"),
        ("f5", "خم شدن و برداشتن یک شیء از روی زمین"),
        ("f6", "راه رفتن روی سطح صاف"),
        ("f7", "داخل و خارج شدن از خودرو"),
        ("f8", "به خرید رفتن"),
        ("f9", "پوشیدن جوراب"),
        ("f10", "بلند شدن از تخت"),
        ("f11", "درآوردن جوراب"),
        ("f12", "دراز کشیدن و غلت زدن در تخت"),
        ("f13", "داخل و خارج شدن از حمام"),
        ("f14", "نشستن"),
        ("f15", "داخل و خارج شدن از توالت"),
        ("f16", "انجام کارهای سنگین خانه"),
        ("f17", "انجام کارهای سبک خانه"),
    ),
}

WOMAC_ITEM_IDS = tuple(item_id for items in WOMAC_ITEMS.values() for item_id, _label in items)

# Additional questions present in the supplied Persian form. They are not part
# of the 24-item WOMAC score and must always be reported separately.
KNEE_SUPPLEMENTAL_ITEMS = (
    ("xs1", "تورم زانو"),  # PDF S1
    ("xs2", "احساس ساییده شدن یا شنیدن صدای اضافه از مفصل زانو"),  # PDF S2
    ("xs3", "گیر کردن یا قفل شدن زانو هنگام حرکت"),  # PDF S3
    ("xs4", "مشکل در صاف کردن کامل زانو"),  # PDF S4, direction normalized
    ("xs5", "مشکل در خم کردن کامل زانو"),  # PDF S5, direction normalized
    ("xp1", "تکرار یا مداومت درد مفصل زانو"),  # PDF P1
    ("xp2", "درد هنگام ایستادن روی یک زانو یا چرخش پا روی مفصل"),  # PDF P2
    ("xp3", "درد هنگام صاف کردن کامل مفصل زانو"),  # PDF P3
    ("xp4", "درد هنگام خم کردن کامل مفصل زانو"),  # PDF P4
)
KNEE_SUPPLEMENTAL_ITEM_IDS = tuple(item_id for item_id, _label in KNEE_SUPPLEMENTAL_ITEMS)

import csv
from functools import lru_cache
from pathlib import Path
import unicodedata


CATALOG_DIRECTORY = Path(__file__).resolve().parent / "data" / "catalogs"
SUPPORTED_CATALOGS = {"diseases", "medications"}
PERSIAN_ALPHABET = "ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی"
PERSIAN_LETTER_ORDER = {letter: index for index, letter in enumerate(PERSIAN_ALPHABET)}
PERSIAN_CHARACTER_TRANSLATION = str.maketrans({
    "آ": "ا",
    "أ": "ا",
    "إ": "ا",
    "ٱ": "ا",
    "ك": "ک",
    "ي": "ی",
    "ى": "ی",
    "ئ": "ی",
})


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).translate(PERSIAN_CHARACTER_TRANSLATION)
    return " ".join(normalized.strip().casefold().split())


def persian_sort_key(value: str) -> tuple:
    normalized = normalize_search_text(value)
    letters = tuple(
        PERSIAN_LETTER_ORDER.get(character, len(PERSIAN_LETTER_ORDER) + ord(character))
        for character in normalized
        if not character.isspace() and unicodedata.category(character)[0] not in {"M", "P", "S"}
    )
    return letters, normalized


@lru_cache(maxsize=len(SUPPORTED_CATALOGS))
def load_catalog(name: str) -> tuple[dict[str, str], ...]:
    if name not in SUPPORTED_CATALOGS:
        raise ValueError("Unsupported medical catalog")

    with (CATALOG_DIRECTORY / f"{name}.csv").open(encoding="utf-8", newline="") as stream:
        rows = []
        for row in csv.DictReader(stream):
            name_fa = row["name_fa"].strip()
            name_en = row.get("name_en", "").strip()
            manufacturer = row.get("manufacturer", "").strip()
            secondary_parts = [part for part in (name_en, manufacturer) if part]
            secondary = " — ".join(secondary_parts)
            value = " — ".join([name_fa, *secondary_parts]) if name == "medications" else name_fa
            rows.append({
                "value": value,
                "label": name_fa,
                "secondary": secondary,
                "english_label": name_en or name_fa,
                "persian_label": name_fa,
                "search_text": normalize_search_text(f"{name_fa} {name_en} {manufacturer}"),
            })
    rows.sort(key=lambda row: (persian_sort_key(row["label"]), row["secondary"].casefold()))
    return tuple(rows)


def search_catalog(name: str, query: str = "", limit: int = 30, offset: int = 0, language: str = "fa") -> dict:
    normalized_query = normalize_search_text(query)
    matches = [
        row for row in load_catalog(name)
        if not normalized_query or normalized_query in row["search_text"]
    ]
    if language == "en":
        matches.sort(key=lambda row: (row["english_label"].casefold(), row["secondary"].casefold()))
    page = matches[offset:offset + limit]
    next_offset = offset + limit if offset + limit < len(matches) else None
    return {
        "results": [
            {"value": row["value"], "label": row["english_label"] if language == "en" else row["persian_label"], "secondary": row["persian_label"] if language == "en" else row["secondary"]}
            for row in page
        ],
        "count": len(matches),
        "next_offset": next_offset,
    }

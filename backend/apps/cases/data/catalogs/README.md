# Medical selection catalogs

These UTF-8 CSV files are runtime reference data for the questionnaire's
searchable multi-select fields. They deliberately contain only patient-facing
names and are loaded by `apps.cases.catalogs`.

- `diseases.csv` contains 214 unique Persian names with English display labels. Canonical saved values remain Persian for compatibility with existing records. The focused perioperative
  list from `diseases.csv` is ordered first, followed by the broader rare and
  special-disease list from
  `difficult_special_diseases_tags_fully_english.csv`.
- `medications.csv` contains 5,907 unique Persian/English brand and
  manufacturer combinations derived from the supplied 9,040-row medication
  product list. Form, dose, ATC, and product-code columns were intentionally
  omitted; manufacturer is retained to distinguish otherwise identical names.

The supplied `mapping_all_completed (2).xlsx` is not included because it is a
mapping of laboratory services and LOINC/local codes, not a disease or
medication catalog.

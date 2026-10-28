Extend this repository:
https://github.com/shosseinj/orthomed-knee-assessment

Implement knee X-ray laterality detection, view classification, and organized uploads for both knees. Inspect the current code first, then implement the feature end to end.

Current implementation:
- Django/DRF backend and React/TypeScript frontend.
- `backend/apps/cases/models.py`: `XRayImage` has `view` and `purpose`, but no laterality.
- `frontend/src/pages/CaseDetailPage.tsx`: uploads currently send `view="other"`.
- `backend/apps/cases/services.py`: `OpenAIProvider` sends images to a vision model but returns only a case-level assessment.
- Preserve existing authentication, private image access, role permissions, personal/server API-key selection, and English/Persian localization.

Required behavior

1. Upload organization
Provide two sections, Right knee and Left knee, each with two image slots:
- Frontal/AP
- Lateral

Support four images in one case: right frontal, right lateral, left frontal, left lateral. Allow unilateral cases with only the relevant knee’s images. Do not require four images for every patient.

Show previews, upload progress, errors, remove, and replace controls. Keep laboratory attachments separate and unaffected.

2. Independent AI classification
Classify every uploaded X-ray individually:
- Laterality: right, left, bilateral, or unknown.
- View: frontal, lateral, skyline, other, or unknown.
- Whether the image is a knee X-ray.
- Whether image quality permits classification.

Use stable image IDs to associate model results with files. Never associate results only by array position.

The upload slot represents the user’s declared side/view; it must not be treated as the model’s independent detection. Preserve both values separately.

Do not force laterality when evidence is insufficient. Support “unknown” with a concise reason. Do not infer patient laterality solely from the image’s screen position, filename, upload order, selected slot, or affected-knee questionnaire answer. Report visible R/L markers when available; flag ambiguous or conflicting evidence for confirmation. Do not silently mirror or flip images.

Do not claim AP versus PA when the available evidence supports only a frontal view.

3. Results and confirmation
Show a readable caption for every image, for example:
- «عکس ۱: رخ زانوی راست»
- «عکس ۲: نیم‌رخ زانوی چپ»
- «عکس ۳: نمای رخ؛ سمت زانو نامشخص — نیازمند تأیید»

Provide equivalent English labels.

If AI detection conflicts with the chosen slot, show both the declared and detected values and ask the user to confirm or correct the assignment. Never silently overwrite or move images.

Allow authorized users to confirm/correct side and view before submission. Preserve the original AI result, confirmation source, confirming user, and timestamp. Apply existing case-locking rules after submission.

Display uncertainty clearly. Do not present model-reported confidence as calibrated diagnostic accuracy.

4. Backend and persistence
Extend the existing data model and serializers with a clear distinction between:
- Declared side/view.
- AI-detected side/view.
- Confirmed/effective side/view.
- Classification status: pending, processing, completed, failed, or needs_confirmation.
- Evidence/reason, quality status, model/version, and timestamps.

Reuse existing fields where appropriate without changing their meaning silently. Add safe migrations. Existing images must remain accessible and should default to unknown/unclassified; do not invent historical laterality.

Implement authenticated classification and confirmation endpoints following existing permission patterns. Classification must be available during draft upload, independently of the existing post-submission clinical assessment.

Use the existing backend AI credentials and provider configuration. Keep API keys out of the frontend. An unavailable provider or failed classification must leave the uploaded image intact and allow manual confirmation and retry.

Validate model output server-side, including enums, types, expected image IDs, missing results, and duplicate results. Prevent stale classification responses from overwriting a replacement image or later human confirmation.

Enforce slot limits and replacement behavior on the backend, including concurrent requests. Reject accidental duplicate assignments with a useful error. Keep bilateral or unassigned images available for explicit review rather than forcing them into one unilateral slot.

5. Existing clinical assessment
Include stable image IDs and confirmed/declaration/detection metadata alongside images sent to the existing assessment provider, clearly distinguishing their sources.

Keep right-knee and left-knee image findings attributable to the correct knee. Do not combine findings from different knees into an unsupported side-specific conclusion.

Keep this change focused on image classification and upload management. Preserve the existing clinical assessment contract and avoid unrelated changes to surgery recommendations or KL grading.

6. Frontend integration
Update:
- `frontend/src/pages/CaseDetailPage.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types/index.ts`
- Relevant localization and styling files.

Use the existing visual system. Support mobile layouts, Persian RTL, English LTR, accessible controls, and localized captions in both upload and review galleries.

Show missing slots without automatically making all slots mandatory. Preserve the existing minimum-image submission requirement unless a separately documented validation rule is necessary. Require confirmation of unresolved side/view assignments for newly organized images before final submission.

7. Verification
Add meaningful backend and browser tests covering:
- Four images across both knees.
- Unilateral upload.
- Correct image-ID/result mapping.
- Unknown laterality and uncertain view.
- Slot/model conflicts and manual correction.
- Bilateral images.
- Invalid provider responses and provider failure.
- Retry and stale-response handling.
- Replacement and duplicate/concurrent slot assignment.
- Legacy images.
- Laboratory attachments remaining unaffected.
- Unauthorized access and submitted-case locks.
- Persian/English labels and RTL/LTR rendering.

Run the existing backend tests, frontend build/type checks, and relevant browser tests. Mock AI responses in automated tests; do not claim clinical detection accuracy from mocked tests.

Deliver the implementation, migrations, tests, and a concise README update. Summarize changed files, checks run, and remaining limitations. Clearly distinguish a working integration from a clinically validated classifier. Do not deploy or merge automatically.

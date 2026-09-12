# RDG Site Visit v13

The start-page STORAGE disclosure is collapsed by default and contains Open recovery file, Review phone storage, Save all app data, and Restore backup.

## Install
1. Save a backup of current work before updating.
2. Replace the files in your existing GitHub repository and let Vercel redeploy. Keep the SAME website address. Include cloud.js and the new archive.js file.
3. In the app, use Check for update. Return to Start and reopen the app. Confirm Build v13.

## Save a visit to iCloud Drive
1. Complete the visit. Open it from Past visits and tap Save to Cloud.
2. Tap Save ZIP to Cloud when you are ready and on Wi-Fi.
3. On iPhone choose Save to Files, then iCloud Drive, and select your project folder. If sharing is unavailable, use Download ZIP and move it from Downloads to iCloud Drive.
4. Check the ZIP finishes uploading in Files. Extract it to reveal the SVR folder and its contents.
5. Download the ZIP or extracted files to your server when convenient.

One ZIP contains everything. SVR-001.zip extracts to:

| Folder | Contents |
|---|---|
| SVR-001/Report/ | Word report |
| SVR-001/Photos/ | Individual photos named by observation number |
| SVR-001/Photo-Index/ | CSV index with photo notes, time, locations and tags |
| SVR-001/Recovery/ | Dated project recovery JSON |

Keep each project's ZIPs in its own project folder. Further visits use SVR-002, SVR-003, etc. If saving a revised copy of the same visit, choose deliberately whether to replace or retain the prior ZIP in Files. No archive is overwritten by the app itself.

The recovery file contains the selected project's CURRENT available photo and visit history snapshot, including recurring-item history. It is not limited to the exported visit. Keep older recovery files if their photos have been removed locally; a newer snapshot cannot recreate those removed photos. To restore, extract the ZIP and select the JSON inside Recovery.

Draft visits can be exported; complete and save again for final records. A complete visit archive cannot be generated if its photos have been removed locally: use its earlier saved ZIP or restore its recovery file first. Empty-photo visits still include a Photos folder.

The app does not detect Wi-Fi or upload automatically. Your phone handles uploading after Save to Files. The optional confirmation button records YOUR check, not automatic verification.

## Clean up phone storage
- A notice appears when a completed visit is at least 30 days past completion and has removable photos. Older visits without a completion timestamp use the visit date.
- Choose Review phone storage, then Save / review files first or Remove local photos.
- Removal requires an explicit confirmation that the report, photos and recovery file are safely saved in your cloud or server. Nothing is deleted automatically.
- Project details, visit numbering, notes and item history stay on the device. Photos supporting currently open items stay too. Retained photos can be removed later once the items are closed.
- After removal, old observations show a clear placeholder. Use the cloud report or restore a recovery file containing those photos to rebuild the old report.

## Restore a project
From Start, expand STORAGE and choose Open recovery file and select its JSON file in Files. If the project already exists, confirmation explains that this replaces its current visits, including newer work. Save current work first. Other projects are preserved. This restores a snapshot; it does not merge newer work.

STORAGE also contains Save all app data and Restore backup for full-device recovery. Restore backup replaces ALL app projects. v9/v10/v11 version-1 backups remain supported. v13 files with removed-photo records require v13 or newer.

## Photo quality
Requests a 3840 x 2160 camera stream where supported, removes the old 1600-pixel capture cap and saves JPEGs at quality 0.92. Actual resolution depends on the device and browser. These are camera-stream captures, not guaranteed full sensor originals. Existing photos cannot gain lost detail. Word reports use smaller copies without changing stored photos.

## Verification
JavaScript syntax and local data checks passed, covering project recovery, exact saved photo bytes, ID remapping, preservation of other projects, cancelled restore/share, corrupt recovery rejection, legacy backups, 30-day cleanup boundaries and protection of open-item evidence. Tests use a simulated database transaction layer, not a physical iPhone.

Browser preview access was denied in this session. The iPhone camera, native share sheet and iCloud handoff need a device check before field use. Try one test visit, save all groups, check the cloud files and open the project recovery file on another device before removing important local photos.

For repeatable local checks with Node.js 22 or newer:
- node tests/storage-checks.cjs
- node tests/archive-checks.cjs

ZIP output was also opened with an independent Python ZIP reader: checksums, Unicode filenames, folder entries and exact file bytes passed.

# Disposable native QA

Use `npm run package:qa` for native demo acceptance. It builds a separate `release-qa/mac-arm64/DayBoard QA.app` with bundle ID `com.mileschu.dayboard.qa`, an ad-hoc signature, no Google client, licensing or updater, and demo behavior compiled into the backend. Its native panel code remains enabled; `package:test` suppresses those native controls for automated tests.

QA startup requires an explicit `DAYBOARD_USER_DATA` directory that is empty or already marked as an owned demo fixture. Both backend and browser storage must resolve there before services initialize. The canonical DayBoard profile, parent/child paths, symlinks and unmarked existing profiles are rejected. With no profile environment, startup exits before handlers, stores, single-instance locking or windows. `DAYBOARD_DEMO=0` cannot turn a QA build into a real-account build.

The packaging command verifies a proof tied to every emitted main-process chunk before and after packaging. A stale ordinary beta cannot be relabeled as this QA build. Keep QA artifacts separate from release installers and never distribute them to testers as a real-account beta.

Do not use an ordinary beta plus runtime environment variables for tool-driven native QA: after the app quits, an app-bound observation can relaunch it without those variables. Observe process state with non-launching tools after quit. A QA build fails closed on such a relaunch, but that does not authorize native interaction or new OS/account permissions. Native testing still needs the applicable grant and a disposable fixture. Temporary storage does not isolate system EventKit accounts; QA must remain demo-only.

This repair prevents future QA fallback; it cannot establish or restore past profile values. Preserve incident evidence and require a verified backup and a specific restore plan before any recovery write. Unit and packaging tests use synthetic files and mock Electron APIs; they do not prove OS-level pre-JavaScript behavior or real-app acceptance.

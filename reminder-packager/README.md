# Compact Reminder Packager

A unified React + Capacitor application for creating Smart Notes-style compact reminders and packaging them as lightweight attachments for email, SMS/text, app view, and web view.

## What is implemented

- Sender composer for title, date, time, location, milestone, urgency, notes, snooze, and auto-dismiss rules.
- Smart stack-style reminder preview inspired by the provided screenshot.
- Recipient web viewer attachment: a standalone HTML popup that opens without installing the app.
- JSON `.reminder.json` attachment for app import/shared reminder object workflows.
- Native share flow when the browser/device supports file sharing; fallback downloads + `mailto:` / `sms:` compose links.
- Expand/minimize details with smooth transitions.
- Hold + swipe left/right interactions on each line item.
- Circle gesture confirmation ring that opens the recipient picker.
- Status color indicators based on due time and urgency.
- PWA manifest and Capacitor config for Android/iOS from one codebase.
- GitHub Actions workflow for web audit plus Android/iOS sync/build validation.

## Important platform reality

Mobile OSes restrict true always-on-top overlays and forced popups, especially iOS. The shipped approach uses in-app/PWA floating overlays, notifications, and a standalone web-view popup attachment. Android can add stronger overlay behavior later with native permissions; iOS requires notification/live-activity style patterns instead of unrestricted overlays.

Email and SMS clients also restrict silently adding attachments from a normal browser. On capable mobile browsers, the app uses the native Web Share API with files. Otherwise it downloads the JSON + HTML package and opens the email/text composer.

## Run locally

```bash
npm install
npm run dev
```

## Audit

```bash
npm run audit:local
```

This runs unit tests and a production build.

## Mobile packaging

```bash
npm run build
npx cap add android
npx cap add ios
npm run cap:sync
```

Then open the native projects with:

```bash
npm run cap:android
npm run cap:ios
```

## Next production stages

1. Add authenticated cloud sync and conflict resolution using a backend service.
2. Add push notification credentials for Android/iOS.
3. Add native Android overlay permission flow if true floating overlays are required.
4. Add import handler/deep links for `.reminder.json` and shared web links.

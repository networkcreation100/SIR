# Backend Sync Layer

This project includes a deployed Base44 backend function and entity schemas for production cloud sync.

## Entities

- `ReminderPackage` — stores shared reminder payloads, version numbers, permission mode, recipients, status, and conflict metadata.
- `ReminderDeliveryEvent` — logs packaging, sent/opened/seen/snoozed/replied/conflict events.

## Function

`reminderSync` is deployed at:

```text
https://superagent-934909c8.base44.app/functions/reminderSync
```

Supported actions via JSON body:

- `{ "action": "health" }`
- `{ "action": "save", "payload": {...}, "version": 1 }`
- `{ "action": "fetch", "share_token": "..." }`
- `{ "action": "event", "share_token": "...", "event_type": "opened" }`

The save path increments versions and returns `409` with the current record when an older client attempts to overwrite a newer reminder.

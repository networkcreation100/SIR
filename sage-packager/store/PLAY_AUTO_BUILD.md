# SAGE → Google Play: automatic signed .aab via GitHub Actions

You do NOT need Android Studio or a local Android SDK. GitHub builds and signs
the `.aab` in the cloud and (optionally) uploads it straight to your Play account.

App ID (package name): `com.networkcreation.reminderpackager`
Play developer account: 4784239758286177670

---

## Step 1 — Create your upload keystore (ONE time, on any machine with Java)

Run this locally (macOS/Linux/Windows with JDK installed). Keep the resulting
`.jks` file and passwords safe — losing them means you can't update the app.

    keytool -genkey -v \
      -keystore sage-upload.jks \
      -alias sir-upload \
      -keyalg RSA -keysize 2048 -validity 10000

It will ask for a keystore password, your name/org, etc. Remember:
  - the **keystore password** you type
  - the **alias** = `sir-upload`
  - the **key password** (press Enter to reuse the keystore password)

Then base64-encode it so it can live safely in a GitHub secret:

    # macOS / Linux
    base64 -i sage-upload.jks | tr -d '\n' > sage-upload.jks.base64.txt

    # Windows PowerShell
    [Convert]::ToBase64String([IO.File]::ReadAllBytes("sage-upload.jks")) > sage-upload.jks.base64.txt

---

## Step 2 — Add GitHub repo secrets

In your GitHub repo: **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret**

| Secret name                 | Value                                             |
|-----------------------------|---------------------------------------------------|
| ANDROID_KEYSTORE_BASE64     | contents of `sage-upload.jks.base64.txt`           |
| ANDROID_KEYSTORE_PASSWORD   | the keystore password from Step 1                 |
| ANDROID_KEY_ALIAS           | `sir-upload`                                       |
| ANDROID_KEY_PASSWORD        | the key password from Step 1                       |
| PLAY_SERVICE_ACCOUNT_JSON   | (optional) Play API service-account JSON — Step 4  |

Without `PLAY_SERVICE_ACCOUNT_JSON` you still get a fully signed `.aab` to
download from the Actions run; you just upload it to Play Console by hand.

---

## Step 3 — Run the build

Push this repo to GitHub, then either:
  - **Actions tab ▸ "Android Release (signed AAB → Play)" ▸ Run workflow**, set
    versionName (e.g. `1.0.0`) and versionCode (e.g. `1`), or
  - push a tag: `git tag v1.0.0 && git push origin v1.0.0`

When it finishes, open the run and download the artifact
**`sir-release-aab-<version>`** — that's your signed `app-release.aab`.

IMPORTANT: `versionCode` must INCREASE with every upload to Play (1, 2, 3, …).

---

## Step 4 — (Optional) Auto-upload to Play

1. Play Console ▸ **Setup ▸ API access** ▸ create/link a Google Cloud project.
2. Create a **service account**, grant it the "Release to testing tracks" (or
   more) permission in Play Console ▸ Users & permissions.
3. Download the service-account **JSON key**, paste its full contents into the
   `PLAY_SERVICE_ACCOUNT_JSON` GitHub secret.

Now every workflow run uploads the signed bundle to the **internal** testing
track automatically. Change the track in the "Run workflow" dropdown
(internal / alpha / beta / production).

NOTE: The very FIRST release of a brand-new app usually has to be created
manually once in Play Console (App bundle explorer / create release) before the
API is allowed to push to production. Internal testing track works via API from
the start.

---

## What the CI does under the hood
- `npm ci` → `npm run build` → `npx cap sync android`
- writes `android/key.properties` from your secrets
- `./gradlew bundleRelease` with your version fields → signed `app-release.aab`
- uploads it as an artifact and (if configured) to Play
- deletes the keystore + key.properties from the runner afterward

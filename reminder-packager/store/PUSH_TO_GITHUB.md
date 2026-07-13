# Get Synlive onto GitHub (so the cloud build can make your .aab)

Do this on your own computer after unzipping. It puts the `reminder-packager`
folder into a brand-new GitHub repo, which triggers the signed-.aab workflow.

---

## A. Create an empty repo on GitHub
1. Go to https://github.com/new
2. Name it e.g. `sir-app` (Private is fine).
3. Do NOT add a README/.gitignore/license (keep it empty).
4. Copy the repo URL it shows you, e.g.
   `https://github.com/YOURNAME/sir-app.git`

---

## B. Push the project (run these in a terminal)

macOS / Linux / Windows (Git Bash or PowerShell):

    # 1. Unzip the package, then cd into the app folder:
    cd path/to/unzipped/reminder-packager

    # 2. Start a fresh git repo (ignore any existing .git in the zip):
    rm -rf .git
    git init
    git add .
    git commit -m "Synlive app: initial commit with signed-AAB CI"
    git branch -M main

    # 3. Point at YOUR new GitHub repo (paste the URL from step A):
    git remote add origin https://github.com/YOURNAME/sir-app.git

    # 4. Push:
    git push -u origin main

If GitHub asks for a password, use a **Personal Access Token** (GitHub ▸
Settings ▸ Developer settings ▸ Personal access tokens), not your account
password. Or install GitHub Desktop and "Add existing repository" → Publish.

---

## C. Add your signing secrets
Follow `store/PLAY_AUTO_BUILD.md`:
  - create the keystore with the `keytool` command
  - add the 4 secrets (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,
    ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD)

---

## D. Build the signed .aab
GitHub ▸ **Actions** tab ▸ "Android Release (signed AAB → Play)" ▸
**Run workflow** ▸ enter versionName `1.0.0`, versionCode `1` ▸ Run.

When it finishes, open the run and download the artifact
**`sir-release-aab-1.0.0`** → inside is `app-release.aab` → upload that to
Play Console.

Remember: bump versionCode (2, 3, 4…) for every new upload.

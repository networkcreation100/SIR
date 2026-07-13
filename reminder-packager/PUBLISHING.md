# Synlive — App Store Publishing Guide

Everything you need to take **Synlive (smart interactive reminder)** from this source to live on the Apple App Store and Google Play.

- **App name:** Synlive
- **Bundle / Application ID:** `com.networkcreation.reminderpackager`
- **Version:** 1.0 (build 1)
- **Framework:** React + Vite + Capacitor

---

## 0. One-time prerequisites

| Item | Where | Cost |
|------|-------|------|
| Apple Developer Program | https://developer.apple.com/programs/ | $99 / year |
| Google Play Console account | https://play.google.com/console/signup | $25 one-time |
| A Mac with **Xcode** | Mac App Store | required for iOS |
| **Android Studio** | https://developer.android.com/studio | required for Android |
| Node.js 18+ | https://nodejs.org | free |
| A hosted **Privacy Policy URL** | see `store/privacy-policy.html` | free (host anywhere) |

> iOS builds can **only** be produced on macOS. Android can be built on Windows/Mac/Linux.

---

## 1. Build the web app

```bash
cd reminder-packager
npm install
npm run build        # outputs dist/
npx cap sync         # copies dist/ into android/ and ios/ and updates native plugins
```

Run `npx cap sync` after **every** web change before you rebuild native.

---

## 2. Generate app icons (optional but recommended)

```bash
npm install -g @capacitor/assets   # or: npx @capacitor/assets
# place a 1024x1024 PNG at resources/icon.png and a 2732x2732 splash at resources/splash.png
npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff'
```

A ready 1024px icon already exists at `dist/sir-icon-1024.png` — copy it to `resources/icon.png`.

---

## 3. Android → Google Play (.aab)

### 3a. Create an upload keystore (once)
```bash
keytool -genkey -v -keystore sir-upload-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias sir-upload
```
Keep `sir-upload-key.jks` and its passwords **safe and backed up** — losing it means you can't update the app.

### 3b. Reference it in `android/keystore.properties` (create this file)
```
storeFile=../sir-upload-key.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=sir-upload
keyPassword=YOUR_KEY_PASSWORD
```
(Signing wiring snippet is in `store/android-signing-snippet.gradle`.)

### 3c. Build the release bundle
```bash
npx cap open android         # opens Android Studio
# In Android Studio: Build ▸ Generate Signed Bundle / APK ▸ Android App Bundle
# Or CLI:
cd android && ./gradlew bundleRelease
# output: android/app/build/outputs/bundle/release/app-release.aab
```

### 3d. Upload to Play Console
Create app ▸ Production ▸ Create release ▸ upload the `.aab` ▸ fill in listing (see `store/STORE_LISTING.md`) ▸ complete **Data safety** + content rating ▸ roll out.

---

## 4. iOS → App Store (.ipa)

```bash
npx cap open ios             # opens Xcode
```
In Xcode:
1. Select the **App** target ▸ **Signing & Capabilities** ▸ choose your Team (auto-manage signing).
2. Set **Version** 1.0 and **Build** 1.
3. Choose device target **Any iOS Device (arm64)**.
4. **Product ▸ Archive** ▸ when done, **Distribute App ▸ App Store Connect ▸ Upload**.
5. In https://appstoreconnect.apple.com create the app record (bundle `com.networkcreation.reminderpackager`), attach the build, fill in listing + privacy details, submit for review.

---

## 5. Before you submit — checklist

See `store/SUBMISSION_CHECKLIST.md`. Highlights:
- [ ] Privacy Policy URL is live and reachable
- [ ] Stripe **live** secret key set in the hosted backend (real charges)
- [ ] Screenshots captured for required device sizes
- [ ] Permission usage strings accurate (already set: Location, Microphone, Speech)
- [ ] App tested on a real device

---

## 6. Payments note

Payments use **Stripe Elements + PaymentIntent** — this is a donation/support flow, not digital goods that unlock in-app content, so it's generally fine outside Apple/Google's in-app-purchase requirement. If you later gate app features behind the payment, Apple/Google may require their in-app purchase system instead. Keep the "Support / donation" framing to stay in the clear.

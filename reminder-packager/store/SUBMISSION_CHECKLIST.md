# SIR — Submission Checklist

## Accounts & setup
- [ ] Apple Developer Program active ($99/yr)
- [ ] Google Play Console account active ($25 one-time)
- [ ] Android upload keystore created and **backed up** (sir-upload-key.jks)
- [ ] iOS signing set to your Team in Xcode (auto-manage signing)

## App configuration (already done in this project)
- [x] App name: SIR
- [x] Bundle/App ID: com.networkcreation.reminderpackager
- [x] Version 1.0 / build 1
- [x] Android permissions: INTERNET, FINE/COARSE_LOCATION, RECORD_AUDIO
- [x] iOS usage strings: Location, Microphone, Speech Recognition
- [x] App icons present (Android mipmaps + iOS appiconset)

## Content to prepare
- [ ] Privacy Policy hosted at a public URL (use store/privacy-policy.html)
- [ ] Real support email set in privacy policy + listing
- [ ] Screenshots for required device sizes (see STORE_LISTING.md)
- [ ] Store description, keywords, category (see STORE_LISTING.md)
- [ ] Data safety form (Google) / App Privacy details (Apple) filled in:
      - Location: used, not sold, tied to app function
      - Microphone/audio: used for speech-to-text, not stored
      - Payment info: handled by Stripe, not stored by app
      - Contacts you type: used only to deliver reminders

## Payments
- [ ] Stripe LIVE secret key set in the hosted backend (STRIPE_SECRET_KEY)
- [ ] Live publishable key matches (pk_live)
- [ ] Test a real low-value charge, confirm Stripe receipt email arrives

## Build & submit
- [ ] npm install && npm run build && npx cap sync
- [ ] Android: ./gradlew bundleRelease → upload .aab to Play Console
- [ ] iOS: Xcode Archive → Distribute → App Store Connect
- [ ] Tested on at least one real device (location + voice + payment)
- [ ] Submit for review

## After approval
- [ ] Verify live listing, links, and payment on the published build
- [ ] Bump versionCode/build number for every future update

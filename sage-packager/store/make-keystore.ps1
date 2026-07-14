# SAGE - Windows 11 keystore + GitHub secrets helper
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File .\make-keystore.ps1
#
# It will:
#   1) create sage-upload.jks (asks you for a password)
#   2) print the 4 values you paste into GitHub repo Secrets

$ErrorActionPreference = "Stop"
$ks    = "sage-upload.jks"
$alias = "sir-upload"

Write-Host "=== SAGE keystore generator ===" -ForegroundColor Cyan

# check keytool
$kt = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $kt) {
  Write-Host "keytool not found. Install a JDK first:" -ForegroundColor Yellow
  Write-Host "   winget install Microsoft.OpenJDK.17" -ForegroundColor Yellow
  Write-Host "Then close and reopen PowerShell and run this script again."
  exit 1
}

if (Test-Path $ks) {
  Write-Host "$ks already exists in this folder. Delete it first if you want a new one." -ForegroundColor Yellow
  exit 1
}

# ask for a password (used for both store + key)
$sec = Read-Host "Choose a keystore password (write it down and keep it safe)" -AsSecureString
$pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

# generate keystore, non-interactive
$dname = "CN=Network Creation LLC, OU=SAGE, O=Network Creation LLC, L=Honolulu, ST=HI, C=US"
keytool -genkeypair -v -keystore $ks -alias $alias -keyalg RSA -keysize 2048 `
  -validity 10000 -storepass $pw -keypass $pw -dname $dname

if (-not (Test-Path $ks)) { Write-Host "Keystore was not created." -ForegroundColor Red; exit 1 }

# base64 the keystore
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))
Set-Content -Path "sage-upload.jks.base64.txt" -Value $b64 -NoNewline

Write-Host ""
Write-Host "=== DONE. Keystore created: $ks  (KEEP THIS FILE SAFE) ===" -ForegroundColor Green
Write-Host ""
Write-Host "Now add these 4 GitHub repo secrets at:" -ForegroundColor Cyan
Write-Host "  https://github.com/networkcreation100/SIR/settings/secrets/actions" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ANDROID_KEYSTORE_BASE64   = (contents of sage-upload.jks.base64.txt in this folder)"
Write-Host "  ANDROID_KEYSTORE_PASSWORD = the password you just typed"
Write-Host "  ANDROID_KEY_ALIAS         = sir-upload"
Write-Host "  ANDROID_KEY_PASSWORD      = the same password"
Write-Host ""
Write-Host "The base64 value is long. Open sage-upload.jks.base64.txt, press Ctrl+A then Ctrl+C, and paste."
Write-Host "It has also been copied to your clipboard automatically."
Set-Clipboard -Value $b64

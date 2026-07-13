import { Capacitor, registerPlugin } from '@capacitor/core';

const SynliveContacts = registerPlugin('SynliveContacts');

export function nativeContactPickerSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function pickNativePhoneContact() {
  if (!nativeContactPickerSupported()) return { supported: false, cancelled: false, contact: null };
  try {
    const result = await SynliveContacts.pickPhoneContact();
    if (result?.cancelled) return { supported: true, cancelled: true, contact: null };
    const phone = String(result?.phone || '').trim();
    if (!phone) return { supported: true, cancelled: false, contact: null };
    return {
      supported: true,
      cancelled: false,
      contact: {
        name: result?.name ? [String(result.name)] : [],
        tel: [phone]
      }
    };
  } catch (error) {
    return { supported: true, cancelled: true, contact: null, error };
  }
}

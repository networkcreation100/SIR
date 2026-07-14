package com.networkcreation.sage;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SAGEContacts")
public class SAGEContactsPlugin extends Plugin {
    @PluginMethod
    public void pickPhoneContact(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        if (intent.resolveActivity(getActivity().getPackageManager()) == null) {
            call.reject("No contacts app is available on this device.");
            return;
        }
        startActivityForResult(call, intent, "pickPhoneContactResult");
    }

    @ActivityCallback
    private void pickPhoneContactResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri contactUri = result.getData().getData();
        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = getContext().getContentResolver().query(contactUri, projection, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("No phone number was returned from the selected contact.");
                return;
            }
            int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
            int phoneIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
            String name = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
            String phone = phoneIndex >= 0 ? cursor.getString(phoneIndex) : "";

            JSObject ret = new JSObject();
            ret.put("cancelled", false);
            ret.put("name", name == null ? "" : name);
            ret.put("phone", phone == null ? "" : phone);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Could not read the selected phone contact.", error);
        }
    }
}

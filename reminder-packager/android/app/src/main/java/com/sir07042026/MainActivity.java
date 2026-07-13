package com.sir07042026;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SynliveContactsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

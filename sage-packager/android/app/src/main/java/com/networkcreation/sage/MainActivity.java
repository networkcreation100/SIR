package com.networkcreation.sage;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SAGEContactsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

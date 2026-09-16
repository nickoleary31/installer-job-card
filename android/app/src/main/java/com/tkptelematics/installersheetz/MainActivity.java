package com.tkptelematics.installersheetz;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // See StaticExportWebViewClient — fixes hard navigation/reload to a
        // packaged static-export route resolving to the wrong document.
        bridge.setWebViewClient(new StaticExportWebViewClient(bridge));
    }
}

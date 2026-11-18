package com.zamercad.offline;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.widget.ArrayAdapter;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

// The Activity checks the appropriate permission before any Bluetooth operation.
// Scanner and GATT callbacks run on the main looper alongside Activity events.
@SuppressLint("MissingPermission")
final class SurveyLaser {
    static final int PERMISSION_REQUEST = 5042;
    private static final UUID SERVICE = UUID.fromString("3ab10100-f831-4395-b29d-570977d5bf94");
    private static final UUID DISTANCE = UUID.fromString("3ab10101-f831-4395-b29d-570977d5bf94");
    private static final UUID CLIENT_CONFIGURATION = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final long SCAN_TIMEOUT_MS = 12_000;
    private static final long CONNECT_TIMEOUT_MS = 20_000;

    interface Reporter {
        void send(String status, String name, Double value, String message);
    }

    private record Peripheral(BluetoothDevice device, String name) {}

    private final Activity activity;
    private final Reporter reporter;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Peripheral> peripherals = new ArrayList<>();
    private final Set<String> seenAddresses = new HashSet<>();
    private final Runnable scanTimeout = this::finishScan;
    private final Runnable connectTimeout = () -> fail("Дальномер не ответил. Проверьте Bluetooth на приборе.");
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private ArrayAdapter<String> labels;
    private AlertDialog picker;
    private BluetoothGatt connection;
    private String connectedName;
    private boolean subscribed;
    private boolean permissionPending;
    private boolean connectRequested;
    private boolean closed;

    SurveyLaser(Activity activity, Reporter reporter) {
        this.activity = activity;
        this.reporter = reporter;
    }

    void connect() {
        if (closed || scanCallback != null || picker != null || connection != null) return;
        if (!activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            fail("Телефон не поддерживает Bluetooth Low Energy.");
            return;
        }
        connectRequested = true;
        if (permissionPending) return;
        String[] missing = missingPermissions();
        if (missing.length > 0) {
            permissionPending = true;
            reporter.send("scanning", null, null, "Ожидание разрешения Bluetooth");
            activity.requestPermissions(missing, PERMISSION_REQUEST);
            return;
        }
        beginScan();
    }

    void onPermissionsResult() {
        permissionPending = false;
        if (closed || !connectRequested) return;
        if (missingPermissions().length == 0) beginScan();
        else fail("Разрешите поиск устройств в настройках приложения.");
    }

    void disconnect() {
        reset();
        if (!closed) reporter.send("disconnected", null, null, null);
    }

    void close() {
        closed = true;
        reset();
    }

    private String[] missingPermissions() {
        String[] required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }
            : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
        List<String> missing = new ArrayList<>();
        for (String permission : required) {
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        }
        return missing.toArray(new String[0]);
    }

    private void beginScan() {
        try {
            BluetoothManager manager = activity.getSystemService(BluetoothManager.class);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                fail("Включите Bluetooth на телефоне.");
                return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                LocationManager location = activity.getSystemService(LocationManager.class);
                if (location == null || !location.isLocationEnabled()) {
                    fail("На этой версии Android для поиска Bluetooth включите геолокацию.");
                    return;
                }
            }
            scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) {
                fail("Поиск Bluetooth недоступен.");
                return;
            }
            scanCallback = new ScanCallback() {
                @Override
                public void onScanResult(int callbackType, ScanResult result) {
                    if (scanCallback == this) addPeripheral(result);
                }

                @Override
                public void onScanFailed(int errorCode) {
                    if (scanCallback == this) fail("Поиск Bluetooth не удался. Повторите попытку.");
                }
            };
            ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
            scanner.startScan(Collections.emptyList(), settings, scanCallback);
            reporter.send("scanning", null, null, "Поиск Leica DISTO D2…");
            handler.postDelayed(scanTimeout, SCAN_TIMEOUT_MS);
        } catch (IllegalStateException | SecurityException error) {
            fail("Поиск Bluetooth недоступен. Проверьте разрешения и настройки телефона.");
        }
    }

    private void addPeripheral(ScanResult result) {
        BluetoothDevice device = result.getDevice();
        if (device == null || !result.isConnectable()) return;
        ScanRecord record = result.getScanRecord();
        String name = record == null ? null : record.getDeviceName();
        try {
            if (name == null || name.trim().isEmpty()) name = device.getName();
        } catch (SecurityException error) {
            fail("Разрешение Bluetooth отозвано.");
            return;
        }
        String displayName = name == null ? "" : name.trim();
        String upperName = displayName.toUpperCase(Locale.ROOT);
        List<ParcelUuid> services = record == null ? null : record.getServiceUuids();
        boolean advertisesDisto = services != null && services.contains(new ParcelUuid(SERVICE));
        if (upperName.matches(".*\\bD2[ _-]*G\\b.*") || (!advertisesDisto && !upperName.contains("DISTO"))) return;
        String address = device.getAddress();
        if (!seenAddresses.add(address)) return;
        if (displayName.isEmpty()) displayName = "Leica DISTO";
        peripherals.add(new Peripheral(device, displayName));
        if (picker == null) showPicker();
        labels.add(displayName + " · " + address.substring(address.length() - 5));
    }

    private void showPicker() {
        labels = new ArrayAdapter<>(activity, android.R.layout.simple_list_item_1);
        picker = new AlertDialog.Builder(activity)
            .setTitle("Выберите дальномер")
            .setAdapter(labels, (dialog, which) -> selectPeripheral(peripherals.get(which)))
            .setNegativeButton("Отмена", (dialog, which) -> disconnect())
            .setOnCancelListener(dialog -> disconnect())
            .show();
    }

    private void finishScan() {
        stopScan();
        if (peripherals.isEmpty()) fail("DISTO D2 не найден. Включите Bluetooth на дальномере и повторите поиск.");
        else reporter.send("scanning", null, null, "Выберите дальномер в списке");
    }

    private void selectPeripheral(Peripheral peripheral) {
        stopScan();
        closePicker();
        connectedName = peripheral.name();
        reporter.send("scanning", connectedName, null, "Подключение к дальномеру…");
        try {
            connection = peripheral.device().connectGatt(activity, false, gattCallback,
                BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, handler);
            if (connection == null) fail("Не удалось подключиться к дальномеру.");
            else handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS);
        } catch (IllegalStateException | SecurityException error) {
            fail("Не удалось подключиться к дальномеру. Проверьте Bluetooth и разрешения.");
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int state) {
            if (gatt != connection) return;
            if (state == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                if (subscribed) disconnect();
                else fail("Не удалось подключиться к дальномеру. Проверьте, что он свободен.");
            } else if (state == BluetoothProfile.STATE_CONNECTED) {
                try {
                    if (!gatt.discoverServices()) fail("Не удалось определить протокол дальномера.");
                } catch (IllegalStateException | SecurityException error) {
                    fail("Не удалось прочитать сервисы Bluetooth дальномера.");
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (gatt != connection) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("Не удалось прочитать сервисы Bluetooth дальномера.");
                return;
            }
            try {
                if (!subscribe(gatt)) fail("Дальномер не поддерживает передачу расстояний по протоколу DISTO D2.");
            } catch (IllegalStateException | SecurityException error) {
                fail("Не удалось включить получение измерений.");
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (gatt != connection || !CLIENT_CONFIGURATION.equals(descriptor.getUuid())
                || !DISTANCE.equals(descriptor.getCharacteristic().getUuid())) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("Дальномер не разрешил получение измерений.");
                return;
            }
            subscribed = true;
            handler.removeCallbacks(connectTimeout);
            reporter.send("connected", connectedName, null, null);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                onCharacteristicChanged(gatt, characteristic, characteristic.getValue());
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (gatt != connection || !subscribed || !DISTANCE.equals(characteristic.getUuid())) return;
            Double distance = decodeMillimeters(value);
            if (distance != null) reporter.send("reading", connectedName, distance, null);
        }
    };

    @SuppressWarnings("deprecation")
    private boolean subscribe(BluetoothGatt gatt) {
        BluetoothGattService service = gatt.getService(SERVICE);
        BluetoothGattCharacteristic distance = service == null ? null : service.getCharacteristic(DISTANCE);
        BluetoothGattDescriptor descriptor = distance == null ? null : distance.getDescriptor(CLIENT_CONFIGURATION);
        if (descriptor == null) return false;
        int properties = distance.getProperties();
        byte[] configuration;
        if ((properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
            configuration = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
        } else if ((properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
            configuration = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
        } else {
            return false;
        }
        if (!gatt.setCharacteristicNotification(distance, true)) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return gatt.writeDescriptor(descriptor, configuration) == BluetoothStatusCodes.SUCCESS;
        }
        return descriptor.setValue(configuration) && gatt.writeDescriptor(descriptor);
    }

    static Double decodeMillimeters(byte[] value) {
        if (value == null || value.length != Float.BYTES) return null;
        float meters = ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN).getFloat();
        if (!Float.isFinite(meters) || meters < 0.05f || meters > 100f) return null;
        return Math.round(meters * 1_000_000.0) / 1000.0;
    }

    private void fail(String message) {
        reset();
        if (!closed) reporter.send("error", null, null, message);
    }

    private void reset() {
        connectRequested = false;
        stopScan();
        closePicker();
        handler.removeCallbacks(connectTimeout);
        BluetoothGatt gatt = connection;
        connection = null;
        connectedName = null;
        subscribed = false;
        if (gatt != null) {
            try {
                gatt.disconnect();
            } catch (IllegalStateException | SecurityException ignored) { }
            try {
                gatt.close();
            } catch (IllegalStateException | SecurityException ignored) { }
        }
    }

    private void stopScan() {
        handler.removeCallbacks(scanTimeout);
        ScanCallback previous = scanCallback;
        scanCallback = null;
        if (scanner != null && previous != null) {
            try {
                scanner.stopScan(previous);
            } catch (IllegalStateException | SecurityException ignored) { }
        }
        scanner = null;
    }

    private void closePicker() {
        if (picker != null) picker.dismiss();
        picker = null;
        labels = null;
        peripherals.clear();
        seenAddresses.clear();
    }
}

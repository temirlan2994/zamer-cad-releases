const serviceId = "3ab10100-f831-4395-b29d-570977d5bf94";
const distanceId = "3ab10101-f831-4395-b29d-570977d5bf94";

export function decodeSurveyLaserDistance(value) {
  if (!(value instanceof DataView) || value.byteLength !== 4) return null;
  const metres = value.getFloat32(0, true);
  if (!Number.isFinite(metres) || metres < 0.05 || metres > 100) return null;
  return Math.round(metres * 1e6) / 1000;
}

export function createSurveyLaser() {
  let device = null;
  let characteristic = null;
  let browserReading = null;
  let lostConnection = null;
  let nativeListener = null;
  let connection = 0;
  let name = "";

  function disconnect() {
    connection++;
    if (nativeListener) {
      window.removeEventListener("zamer-laser", nativeListener);
      nativeListener = null;
      window.ZamerAndroid?.disconnectSurveyLaser?.();
    }
    characteristic?.removeEventListener("characteristicvaluechanged", browserReading);
    device?.removeEventListener("gattserverdisconnected", lostConnection);
    if (device?.gatt?.connected) device.gatt.disconnect();
    characteristic = browserReading = lostConnection = device = null;
    name = "";
  }

  async function connect(reading, status) {
    disconnect();
    const attempt = connection;
    if (window.ZamerAndroid?.connectSurveyLaser) {
      nativeListener = ({ detail }) => {
        if (attempt !== connection || !detail) return;
        if (detail.name) name = detail.name;
        if (detail.status === "reading") {
          if (Number.isFinite(detail.value) && detail.value >= 50 && detail.value <= 100_000) reading(detail.value);
          return;
        }
        status(detail.message || (detail.status === "connected" ? "Прибор подключён. Выполните замер" : "Подключение дальномера"), detail.status);
      };
      window.addEventListener("zamer-laser", nativeListener);
      window.ZamerAndroid.connectSurveyLaser();
      return;
    }
    if (!navigator.bluetooth) throw new Error("Bluetooth-дальномер доступен в приложении Android или совместимом браузере");
    status("Выберите Leica DISTO D2", "scanning");
    try {
      const selected = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "DISTO D2" }, { services: [serviceId] }],
        optionalServices: [serviceId],
      });
      if (attempt !== connection) return;
      if (selected.name?.toUpperCase().includes("D2G")) throw new Error("Эта модель передаёт отсчёты в другом формате");
      device = selected;
      name = device.name || "Leica DISTO";
      lostConnection = () => status("Прибор отключён", "disconnected");
      device.addEventListener("gattserverdisconnected", lostConnection);
      const server = await selected.gatt.connect();
      if (attempt !== connection) { selected.gatt.disconnect(); return; }
      const service = await server.getPrimaryService(serviceId);
      const measurement = await service.getCharacteristic(distanceId);
      if (attempt !== connection) return;
      characteristic = measurement;
      browserReading = (event) => {
        const value = decodeSurveyLaserDistance(event.target.value);
        if (attempt === connection && value !== null) reading(value);
      };
      measurement.addEventListener("characteristicvaluechanged", browserReading);
      await characteristic.startNotifications();
      if (attempt === connection) status("Прибор подключён. Выполните замер", "connected");
    } catch (error) {
      if (attempt !== connection) return;
      disconnect();
      const cancelled = error?.name === "NotFoundError";
      throw new Error(cancelled ? "Выбор дальномера отменён" : "Не удалось подключить Leica DISTO D2. Проверьте Bluetooth на приборе");
    }
  }

  return { connect, disconnect, get name() { return name; } };
}

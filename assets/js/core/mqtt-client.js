/**
 * MQTT Client untuk BEMS Dashboard
 * Pastikan script Paho/MQTT.js sudah diload di HTML.
 */

class MqttManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  connect() {
    if (typeof mqtt === 'undefined') {
      console.error("MQTT.js library tidak ditemukan. Pastikan sudah menambahkan CDN di HTML.");
      return;
    }

    const { BROKER_URL, OPTIONS, TOPICS } = APP_CONFIG.MQTT;

    console.log(`Menghubungkan ke MQTT Broker: ${BROKER_URL}...`);
    this.client = mqtt.connect(BROKER_URL, OPTIONS);

    this.client.on('connect', () => {
      console.log('Berhasil terhubung ke MQTT Broker!');
      this.isConnected = true;

      // Subscribe ke topik yang ditentukan di config
      Object.values(TOPICS).forEach(topic => {
        this.client.subscribe(topic, (err) => {
          if (!err) {
            console.log(`Berhasil subscribe ke topik: ${topic}`);
          } else {
            console.error(`Gagal subscribe ke ${topic}`, err);
          }
        });
      });
    });

    this.client.on('message', (topic, message) => {
      // Mengubah Buffer ke string
      const payload = message.toString();
      console.log(`Pesan masuk dari [${topic}]:`, payload);

      this.handleIncomingMessage(topic, payload);
    });

    this.client.on('error', (error) => {
      console.error('Koneksi MQTT Error:', error);
    });

    this.client.on('close', () => {
      if (this.isConnected) {
        console.warn('Koneksi MQTT terputus. Mencoba menghubungkan kembali...');
        this.isConnected = false;
      }
    });
  }

  handleIncomingMessage(topic, payload) {
    try {
      const data = JSON.parse(payload);
      
      // Contoh pemrosesan data (sesuaikan dengan format payload asli)
      // Misalnya payload JSON: {"temperature": 24.5, "humidity": 55}
      
      // Ini adalah contoh mengubah DOM berdasarkan topic
      if (topic.includes('weather/temperature')) {
        // Cari elemen di HTML, misal id="outdoor-temp"
        const tempEl = document.getElementById('outdoor-temp');
        if (tempEl) tempEl.innerText = `${data.temperature} °C`;
      }
      
      // Implementasi spesifik dapat ditambahkan di sini berdasarkan topic.

    } catch (e) {
      // Jika payload bukan JSON, tampilkan string saja
      console.log(`Nilai mentah dari ${topic}: ${payload}`);
    }
  }
}

// Inisialisasi MQTT saat halaman dimuat
document.addEventListener("DOMContentLoaded", () => {
  window.mqttManager = new MqttManager();
  window.mqttManager.connect();
});

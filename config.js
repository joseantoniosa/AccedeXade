const fs = require('fs');
const path = require('path');

const config = {
  TIMEOUT: 120000,
  DOWNLOAD_DIR: path.join(__dirname, 'downloads'),
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  ensureDownloadsDir: () => {
    if (!fs.existsSync(config.DOWNLOAD_DIR)) {
      fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
    }
    // Limpiar descargas anteriores
    fs.readdirSync(config.DOWNLOAD_DIR).forEach(file => {
      try {
        fs.unlinkSync(path.join(config.DOWNLOAD_DIR, file));
      } catch (err) {
        console.warn(`No se pudo eliminar ${file}:`, err.message);
      }
    });
  }
};

module.exports = config;
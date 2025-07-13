const fs = require('fs');
const config = require('./config');
const axios = require('axios');
const { URL } = require('url');

module.exports = {
  downloadFile: async (url, downloadPath) => {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(downloadPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  },

  verifyDownload: (timeout = 60000) => {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const files = fs.readdirSync(config.DOWNLOAD_DIR);
        const validFiles = files.filter(file => 
          file.match(/\.(xlsx|ods|csv|pdf)$/i) &&
          !file.endsWith('.crdownload') &&
          !file.endsWith('.tmp')
        );
        
        if (validFiles.length > 0) {
          clearInterval(checkInterval);
          resolve(validFiles[0]);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Tiempo de espera para descarga excedido'));
        }
      }, 2000);
    });
  }
};
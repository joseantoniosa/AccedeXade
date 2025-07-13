const puppeteer = require('puppeteer');
const config = require('./config');

module.exports = {
  launchBrowser: async () => {
    const browser = await puppeteer.launch({
      headless: false,
      slowMo: 100,
      defaultViewport: null,
      args: [
        '--start-maximized',
        `--download.default_directory=${config.DOWNLOAD_DIR}`,
        '--disable-web-security'
      ],
      ignoreHTTPSErrors: true
    });

    return browser;
  }
};
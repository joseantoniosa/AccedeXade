
const config = require('./config');

module.exports = {
  login: async (page, username, password, url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username', { timeout: 15000 });
    await page.type('#username', username);
    await page.type('#password', password);
    
    await Promise.all([
      page.click('#botonentrarlogin'),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);
  }
};
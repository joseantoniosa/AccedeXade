const config = require('./config');

module.exports = {
  getStableFrame: async (page, frameName) => {
    for (let attempts = 0; attempts < 8; attempts++) {
      const frame = page.frames().find(f => f.name() === frameName);
      
      if (frame && !frame.isDetached()) {
        try {
          // Verificar que el frame está activo
          await frame.evaluate(() => document.readyState);
          return frame;
        } catch (e) {
          console.log(`⚠️ Frame ${frameName} error, reintento ${attempts + 1}/8`);
          await config.delay(1500);
        }
      } else {
        await config.delay(1000);
      }
    }
    throw new Error(`Frame "${frameName}" not available after 8 attempts`);
  }
};
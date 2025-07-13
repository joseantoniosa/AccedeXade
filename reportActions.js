const config = require('./config');
const frameUtils = require('./frameUtils');

module.exports = {
  navigateToReports: async (page) => {
    const menuFrame = await frameUtils.getStableFrame(page, 'menu');
    
    // Esperar y hacer clic en "Informes"
    await menuFrame.waitForSelector('#menu_05', { timeout: 40000, visible: true });
    await menuFrame.click('#menu_05');
    
    // Esperar a que el submenú esté completamente visible
    await menuFrame.waitForSelector('#HM_Item5_1', { timeout: 30000, visible: true });
    await config.delay(1000);  // Espera adicional para animaciones
    
    // Hacer clic en "Informes predefinidos"
    await menuFrame.click('#HM_Item5_1');
    await config.delay(3000);
  },

  selectXerador: async (page) => {
    const menuFrame = await frameUtils.getStableFrame(page, 'menu');
    
    // Estrategia robusta para encontrar "Xerador"
    try {
      // Intentar con el selector original
      await menuFrame.waitForSelector('#submenu_06', { 
        timeout: 30000,
        visible: true 
      });
      await menuFrame.click('#submenu_06');
    } catch (error) {
      console.log('⚠️ No se encontró #submenu_06, usando alternativa...');
      
      // Alternativa 1: Buscar por texto
      const xeradorElement = await menuFrame.evaluateHandle(() => {
        const items = Array.from(document.querySelectorAll('.menuItem'));
        return items.find(item => 
          item.textContent.includes('Xerador') || 
          item.textContent.includes('Generador')
        );
      });
      
      if (xeradorElement) {
        await menuFrame.evaluate(el => el.click(), xeradorElement);
      } else {
        // Alternativa 2: Buscar por posición
        const menuItems = await menuFrame.$$('.menuItem');
        if (menuItems.length >= 6) {
          // El sexto elemento del menú (índice 5)
          await menuItems[5].click();
        } else {
          throw new Error('No se pudo encontrar el elemento Xerador');
        }
      }
    }
    
    await config.delay(5000);
  }
};
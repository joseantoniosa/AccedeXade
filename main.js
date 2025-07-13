const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { URL } = require('url');
const readline = require('readline');
const puppeteer = require('puppeteer');

const config = require('./config');
const browser = require('./browser');
const auth = require('./auth');
const frameUtils = require('./frameUtils');
const reportActions = require('./reportActions');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

(async () => {
  const [username, password, url] = process.argv.slice(2);
  
  if (!username || !password || !url) {
    console.error('❌ Uso: node main.js <usuario> <contraseña> <url>');
    process.exit(1);
  }
  
  config.ensureDownloadsDir();
  
  let browserInstance, page;

  try {
    console.log('🛠️ Inicializando navegador...');
    browserInstance = await browser.launchBrowser();
    page = await browserInstance.newPage();
    await page.setDefaultNavigationTimeout(config.TIMEOUT);
    console.log('✅ Navegador listo');

    console.log('🔑 Iniciando sesión...');
    await auth.login(page, username, password, url);
    console.log('✅ Sesión iniciada correctamente');

    console.log('📋 Accediendo a menú de informes...');
    await reportActions.navigateToReports(page);
    
    console.log('🔘 Seleccionando Xerador...');
    try {
      await reportActions.selectXerador(page);
    } catch (error) {
      console.error('❌ Error al seleccionar Xerador:', error.message);
      console.log('🔄 Reintentando navegación completa...');
      await page.goto(url, { waitUntil: 'networkidle2' });
      await auth.login(page, username, password, url);
      await reportActions.navigateToReports(page);
      await reportActions.selectXerador(page);
    }
    
    console.log('🔍 Buscando tablas disponibles...');
    const leftFrame = await frameUtils.getStableFrame(page, 'leftFrame');
    
    const tablas = await leftFrame.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      return divs
        .filter(div => div.textContent.trim() !== '')
        .map(div => div.textContent.trim());
    });
    
    if (tablas.length === 0) {
      throw new Error('No se encontraron tablas en el frame izquierdo');
    }
    
    console.log('\n📋 Tablas disponibles:');
    console.log('====================');
    tablas.forEach((tabla, index) => {
      console.log(` ${index + 1}. ${tabla}`);
    });
    console.log('====================\n');
    
    let seleccionTabla = null;
    while (!seleccionTabla) {
      const respuesta = await askQuestion('Seleccione una tabla por número: ');
      const numero = parseInt(respuesta);
      
      if (isNaN(numero)) {
        console.log('❌ Por favor ingrese un número válido');
        continue;
      }
      
      if (numero < 1 || numero > tablas.length) {
        console.log(`❌ Por favor ingrese un número entre 1 y ${tablas.length}`);
        continue;
      }
      
      seleccionTabla = tablas[numero - 1];
    }
    
    console.log(`✅ Tabla seleccionada: ${seleccionTabla}`);
    
    await leftFrame.evaluate((tablaText) => {
      const divs = Array.from(document.querySelectorAll('div'));
      const div = divs.find(div => div.textContent.trim() === tablaText);
      if (div) {
        div.scrollIntoView({ behavior: 'smooth', block: 'center' });
        div.click();
      }
    }, seleccionTabla);
    
    await config.delay(3000);

    console.log('🖱️ Localizando botón "Obter Informe"...');
    const mainFrame = await frameUtils.getStableFrame(page, 'mainFrame');
    
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      console.log(`💬 Alerta detectada: ${alertMessage}`);
      await dialog.accept();
    });
    
    await mainFrame.waitForSelector('#BotonObterInforme', { 
      timeout: 30000,
      visible: true 
    });
    await mainFrame.click('#BotonObterInforme');
    console.log('✅ Botón "Obter Informe" presionado');
    
    console.log('🔄 Esperando a que se complete la generación del informe...');
    try {
      await mainFrame.waitForSelector('#loaderOverlay', { 
        hidden: true, 
        timeout: 120000 
      });
      console.log('✅ Generación de informe completada');
    } catch (e) {
      console.log('⚠️ No se detectó spinner, continuando...');
      await config.delay(5000);
    }

    console.log('🖱️ Localizando botón "Ir ó Buzón"...');
    
    let buttonFound = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await mainFrame.waitForSelector('#BotonIrBuzon', {
          timeout: 30000,
          visible: true
        });
        buttonFound = true;
        break;
      } catch (e) {
        console.log(`⚠️ Intento ${attempt}/3 fallido, reintentando...`);
        await config.delay(3000);
      }
    }
    
    if (!buttonFound) {
      throw new Error('No se encontró el botón "Ir ó Buzón" después de 3 intentos');
    }
    
    console.log('🖱️ Haciendo clic en el botón...');
    
    const button = await mainFrame.$('#BotonIrBuzon');
    await button.evaluate(b => b.scrollIntoView({block: 'center'}));
    await button.click({delay: 200});
    
    const currentPages = await browserInstance.pages();
    const currentPageIds = currentPages.map(p => p.target()._targetId);
    
    const browserContext = browserInstance.defaultBrowserContext();
    
    console.log('✅ Botón "Ir ó Buzón" presionado');

    console.log('🔄 Esperando nueva pestaña...');
    let downloadPage = null;
    const startTime = Date.now();
    const timeout = 30000;
    
    while (Date.now() - startTime < timeout && !downloadPage) {
      const newTarget = await new Promise(resolve => {
        const handler = target => {
          if (target.type() === 'page') {
            browserContext.removeListener('targetcreated', handler);
            resolve(target);
          }
        };
        browserContext.on('targetcreated', handler);
        setTimeout(() => resolve(null), 1000);
      });
      
      if (newTarget) {
        downloadPage = await newTarget.page();
        console.log('🎯 Nueva pestaña detectada mediante evento targetcreated');
      }
      
      if (!downloadPage) {
        const allPages = await browserInstance.pages();
        for (const aPage of allPages) {
          const pageId = aPage.target()._targetId;
          if (!currentPageIds.includes(pageId)) {
            downloadPage = aPage;
            console.log('🔍 Pestaña detectada por comparación de IDs');
            break;
          }
        }
      }
      
      if (!downloadPage) {
        const allPages = await browserInstance.pages();
        for (const aPage of allPages) {
          try {
            const hasContent = await aPage.evaluate(() => {
              return document.title.includes('Buzón') || 
                     document.querySelector('a[id="accionDescargar"]') !== null;
            }).catch(() => false);
            
            if (hasContent) {
              downloadPage = aPage;
              console.log('🔍 Pestaña detectada por contenido específico');
              break;
            }
          } catch (e) {}
        }
      }
      
      if (!downloadPage) {
        const allPages = await browserInstance.pages();
        for (const aPage of allPages) {
          const pageUrl = aPage.url();
          if (pageUrl.includes('buzon') || pageUrl.includes('informes')) {
            downloadPage = aPage;
            console.log('🌐 Pestaña detectada por URL:', pageUrl);
            break;
          }
        }
      }
      
      if (!downloadPage) {
        await config.delay(1000);
      }
    }
    
    if (!downloadPage) {
      const allPages = await browserInstance.pages();
      console.error('❌ No se pudo detectar la pestaña de descargas');
      console.log('📋 Páginas disponibles:');
      allPages.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.url()} ${p === page ? '(original)' : ''}`);
      });
      throw new Error('No se pudo detectar la pestaña de descargas después de 30 segundos');
    }
    
    await downloadPage.bringToFront();
    
    // 9. Obtener lista de informes disponibles
    console.log('🔍 Buscando tabla de informes...');
    
    // CORRECCIÓN: Cambiar selector a #fila
    await downloadPage.waitForSelector('#fila', { 
      timeout: 120000,
      visible: true 
    });
    console.log('✅ Tabla de informes encontrada');

    // Extraer información de los informes
    const informes = await downloadPage.evaluate(() => {
      const table = document.querySelector('#fila');
      if (!table) throw new Error('Tabla de informes no encontrada');
      
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      return rows.map((row, index) => {
        const celdas = row.querySelectorAll('td');
        const nombre = celdas[1]?.textContent.trim() || `Informe ${index + 1}`;
        const fecha = celdas[4]?.textContent.trim() || '';
        
        // Buscar enlace de descarga en la última celda
        const lastCell = celdas[celdas.length - 1];
        const descargarBtn = lastCell.querySelector('a[id="accionDescargar"]');
        const url = descargarBtn ? descargarBtn.href.replace(/\s/g, '') : '';
        
        return {
          numero: index + 1,
          nombre,
          fecha,
          url
        };
      });
    });

    console.log('\n📋 Informes disponibles:');
    console.log('========================');
    informes.forEach(informe => {
      console.log(` ${informe.numero}. ${informe.nombre} (${informe.fecha})`);
    });
    console.log('========================\n');

    let seleccionInforme = null;
    while (!seleccionInforme) {
      const respuesta = await askQuestion('Seleccione un informe por número (o "0" para salir): ');
      const numero = parseInt(respuesta);
      
      if (numero === 0) {
        console.log('🚫 Operación cancelada por el usuario');
        return;
      }
      
      if (isNaN(numero)) {
        console.log('❌ Por favor ingrese un número válido');
        continue;
      }
      
      seleccionInforme = informes.find(i => i.numero === numero);
      
      if (!seleccionInforme) {
        console.log(`❌ No existe un informe con el número ${numero}`);
      }
    }

    console.log(`✅ Seleccionado informe: ${seleccionInforme.nombre}`);
    console.log('🔗 URL de descarga:', seleccionInforme.url || 'No disponible');

    if (!seleccionInforme.url) {
      throw new Error('No se encontró URL de descarga para el informe seleccionado');
    }

    console.log('⬇️ Iniciando descarga directa...');
    const parsedUrl = new URL(seleccionInforme.url);
    const fileName = `informe_${seleccionInforme.numero}_${Date.now()}${path.extname(parsedUrl.pathname) || '.xlsx'}`;
    const filePath = path.join(config.DOWNLOAD_DIR, fileName);
    
    const cookies = await downloadPage.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    const response = await axios({
      url: seleccionInforme.url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        Cookie: cookieHeader,
        Referer: downloadPage.url(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      timeout: 120000
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`📁 Descarga completada: ${fileName}`);
    console.log(`📍 Ubicación: ${filePath}`);
    
    const stats = fs.statSync(filePath);
    console.log(`📏 Tamaño: ${(stats.size / 1024).toFixed(2)} KB`);
    
    console.log('🎉 Proceso completado con éxito');

  } catch (error) {
    console.error(`❌ Error crítico: ${error.message}`);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    let framesInfo = [];
    if (page) {
      try {
        framesInfo = page.frames().map(f => ({
          name: f.name(),
          url: f.url(),
          isDetached: f.isDetached()
        }));
      } catch (frameError) {
        console.error('Error obteniendo frames:', frameError.message);
      }
    }
    
    const debugData = {
      error: error.stack,
      time: timestamp,
      pageUrl: page?.url(),
      frames: framesInfo,
      downloads: fs.existsSync(config.DOWNLOAD_DIR) ? 
        fs.readdirSync(config.DOWNLOAD_DIR) : []
    };

    fs.writeFileSync(`debug-${timestamp}.json`, JSON.stringify(debugData, null, 2));
    
    if (browserInstance) {
      try {
        const pages = await browserInstance.pages();
        console.log('📋 Páginas disponibles:');
        
        for (const [i, p] of pages.entries()) {
          console.log(`  ${i + 1}. ${p.url()} ${p === page ? '(main)' : ''}`);
          
          try {
            const screenshotPath = `error-page-${i}-${timestamp}.png`;
            await p.screenshot({
              path: screenshotPath,
              fullPage: true
            });
            console.log(`  📷 Captura de página ${i} guardada: ${screenshotPath}`);
            
            const htmlPath = `error-page-${i}-${timestamp}.html`;
            const htmlContent = await p.content();
            fs.writeFileSync(htmlPath, htmlContent);
            console.log(`  📄 HTML de página ${i} guardado: ${htmlPath}`);
            
            const frames = p.frames();
            for (const [j, frame] of frames.entries()) {
              try {
                const frameContent = await frame.content();
                const framePath = `error-page-${i}-frame-${j}-${timestamp}.html`;
                fs.writeFileSync(framePath, frameContent);
                console.log(`    📄 HTML del frame ${j} guardado: ${framePath}`);
              } catch (frameError) {
                console.error(`    ❌ Frame ${j}: ${frameError.message}`);
              }
            }
          } catch (screenshotError) {
            console.error(`  ❌ Error capturando página ${i}: ${screenshotError.message}`);
          }
        }
      } catch (diagnosticError) {
        console.error('Error en diagnóstico:', diagnosticError.message);
      }
    }

  } finally {
    console.log('🧹 Finalizando...');
    rl.close();
    
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (closeError) {
        console.error('❌ Error al cerrar el navegador:', closeError.message);
      }
    }
  }
})();
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SIBERIA',
    icon: path.join(__dirname, 'turkish-angora_141876.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
  win.setTitle('SIBERIA');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

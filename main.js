const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let mainWindow = null;
let dataFolder = null;
let configFile = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    if (fs.existsSync(configFile)) {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      if (cfg.dataFolder && fs.existsSync(cfg.dataFolder)) return cfg.dataFolder;
    }
  } catch (e) {}
  return null;
}

function saveConfig(folder) {
  try { fs.writeFileSync(configFile, JSON.stringify({ dataFolder: folder }), 'utf-8'); } catch (e) {}
}

async function pickFolderBlocking() {
  const result = await dialog.showOpenDialog({
    title: 'Chon thu muc luu tru du lieu (bat buoc)',
    message: 'Vui long chon 1 thu muc de luu du lieu phan mem.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Chon thu muc nay'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

async function ensureDataFolder() {
  let folder = loadConfig();
  while (!folder) {
    folder = await pickFolderBlocking();
    if (!folder) {
      const again = await dialog.showMessageBox({
        type: 'warning',
        title: 'Bat buoc chon thu muc',
        message: 'Ban phai chon 1 thu muc de luu du lieu. Neu khong, du lieu co the bi mat.',
        buttons: ['Chon lai', 'Thoat phan mem'],
        defaultId: 0, cancelId: 1
      });
      if (again.response === 1) { app.quit(); return null; }
    }
  }
  saveConfig(folder);
  return folder;
}

function dataFilePath() { return path.join(dataFolder, 'lici-data.json'); }

function loadDataFromFolder() {
  try {
    if (fs.existsSync(dataFilePath())) return JSON.parse(fs.readFileSync(dataFilePath(), 'utf-8'));
  } catch (e) {}
  return null;
}

function saveDataToFolder() {
  if (!mainWindow || !dataFolder) return;
  mainWindow.webContents.executeJavaScript(
    'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))'
  ).then(jsonStr => {
    try { fs.writeFileSync(dataFilePath(), jsonStr, 'utf-8'); } catch (e) {}
  }).catch(() => {});
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Tu Bep Inox LICI - v13.1',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition: 'persist:lici'
    }
  });

  mainWindow.setMenuBarVisibility(false);

  // Load file HTML - thử nhiều đường dẫn để chắc chắn
  const possiblePaths = [
    path.join(__dirname, 'app', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(process.resourcesPath, 'app', 'app', 'index.html'),
    path.join(process.resourcesPath, 'app', 'index.html')
  ];

  let loaded = false;
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        await mainWindow.loadFile(p);
        loaded = true;
        console.log('Loaded HTML from:', p);
        break;
      }
    } catch (e) { console.error('Failed path:', p, e); }
  }

  if (!loaded) {
    console.error('KHONG TIM THAY index.html. Cac duong da thu:', possiblePaths);
    mainWindow.loadURL('data:text/html,<h1 style="font-family:sans-serif;padding:40px;color:#c62828">KHÔNG TÌM THẤY FILE index.html<br><br>Vui lòng kiểm tra file đã upload lên GitHub chưa.</h1>');
  }

  const folderData = loadDataFromFolder();
  mainWindow.webContents.on('did-finish-load', async () => {
    if (folderData && Object.keys(folderData).length) {
      const script = `(function(){ const data = ${JSON.stringify(folderData)}; Object.entries(data).forEach(([k,v])=>{ try{ localStorage.setItem(k,v); }catch(e){} }); })();`;
      try { await mainWindow.webContents.executeJavaScript(script); } catch (e) {}
    }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', () => { saveDataToFolder(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  setInterval(saveDataToFolder, 45000);
}

app.whenReady().then(async () => {
  configFile = getConfigPath();
  dataFolder = await ensureDataFolder();
  if (!dataFolder) return;
  createWindow();
});

app.on('window-all-closed', () => {
  saveDataToFolder();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-folder', () => dataFolder);
ipcMain.handle('change-folder', async () => {
  const folder = await pickFolderBlocking();
  if (folder) { dataFolder = folder; saveConfig(folder); }
  return dataFolder;
});
ipcMain.handle('open-folder', () => { if (dataFolder) shell.openPath(dataFolder); return true; });
ipcMain.handle('save-now', () => { saveDataToFolder(); return true; });

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let dataFolder = null;
let configFile = null;

// ============ CONFIG ============
function getConfigPath() {
  return path.join(app.getPath('userData'), 'lici-config.json');
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

// ============ CHỌN THƯ MỤC LƯU ============
async function pickFolderBlocking() {
  const result = await dialog.showOpenDialog({
    title: 'CHỌN THƯ MỤC LƯU DỮ LIỆU (BẮT BUỘC)',
    message: 'Vui lòng chọn 1 thư mục để lưu dữ liệu. Phần mềm sẽ tự động sao lưu vào đây.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Chọn thư mục này'
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
        title: 'BẮT BUỘC CHỌN THƯ MỤC',
        message: 'Bạn phải chọn 1 thư mục để lưu dữ liệu. Nếu không, dữ liệu sẽ bị mất khi đóng phần mềm.',
        buttons: ['Chọn lại', 'Thoát phần mềm'],
        defaultId: 0,
        cancelId: 1
      });
      if (again.response === 1) { app.quit(); return null; }
    }
  }
  saveConfig(folder);
  return folder;
}

// ============ ĐỌC / GHI DỮ LIỆU ============
function dataFilePath() { return path.join(dataFolder, 'lici-data.json'); }

function loadDataFromFolder() {
  try {
    if (fs.existsSync(dataFilePath())) {
      return JSON.parse(fs.readFileSync(dataFilePath(), 'utf-8'));
    }
  } catch (e) { console.error('Loi doc du lieu:', e); }
  return null;
}

function saveDataToFolder() {
  if (!mainWindow || !dataFolder) return;
  mainWindow.webContents.executeJavaScript(
    'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))'
  ).then(jsonStr => {
    try {
      fs.writeFileSync(dataFilePath(), jsonStr, 'utf-8');
      console.log('Da luu du lieu vao:', dataFilePath());
    } catch (e) { console.error('Loi ghi du lieu:', e); }
  }).catch(() => {});
}

// ============ TÌM FILE HTML ============
function findIndexHtml() {
  const candidates = [
    path.join(__dirname, 'app', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(process.resourcesPath, 'app', 'app', 'index.html'),
    path.join(process.resourcesPath, 'app', 'index.html'),
    path.join(process.resourcesPath, 'index.html')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

// ============ TẠO CỬA SỔ ============
async function createWindow() {
  // Cấp quyền localStorage cho file://
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob: file:"]
      }
    });
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Tủ Bếp Inox LICI - v13.1',
    show: false,
    backgroundColor: '#eef2f6',
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

  // Tìm và load file HTML
  const htmlPath = findIndexHtml();
  if (htmlPath) {
    console.log('Da tim thay HTML tai:', htmlPath);
    await mainWindow.loadFile(htmlPath);
  } else {
    console.error('KHONG TIM THAY index.html!');
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <html><head><meta charset="utf-8"></head><body style="font-family:Arial;padding:40px;background:#fff3e0">
      <h1 style="color:#c62828">❌ KHÔNG TÌM THẤY FILE index.html</h1>
      <p style="font-size:16px;line-height:1.8">File <b>index.html</b> chưa được upload lên GitHub đúng vị trí.</p>
      <p style="font-size:16px;line-height:1.8">Vui lòng kiểm tra:</p>
      <ol style="font-size:16px;line-height:1.8">
        <li>Vào GitHub repo của bạn</li>
        <li>Kiểm tra có thư mục <b>app/</b> với file <b>index.html</b> bên trong chưa</li>
        <li>Nếu chưa có → dùng "Add file" → "Upload files" để upload file demo15.html (đổi tên thành index.html)</li>
      </ol>
      </body></html>
    `));
  }

  // Nạp dữ liệu từ thư mục vào localStorage sau khi load xong HTML
  const folderData = loadDataFromFolder();
  mainWindow.webContents.on('did-finish-load', async () => {
    if (folderData && Object.keys(folderData).length) {
      const script = `
        (function(){
          const data = ${JSON.stringify(folderData)};
          let count = 0;
          Object.entries(data).forEach(([k,v])=>{
            try { localStorage.setItem(k, v); count++; } catch(e){}
          });
          console.log('Da nap', count, 'muc du lieu tu thu muc');
        })();
      `;
      try { await mainWindow.webContents.executeJavaScript(script); } catch (e) { console.error(e); }
    }
    mainWindow.show();
  });

  // Mở link ngoài bằng trình duyệt mặc định
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Lưu khi đóng app
  mainWindow.on('close', () => saveDataToFolder());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Tự động sao lưu mỗi 45 giây
  setInterval(saveDataToFolder, 45000);
}

// ============ KHỞI ĐỘNG ============
app.whenReady().then(async () => {
  configFile = getConfigPath();
  dataFolder = await ensureDataFolder();
  if (!dataFolder) return;
  console.log('Thu muc du lieu:', dataFolder);
  createWindow();
});

app.on('window-all-closed', () => {
  saveDataToFolder();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ============ IPC ============
ipcMain.handle('get-folder', () => dataFolder);
ipcMain.handle('change-folder', async () => {
  const folder = await pickFolderBlocking();
  if (folder) { dataFolder = folder; saveConfig(folder); }
  return dataFolder;
});
ipcMain.handle('open-folder', () => { if (dataFolder) shell.openPath(dataFolder); return true; });
ipcMain.handle('save-now', () => { saveDataToFolder(); return true; });

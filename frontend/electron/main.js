const { app, BrowserWindow, ipcMain, desktopCapturer, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let isMonitoring = false;
let monitorInterval = null;
let detectedMeetingId = null;

const isDev = !app.isPackaged;

// Ignore certificate errors in development
if (isDev) {
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, 'icon.png'),
    });

    const url = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, '../out/index.html')}`;

    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Hide window instead of quitting when closed (to stay in tray)
    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    // Create a simple tray icon (16x16 is standard for macOS menu bar)
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow?.show() },
        { label: 'Start Monitoring', click: () => startMonitoring() },
        { label: 'Stop Monitoring', click: () => stopMonitoring() },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        },
    ]);

    tray.setToolTip('Operation One - Meeting Recorder');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        mainWindow?.show();
    });
}

async function checkForMeetings() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 0, height: 0 } // Skip thumbnails for performance
        });

        const meetingKeywords = ['Meet -', 'Google Meet', 'meet.google.com'];

        const meetingWindow = sources.find(source =>
            meetingKeywords.some(keyword =>
                source.name.toLowerCase().includes(keyword.toLowerCase())
            )
        );

        if (meetingWindow && meetingWindow.id !== detectedMeetingId) {
            detectedMeetingId = meetingWindow.id;

            // Show notification
            new Notification({
                title: 'Meeting Detected',
                body: `Found: ${meetingWindow.name}. Click to start recording.`,
                silent: false,
            }).show();

            // Send to renderer if window exists
            if (mainWindow) {
                mainWindow.webContents.send('MEETING_DETECTED', {
                    id: meetingWindow.id,
                    name: meetingWindow.name,
                });
                mainWindow.show();
            }
        } else if (!meetingWindow) {
            detectedMeetingId = null;
        }
    } catch (error) {
        console.error('Error checking for meetings:', error);
    }
}

function startMonitoring() {
    if (isMonitoring) return;

    isMonitoring = true;
    console.log('Started monitoring for meetings...');

    // Check immediately, then every 5 seconds
    checkForMeetings();
    monitorInterval = setInterval(checkForMeetings, 5000);
}

function stopMonitoring() {
    if (!isMonitoring) return;

    isMonitoring = false;
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    console.log('Stopped monitoring for meetings.');
}

// IPC Handlers
ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 }
    });
    return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
    }));
});

ipcMain.handle('start-monitoring', () => {
    startMonitoring();
    return { success: true };
});

ipcMain.handle('stop-monitoring', () => {
    stopMonitoring();
    return { success: true };
});

// Save recording to local filesystem
ipcMain.handle('save-recording', async (event, { buffer, filename }) => {
    const os = require('os');
    const fs = require('fs');

    // Create recordings directory in Documents
    const recordingsDir = path.join(os.homedir(), 'Documents', 'OperationOneRecordings');

    if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
    }

    // Generate unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalFilename = filename || `recording-${timestamp}.webm`;
    const filePath = path.join(recordingsDir, finalFilename);

    // Write the buffer to file
    fs.writeFileSync(filePath, Buffer.from(buffer));

    return { success: true, filePath };
});

// App lifecycle
app.whenReady().then(() => {
    createWindow();
    createTray();
    startMonitoring(); // Auto-start monitoring

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow?.show();
        }
    });
});

app.on('window-all-closed', () => {
    // On macOS, keep app running in tray
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMonitoring();
});

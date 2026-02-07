const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Get available windows/screens for recording
    getSources: () => ipcRenderer.invoke('get-sources'),

    // Monitoring controls
    startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
    stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),

    // Save recording to local filesystem
    saveRecording: (buffer, filename) => ipcRenderer.invoke('save-recording', { buffer, filename }),

    // Listen for meeting detection events
    onMeetingDetected: (callback) => {
        ipcRenderer.on('MEETING_DETECTED', (event, data) => callback(data));
    },

    // Remove listener
    removeMeetingListener: () => {
        ipcRenderer.removeAllListeners('MEETING_DETECTED');
    },
});

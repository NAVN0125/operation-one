// Type definitions for Electron API exposed via preload

export interface ElectronSource {
    id: string;
    name: string;
    thumbnail: string;
}

export interface MeetingData {
    id: string;
    name: string;
}

export interface ElectronAPI {
    getSources: () => Promise<ElectronSource[]>;
    startMonitoring: () => Promise<{ success: boolean }>;
    stopMonitoring: () => Promise<{ success: boolean }>;
    saveRecording: (buffer: ArrayBuffer, filename?: string) => Promise<{ success: boolean; filePath: string }>;
    onMeetingDetected: (callback: (data: MeetingData) => void) => void;
    removeMeetingListener: () => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };

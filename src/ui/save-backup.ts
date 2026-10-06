import { APP_NAME } from '../core/state/app-state';
import {
  backupFileName,
  createBackup,
  describeBackup,
  summarizeBackup,
} from '../core/state/backup';

/**
 * Makes a backup of what the app keeps in this browser (UI-06) and hands it to the browser to
 * save. Returns what is in it ("the settings, 2 presets and …").
 */
export async function saveBackup(analysis: boolean): Promise<string> {
  const backup = await createBackup({ analysis });
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName(APP_NAME, new Date());
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return describeBackup(summarizeBackup(backup));
}

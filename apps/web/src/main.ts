import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { Radar } from './app/radar';
import { watchForNewVersion } from './app/update-check';
import { checkUiFontWeights } from './app/ui-font';

bootstrapApplication(Radar, appConfig)
  .catch((err) => console.error(err));

watchForNewVersion();
void checkUiFontWeights().catch(() => undefined);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

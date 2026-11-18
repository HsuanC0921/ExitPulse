import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { Radar } from './app/radar';

bootstrapApplication(Radar, appConfig)
  .catch((err) => console.error(err));

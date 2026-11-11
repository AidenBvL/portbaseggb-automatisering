/* Ingang voor de bundel: maakt extract() beschikbaar als self.GGB_AI_CLIENT in de service worker. */
import { extract, STANDAARD_MODEL } from './extract.mjs';

self.GGB_AI_CLIENT = { extract, STANDAARD_MODEL };

/* Ingang voor de bundel: maakt extract() en modellen() beschikbaar als self.GGB_AI_CLIENT in de service worker. */
import { extract, modellen } from './aanbieders.mjs';

self.GGB_AI_CLIENT = { extract, modellen };

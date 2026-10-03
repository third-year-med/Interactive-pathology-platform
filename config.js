/* Front-page settings — public, contains NO secrets.
   backendUrl: the platform backend (Apps Script web app, ends in /exec) that keeps the module list and the
   Cell Injury / Inflammation accounts. Modules on another backend name it in their own "backend" field
   (Teacher Module Portal). descriptions: short text shown on a module's card (a card "note" set in the
   Teacher Module Portal takes precedence). */
window.PORTAL_CONFIG = {
  backendUrl: 'https://script.google.com/macros/s/AKfycbzx0Yg0YAaJ8mAvcHoondUmlS-DtZTjrvnLvcAE-tNSF3McBcV-znF0-S8PV54_XrM/exec',
  title: 'Interactive Pathology Teaching Platform',
  createdBy: 'Created by Dr. Wesam Alzwawy',
  descriptions: {
    cellinjury: 'Cellular adaptations, reversible and irreversible injury, necrosis, apoptosis and intracellular accumulations.',
    inflhealing: 'Acute and chronic inflammation, chemical mediators, tissue repair and wound healing.'
  }
};

'use client';
let registration: Promise<ServiceWorkerRegistration> | null = null;
export function registerPwa(): Promise<ServiceWorkerRegistration> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return Promise.reject(new Error('PWA_UNSUPPORTED'));
  if (!registration) registration = new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PWA_REGISTRATION_TIMEOUT')), 12000);
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(resolve, reject).finally(() => clearTimeout(timer));
  })
    .catch(error => { registration = null; throw error; });
  return registration;
}
export async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await registerPwa();
  if (reg.active) return reg;
  return new Promise((resolve, reject) => {
    const worker = reg.installing ?? reg.waiting;
    if (!worker) { reject(new Error('PWA_NOT_ACTIVE')); return; }
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener('statechange', check); };
    const check = () => {
      if (reg.active) { cleanup(); resolve(reg); }
      else if (worker.state === 'redundant') { cleanup(); reject(new Error('PWA_NOT_ACTIVE')); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('PWA_NOT_ACTIVE')); }, 12000);
    worker.addEventListener('statechange', check); check();
  });
}

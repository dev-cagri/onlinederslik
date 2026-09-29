import { useEffect, useState } from 'react';

// Site ayarları: yönetim panelinden yüklenen logo (yoksa varsayılan) ve SMS doğrulamasının
// açık olup olmadığı. Tek sefer çekilir, tüm bileşenlerle paylaşılır; panelden değişince güncellenir.
export const DEFAULT_LOGO = '/cyikon.png';

export const DEFAULT_SITE_NAME = 'Online Derslik';

export const DEFAULT_TAGLINE = 'Canlı derslere ve toplantılara tek linkle katılın.';

let state = {
  logoUrl: DEFAULT_LOGO, custom: false, smsEnabled: true, approvalRequired: true,
  siteName: DEFAULT_SITE_NAME, tagline: DEFAULT_TAGLINE, brandColor: null, loaded: false,
};

// Ana renk: #RRGGBB → düğmeler/paneller için CSS değişkenleri. Açık renkte yazı koyu olur.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, target, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t = target === 'white' ? 255 : 0;
  const c = [r, g, b].map((v) => Math.round(v + (t - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export function isLightColor(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}
function applyBrandColor(color) {
  const root = document.documentElement.style;
  const vars = ['--primary', '--primary-fg', '--brand-ink', '--brand-ink-2'];
  if (!color) { vars.forEach((v) => root.removeProperty(v)); return; }
  root.setProperty('--primary', color);
  root.setProperty('--primary-fg', isLightColor(color) ? '#09090b' : '#ffffff');
  // Ana sayfa paneli: seçilen rengin koyu tonu ve ondan biraz açığı (degrade)
  root.setProperty('--brand-ink', mix(color, 'black', 0.25));
  root.setProperty('--brand-ink-2', mix(color, 'black', 0.05));
}
let request = null;
const listeners = new Set();

function update(patch) {
  state = { ...state, ...patch, loaded: true };
  if ('brandColor' in patch) applyBrandColor(state.brandColor);
  // iOS "Ana ekrana ekle" adı
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', state.siteName);
  // Yüklenen logo sekme ikonu da olur
  const icon = document.querySelector('link[rel="icon"]');
  if (icon && state.custom) {
    icon.setAttribute('href', state.logoUrl);
    icon.removeAttribute('type');
  }
  listeners.forEach((fn) => fn(state));
}

function load() {
  request ??= fetch('/api/branding')
    .then((r) => r.json())
    .then((d) => update({
      logoUrl: d.logoUrl || DEFAULT_LOGO,
      custom: !!d.logoUrl,
      smsEnabled: d.smsEnabled !== false,
      approvalRequired: d.approvalRequired !== false,
      siteName: d.siteName || DEFAULT_SITE_NAME,
      tagline: d.tagline || DEFAULT_TAGLINE,
      brandColor: d.brandColor || null,
    }))
    .catch(() => update({}));
  return request;
}

export const setBrandingLogo = (logoUrl) => update({ logoUrl: logoUrl || DEFAULT_LOGO, custom: !!logoUrl });
export const setSmsEnabled = (smsEnabled) => update({ smsEnabled });
export const setSiteName = (siteName) => update({ siteName });
export const setApprovalRequired = (approvalRequired) => update({ approvalRequired });
export const setAppearance = ({ siteName, tagline, brandColor }) => update({
  siteName: siteName || DEFAULT_SITE_NAME,
  tagline: tagline || DEFAULT_TAGLINE,
  brandColor: brandColor || null,
});

// Sekme başlığı: "Sayfa · Site adı" ya da yalnız site adı
export function useDocumentTitle(page) {
  const { siteName } = useBranding();
  useEffect(() => {
    document.title = page ? `${page} · ${siteName}` : siteName;
  }, [page, siteName]);
}

// loaded false iken logo gösterilmez; varsayılan logo bir an görünüp değişmesin
export function useBranding() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    load();
    return () => listeners.delete(setValue);
  }, []);
  return value;
}

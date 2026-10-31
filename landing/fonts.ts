// Fonts load as separate files: @font-face in the CSS gets inlined as base64 by the Tailwind
// plugin, which would make the stylesheet ~270 KB and block the first paint. Latin subset only.
import archivo from '../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2';
import mono from '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2';

const faces = [
  new FontFace('Archivo Variable', `url(${archivo}) format('woff2')`, {
    weight: '100 900',
    stretch: '62% 125%',
    display: 'swap',
  }),
  new FontFace('JetBrains Mono Variable', `url(${mono}) format('woff2')`, {
    weight: '100 800',
    display: 'swap',
  }),
];
for (const face of faces) {
  document.fonts.add(face);
  face.load().catch(() => {});
}

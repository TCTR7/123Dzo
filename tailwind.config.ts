import type { Config } from 'tailwindcss';
const config: Config = {
  darkMode: 'class',
  content: ['./src/pages/**/*.{js,ts,jsx,tsx,mdx}', './src/components/**/*.{js,ts,jsx,tsx,mdx}', './src/app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: { colors: { soft: '#edf2ef', surface: '#f3f6f2', muted: '#e2eae4', line: '#cbd8ce', ink: '#223d35', 'muted-ink': '#52685f' }, boxShadow: { neu: '7px 7px 18px #ced8d0, -7px -7px 18px #ffffff', inset: 'inset 3px 3px 7px #d0dbd3, inset -3px -3px 7px #ffffff' } } },
  plugins: [],
};
export default config;

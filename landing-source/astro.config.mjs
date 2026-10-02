import { defineConfig } from 'astro/config';
import hackathonDevelopmentApi from './src/hackathon/development.mjs';
// Vite's default CSS target (Safari 16.4 / Chrome 111) lets the minifier rewrite media queries
// into range syntax and drop -webkit- prefixes, which iOS 15-16.3 and older Chrome/Edge ignore.
const cssTarget = ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'];
export default defineConfig({site:'https://namat.health',output:'static',trailingSlash:'always',integrations:[hackathonDevelopmentApi],vite:{build:{cssTarget}}});

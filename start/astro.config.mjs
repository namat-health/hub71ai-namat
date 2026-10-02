import {defineConfig} from 'astro/config';
import hackathonDevelopmentApi from './src/hackathon/development.mjs';

export default defineConfig({
  site:'https://start.namat.health', output:'static', trailingSlash:'always',
  integrations:[hackathonDevelopmentApi],
  vite:{build:{cssTarget:['safari15','ios15','chrome100','edge100','firefox100']}},
});

import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',fs:{allow:['/workspace/ai-pixel-office','/workspace/pixel-agents-p0']}},build:{target:'es2022'}});

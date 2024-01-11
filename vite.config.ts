import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dynamic_party } from './src/partytown';
import Inspect from 'vite-plugin-inspect';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react(), dynamic_party(), Inspect()],
	esbuild: {},
});

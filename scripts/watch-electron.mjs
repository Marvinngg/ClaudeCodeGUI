import { context } from 'esbuild';

async function watch() {
    const ctx = await context({
        entryPoints: ['electron/main.ts', 'electron/preload.ts'],
        bundle: true,
        platform: 'node',
        target: 'node18',
        external: ['electron'],
        sourcemap: true,
        outdir: 'dist-electron',
    });

    await ctx.watch();
    console.log('Watching Electron files...');
}

watch().catch(console.error);

import type { MetadataRoute } from 'next';
import { config } from '@/server/config';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: config.appName,
        short_name: config.appName,
        description: 'Quadros, listas e cards para organizar o trabalho do time.',
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#15191C',
        theme_color: '#1E2327',
        icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
    };
}

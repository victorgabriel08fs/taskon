import { ImageResponse } from 'next/og';

export const alt = 'Raia · Cada tarefa na sua raia.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SYMBOL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2F363C"/><rect x="14" y="16" width="10" height="32" rx="3" fill="#C6F135"/><rect x="27" y="16" width="10" height="22" rx="3" fill="#F4F5F0"/><rect x="40" y="16" width="10" height="12" rx="3" fill="#F4F5F0" fill-opacity="0.5"/></svg>`;

const NAME = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -7 177 72"><g fill="none" stroke="#F4F5F0" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20 V60"/><path d="M9 39 C9 27 17 20 28 20 H31"/><circle cx="69" cy="40" r="20"/><path d="M89 20 V60"/><path d="M109 20 V60"/><circle cx="147" cy="40" r="20"/><path d="M167 20 V60"/></g><circle cx="109" cy="0" r="6" fill="#C6F135"/></svg>`;

const svg = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;

/** Imagem de compartilhamento: logotipo da Raia e o slogan, sobre o grafite. */
export default function OpenGraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    padding: '0 96px',
                    gap: 48,
                    background: '#15191C',
                    color: '#F4F5F0',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 40 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={svg(SYMBOL)} width={160} height={160} alt="" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={svg(NAME)} width={295} height={120} alt="" style={{ marginBottom: 40 }} />
                </div>
                <div style={{ fontSize: 56, fontWeight: 600, letterSpacing: '-0.02em' }}>Cada tarefa na sua raia.</div>
            </div>
        ),
        size,
    );
}

/**
 * Um nome curto para o aparelho, tirado do User-Agent ("Chrome no Windows",
 * "Safari no iPhone") — o nome que a passkey ganha quando a pessoa não dá
 * um. Não é detecção de navegador para decidir comportamento: só um rótulo
 * que a pessoa reconheça na lista, e que ela pode trocar.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
    if (!userAgent) return null;

    const device = /iPhone/.test(userAgent)
        ? 'iPhone'
        : /iPad/.test(userAgent)
          ? 'iPad'
          : /Android/.test(userAgent)
            ? 'Android'
            : /Windows/.test(userAgent)
              ? 'Windows'
              : /Mac OS X|Macintosh/.test(userAgent)
                ? 'Mac'
                : /CrOS/.test(userAgent)
                  ? 'Chromebook'
                  : /Linux/.test(userAgent)
                    ? 'Linux'
                    : null;

    // A ordem importa: o Edge e o Opera também dizem "Chrome/", e o Chrome
    // também diz "Safari/".
    const browser = /Edg(A|iOS)?\//.test(userAgent)
        ? 'Edge'
        : /OPR\//.test(userAgent)
          ? 'Opera'
          : /SamsungBrowser\//.test(userAgent)
            ? 'Samsung Internet'
            : /Firefox\/|FxiOS\//.test(userAgent)
              ? 'Firefox'
              : /Chrome\/|CriOS\//.test(userAgent)
                ? 'Chrome'
                : /Safari\//.test(userAgent)
                  ? 'Safari'
                  : null;

    if (browser && device) return `${browser} no ${device}`;

    return browser ?? device;
}

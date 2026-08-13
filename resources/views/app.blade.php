<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" @class(['dark' => ($appearance ?? 'system') === 'dark'])>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    {{-- Aplica o tema antes do primeiro paint para não haver flash de cor errada. --}}
    <script>
        (function () {
            const appearance = '{{ $appearance ?? "system" }}';

            if (appearance === 'system') {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.classList.toggle('dark', prefersDark);
            }
        })();
    </script>

    <style>
        html { background-color: oklch(98.5% 0.002 247.839); }
        html.dark { background-color: oklch(16% 0.02 265); }
    </style>

    <title inertia>{{ config('app.name', 'Taskon') }}</title>

    <link rel="icon" href="/favicon.svg" type="image/svg+xml">

    @viteReactRefresh
    @vite(['resources/js/app.tsx', "resources/js/pages/{$page['component']}.tsx"])
    @inertiaHead
</head>
<body class="font-sans antialiased">
    @inertia
</body>
</html>

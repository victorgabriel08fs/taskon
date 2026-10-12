import { z } from 'zod';
import type { FieldErrors } from '@/types';
import { parseAppDateTime } from '@/lib/timezone';

// Mensagens genéricas (as que nenhum helper abaixo personaliza) em português.
z.config(z.locales.pt());

/**
 * Regras de validação com a semântica do Laravel, que o frontend já conhece:
 *
 *  - toda string chega aparada (TrimStrings) e a vazia vira null
 *    (ConvertEmptyStringsToNull) — "  " num campo obrigatório é "vazio";
 *  - `max:N` conta caracteres, não bytes nem unidades UTF-16;
 *  - campo "sometimes" é `.optional()`: ausente não é validado nem gravado.
 */

const length = (value: string) => [...value].length;

/** Apara e converte "" em null — o par de middlewares globais do Laravel. */
const normalize = (value: unknown) => {
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();

    return trimmed === '' ? null : trimmed;
};

export const messages = {
    required: 'Preencha este campo.',
    max: (max: number) => `Use no máximo ${max} caracteres.`,
    email: 'Informe um e-mail válido.',
    passwordMin: 'A senha precisa ter pelo menos 8 caracteres.',
    passwordConfirmation: 'As senhas não conferem.',
    in: 'Escolha uma das opções oferecidas.',
    date: 'Informe uma data válida.',
} as const;

/** Texto obrigatório: aparado, não vazio, até `max` caracteres. */
export function requiredString(max: number) {
    return z.preprocess(
        normalize,
        z
            .string({ error: messages.required })
            .refine((value) => length(value) <= max, { error: messages.max(max) }),
    );
}

/** Texto opcional: aparado; vazio vira null; até `max` caracteres. */
export function nullableString(max: number) {
    return z.preprocess(
        normalize,
        z
            .string()
            .refine((value) => length(value) <= max, { error: messages.max(max) })
            .nullable(),
    );
}

/** E-mail obrigatório, sempre em minúsculas (o Postgres compara com caixa). */
export function email(max = 255) {
    return z.preprocess(
        (value) => {
            const normalized = normalize(value);

            return typeof normalized === 'string' ? normalized.toLowerCase() : normalized;
        },
        z
            .string({ error: messages.required })
            .refine((value) => length(value) <= max, { error: messages.max(max) })
            .pipe(z.email({ error: messages.email })),
    );
}

/** Um valor de uma lista fechada (o `Rule::in` do Laravel). */
export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
    return z.preprocess(normalize, z.enum(values, { error: messages.in }));
}

/** Senha nova: obrigatória, mínimo 8 (o `Password::defaults()` do Laravel). */
export function newPassword() {
    return z
        .string({ error: messages.required })
        .min(1, { error: messages.required })
        .min(8, { error: messages.passwordMin })
        .max(255, { error: messages.max(255) });
}

/** Senha digitada para conferência (login, senha atual) — sem aparar. */
export function passwordInput() {
    return z.string({ error: messages.required }).min(1, { error: messages.required });
}

/**
 * O `confirmed` do Laravel: exige `password_confirmation` igual a `password`.
 * Aplique no objeto inteiro.
 */
export function confirmed<T extends { password: string; password_confirmation?: string | null }>(data: T, ctx: z.RefinementCtx) {
    if (data.password !== (data.password_confirmation ?? '')) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: messages.passwordConfirmation });
    }
}

/** Teto do `integer` do Postgres: id maior que isso nem pode existir. */
export const MAX_ID = 2_147_483_647;

/**
 * Id numérico vindo do cliente (rota/payload). Acima do teto do `integer` a
 * consulta quebraria no banco (500) em vez de virar 422.
 */
export function id() {
    return z
        .number({ error: 'Identificador inválido.' })
        .int({ error: 'Identificador inválido.' })
        .positive({ error: 'Identificador inválido.' })
        .max(MAX_ID, { error: 'Identificador inválido.' });
}

/**
 * Data opcional no formato do `<input type="datetime-local">` (sem fuso, lida
 * no fuso do app) ou ISO com fuso. "" e null desligam o prazo.
 */
export function nullableDateTime() {
    return z.preprocess(
        normalize,
        z
            .string()
            .nullable()
            .transform((value, ctx) => {
                if (value === null) return null;

                const date = parseAppDateTime(value);

                if (!date) {
                    ctx.addIssue({ code: 'custom', message: messages.date });

                    return z.NEVER;
                }

                return date;
            }),
    );
}

/** Primeira mensagem de cada campo, com o caminho em notação de ponto. */
export function fieldErrors(error: z.ZodError): FieldErrors {
    const errors: FieldErrors = {};

    for (const issue of error.issues) {
        const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form';

        errors[key] ??= issue.message;
    }

    return errors;
}

export { z };

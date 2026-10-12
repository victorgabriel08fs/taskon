import type { FieldErrors } from '@/types';

export type HttpStatus = 401 | 403 | 404 | 422 | 429 | 500;

/**
 * O equivalente ao `abort()` do Laravel. Lançado de qualquer camada do
 * servidor, é convertido pelo `defineAction` num `ActionResult` com o status e
 * a mensagem certos — e, nas páginas, em `notFound()`/tela de 403.
 */
export class HttpError extends Error {
    constructor(
        public readonly status: HttpStatus,
        message?: string,
        public readonly errors?: FieldErrors,
    ) {
        super(message ?? defaultMessage(status));
        this.name = 'HttpError';
    }
}

/** O `ValidationException::withMessages()` do Laravel: erro por campo, status 422. */
export class ValidationError extends HttpError {
    constructor(errors: FieldErrors) {
        super(422, Object.values(errors)[0] ?? 'Dados inválidos.', errors);
        this.name = 'ValidationError';
    }
}

export function defaultMessage(status: HttpStatus): string {
    switch (status) {
        case 401:
            return 'Sua sessão expirou. Entre de novo para continuar.';
        case 403:
            return 'Você não tem permissão para fazer isso.';
        case 404:
            return 'Não encontramos o que você procurava — talvez tenha sido excluído.';
        case 422:
            return 'Confira os campos destacados.';
        case 429:
            return 'Muitas tentativas. Espere um pouco e tente de novo.';
        default:
            return 'Algo deu errado do nosso lado. Tente de novo em instantes.';
    }
}

export function abort(status: HttpStatus, message?: string): never {
    throw new HttpError(status, message);
}

export function abortIf(condition: unknown, status: HttpStatus, message?: string): asserts condition is false {
    if (condition) abort(status, message);
}

export function abortUnless(condition: unknown, status: HttpStatus, message?: string): asserts condition {
    if (!condition) abort(status, message);
}

/** Lança 422 com uma mensagem num campo só. */
export function invalid(field: string, message: string): never {
    throw new ValidationError({ [field]: message });
}

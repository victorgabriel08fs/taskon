import { expect } from 'vitest';
import { HttpError, type HttpStatus } from '@/server/errors';

/**
 * O `assertForbidden()` / `assertNotFound()` / `assertSessionHasErrors()` dos
 * testes do Laravel, para serviços que lançam HttpError.
 */
export async function expectHttpError(promise: Promise<unknown>, status: HttpStatus, field?: string): Promise<HttpError> {
    let caught: unknown;

    try {
        await promise;
    } catch (error) {
        caught = error;
    }

    expect(caught, `esperava HttpError ${status}, mas nada foi lançado`).toBeInstanceOf(HttpError);

    const error = caught as HttpError;

    expect(error.status).toBe(status);

    if (field) expect(error.errors?.[field], `esperava erro no campo "${field}"`).toBeTruthy();

    return error;
}

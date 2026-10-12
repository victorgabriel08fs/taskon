import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

/**
 * Health check — o `/up` do Laravel. Responde 200 quando o app e o banco
 * respondem; 503 quando o banco não responde.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        await db.execute(sql`select 1`);

        return Response.json({ status: 'ok' });
    } catch (error) {
        console.error('[up] banco indisponível', error);

        return Response.json({ status: 'database_unavailable' }, { status: 503 });
    }
}

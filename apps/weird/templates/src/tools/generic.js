const DEFAULT_PREVIEW_LIMIT = 1000;
const DEFAULT_EXPORT_LIMIT = 10000;
function isSelectOnly(sql) {
    const t = sql.trim().toLowerCase();
    if (!t.startsWith('select'))
        return false;
    return !/(insert|update|delete|create|drop|alter|truncate|attach|detach|vacuum|reindex)\b/.test(t);
}
export function registerGenericTools(server, db) {
    server.tool('list_tables', {
        description: 'List tables',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
            const rows = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
            return { content: [{ type: 'text', text: JSON.stringify(rows.map((r) => r.name)) }] };
        }
    });
    server.tool('describe_table', {
        description: 'Describe table columns with types',
        inputSchema: { type: 'object', properties: { table: { type: 'string' } }, required: ['table'], additionalProperties: false },
        handler: async (args) => {
            const table = args.table;
            const pragma = await db.all(`PRAGMA table_info("${table}")`);
            return { content: [{ type: 'text', text: JSON.stringify(pragma) }] };
        }
    });
    server.tool('preview_rows', {
        description: 'Preview rows',
        inputSchema: { type: 'object', properties: { table: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } }, required: ['table'], additionalProperties: false },
        handler: async (args) => {
            const limit = Math.min(args.limit ?? DEFAULT_PREVIEW_LIMIT, DEFAULT_PREVIEW_LIMIT);
            const offset = args.offset ?? 0;
            const rows = await db.all(`SELECT * FROM "${args.table}" LIMIT ${limit} OFFSET ${offset}`);
            return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        }
    });
    server.tool('run_sql', {
        description: 'Run read-only SQL (SELECT only)',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'], additionalProperties: false },
        handler: async (args) => {
            if (!isSelectOnly(args.sql))
                throw new Error('Only SELECT queries are allowed');
            const rows = await db.all(args.sql);
            return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        }
    });
    server.tool('export_results', {
        description: 'Export a SELECT to CSV or JSON',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' }, format: { type: 'string', enum: ['csv', 'json'] }, limit: { type: 'number' } }, required: ['sql'], additionalProperties: false },
        handler: async (args) => {
            if (!isSelectOnly(args.sql))
                throw new Error('Only SELECT queries are allowed');
            const limit = Math.min(args.limit ?? DEFAULT_EXPORT_LIMIT, DEFAULT_EXPORT_LIMIT);
            const limitedSql = `${args.sql} LIMIT ${limit}`;
            const rows = await db.all(limitedSql);
            if ((args.format ?? 'json') === 'csv') {
                const cols = rows.length ? Object.keys(rows[0]) : [];
                const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))).join('\n');
                return { content: [{ type: 'text', text: csv }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        }
    });
}
//# sourceMappingURL=generic.js.map
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';

describe('MCP stdio CLI', () => {
    it('initializes and lists tools without logging into the protocol stream', async () => {
        const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
        const errors: string[] = [];
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'src/mcp-stdio.ts'],
            env: { PATH: process.env.PATH ?? '' },
            stderr: 'pipe',
        });
        let stderr = '';
        transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        const client = new Client({ name: 'stdio-regression-test', version: '1.0.0' });
        client.onerror = (error) => { errors.push(error.message); };
        try {
            await client.connect(transport);
            const result = await client.listTools();
            expect(client.getServerVersion()?.version).toBe(pkg.version);
            expect(result.tools.map((tool) => tool.name)).toContain('get_claim_history');
            expect(result.tools).toHaveLength(9);
            expect(errors).toEqual([]);
            expect(stderr).toContain('MCP server (stdio) connected');
        } finally {
            await client.close();
        }
    }, 15_000);
});

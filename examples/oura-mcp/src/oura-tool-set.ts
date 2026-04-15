import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

async function ouraFetch(
  endpoint: string,
  params: Record<string, string>,
  token: string,
): Promise<unknown> {
  const url = new URL(`https://api.ouraring.com/v2/usercollection/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oura API error ${res.status}: ${text}`);
  }

  return res.json();
}

const dateParams = {
  start_date: z.string().describe('Start date in YYYY-MM-DD format'),
  end_date: z.string().optional().describe('End date in YYYY-MM-DD format (defaults to start_date)'),
};

type DateParams = { start_date: string; end_date?: string };

export async function registerOuraTools(
  server: McpServer,
  userId: string,
  getUpstreamToken: () => Promise<string>,
): Promise<void> {
  const tools: Array<{ name: string; endpoint: string; description: string }> = [
    { name: 'oura_sleep', endpoint: 'daily_sleep', description: 'Get daily sleep scores and contributors' },
    { name: 'oura_sleep_detail', endpoint: 'sleep', description: 'Get detailed sleep periods (deep/REM/light/lowest HR/avg HRV/bedtime/wake)' },
    { name: 'oura_readiness', endpoint: 'daily_readiness', description: 'Get readiness scores, temperature deviation, HRV balance' },
    { name: 'oura_activity', endpoint: 'daily_activity', description: 'Get steps, calories, activity score' },
    { name: 'oura_stress', endpoint: 'daily_stress', description: 'Get stress/recovery minutes, day summary' },
    { name: 'oura_heart_rate', endpoint: 'heartrate', description: 'Get time-series heart rate data' },
  ];

  for (const tool of tools) {
    (server as any).tool(
      tool.name,
      tool.description,
      dateParams,
      async (params: DateParams) => {
        try {
          const token = await getUpstreamToken();
          const data = await ouraFetch(tool.endpoint, {
            start_date: params.start_date,
            end_date: params.end_date || params.start_date,
          }, token);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      },
    );
  }
}

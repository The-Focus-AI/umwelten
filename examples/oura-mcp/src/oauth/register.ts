import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Store } from '../store.js';
import { json } from './helpers.js';

export async function handleRegister(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  const params = JSON.parse(body);

  if (!params.redirect_uris || !Array.isArray(params.redirect_uris) || params.redirect_uris.length === 0) {
    json(res, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' }, 400);
    return;
  }

  const clientId = randomUUID();
  const clientName = params.client_name ?? null;

  await store.createClient(clientId, clientName, params.redirect_uris);

  json(res, {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: params.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201);
}

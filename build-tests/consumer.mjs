import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

for (const format of ['esm', 'cjs']) {
  const load = (name) => (format === 'esm' ? import(name) : require(name));
  const { HttpClient, AdaptiveConfigSchema } = await load(
    '@http-client-toolkit/core',
  );
  const { InMemoryCacheStore } = await load(
    '@http-client-toolkit/store-memory',
  );
  const { createSQLiteStores } = await load(
    '@http-client-toolkit/store-sqlite',
  );
  const { DynamoDBCacheStore } = await load(
    '@http-client-toolkit/store-dynamodb',
  );
  const { createDashboardHandler } = await load(
    '@http-client-toolkit/dashboard',
  );
  assert.equal(AdaptiveConfigSchema.parse({}).highActivityThreshold, 10);

  const memory = new InMemoryCacheStore();
  const sqlite = createSQLiteStores();
  const dynamodb = new DynamoDBCacheStore({ region: 'eu-west-1' });
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=60',
    });
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    for (const store of [memory, sqlite.cache]) {
      await store.set('round-trip', { value: 42 }, 60);
      assert.deepEqual(await store.get('round-trip'), { value: 42 });
      await store.delete('round-trip');
      assert.equal(await store.get('round-trip'), undefined);
    }
    const owner = await sqlite.dedupe.registerOrJoin('job');
    assert.equal(owner.isOwner, true);
    assert.equal((await sqlite.dedupe.registerOrJoin('job')).isOwner, false);
    await sqlite.dedupe.complete('job', { done: true });
    assert.deepEqual(await sqlite.dedupe.waitFor('job'), { done: true });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new HttpClient({
      name: 'consumer',
      cache: { store: memory },
    });
    const url = `http://127.0.0.1:${server.address().port}/data`;
    assert.deepEqual(await client.get(url), { ok: true });
    assert.deepEqual(await client.get(url), { ok: true });
    assert.equal(requests, 1, 'The second request should use the cache');

    const handler = createDashboardHandler({ clients: [{ client }] });
    const health = await handler(new Request('http://localhost/api/health'));
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    const page = await handler(new Request('http://localhost/'));
    assert.equal(page.status, 200);
    const html = await page.text();
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset, 'The packed dashboard must include its built client');
    assert.equal(
      (await handler(new Request(new URL(asset, 'http://localhost')))).status,
      200,
    );
    console.log(`Node ${process.version}: ${format} installed packages passed`);
  } finally {
    await new Promise((done) => server.close(done));
    memory.destroy();
    await sqlite.close();
    dynamodb.destroy();
  }
}

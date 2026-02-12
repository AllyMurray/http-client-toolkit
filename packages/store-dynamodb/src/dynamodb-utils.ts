import {
  BatchWriteCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

type DynamoItem = Record<string, unknown>;

const MAX_BATCH_WRITE_RETRIES = 8;
const MAX_DYNAMO_KEY_PART_BYTES = 512;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
  const backoff = Math.min(1000, 50 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 25);
  return backoff + jitter;
}

export async function batchDeleteWithRetries(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  keys: Array<DynamoItem>,
): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);

    let pendingWrites = batch.map((key) => ({ DeleteRequest: { Key: key } }));

    for (let attempt = 0; pendingWrites.length > 0; attempt++) {
      const response = await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: pendingWrites,
          },
        }),
      );

      const unprocessed = response.UnprocessedItems?.[tableName] ?? [];

      if (unprocessed.length === 0) {
        break;
      }

      if (attempt >= MAX_BATCH_WRITE_RETRIES) {
        throw new Error(
          `Failed to delete all items from table "${tableName}" after ${MAX_BATCH_WRITE_RETRIES + 1} attempts`,
        );
      }

      pendingWrites = unprocessed
        .map((request) => request.DeleteRequest?.Key)
        .filter((key): key is DynamoItem => Boolean(key))
        .map((key) => ({ DeleteRequest: { Key: key } }));
      await sleep(getRetryDelayMs(attempt));
    }
  }
}

export async function queryCountAllPages(
  docClient: DynamoDBDocumentClient,
  input: QueryCommandInput,
): Promise<number> {
  let total = 0;
  let lastEvaluatedKey: DynamoItem | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    total += result.Count ?? 0;
    lastEvaluatedKey = result.LastEvaluatedKey as DynamoItem | undefined;
  } while (lastEvaluatedKey);

  return total;
}

export async function queryItemsAllPages(
  docClient: DynamoDBDocumentClient,
  input: QueryCommandInput,
): Promise<Array<DynamoItem>> {
  const items: Array<DynamoItem> = [];
  let lastEvaluatedKey: DynamoItem | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    if (result.Items?.length) {
      items.push(...(result.Items as Array<DynamoItem>));
    }

    lastEvaluatedKey = result.LastEvaluatedKey as DynamoItem | undefined;
  } while (lastEvaluatedKey);

  return items;
}

export async function queryCountUpTo(
  docClient: DynamoDBDocumentClient,
  input: QueryCommandInput,
  maxCount: number,
): Promise<{ count: number; reachedLimit: boolean }> {
  if (maxCount <= 0) {
    return { count: 0, reachedLimit: true };
  }

  let total = 0;
  let lastEvaluatedKey: DynamoItem | undefined;

  do {
    const remaining = maxCount - total;
    const result = await docClient.send(
      new QueryCommand({
        ...input,
        Select: 'COUNT',
        Limit: remaining,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    total += result.Count ?? 0;
    if (total >= maxCount) {
      return { count: maxCount, reachedLimit: true };
    }

    lastEvaluatedKey = result.LastEvaluatedKey as DynamoItem | undefined;
  } while (lastEvaluatedKey);

  return { count: total, reachedLimit: false };
}

export function isConditionalTransactionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    name?: unknown;
    message?: unknown;
    CancellationReasons?: unknown;
    cancellationReasons?: unknown;
  };

  if (maybeError.name !== 'TransactionCanceledException') {
    return false;
  }

  const cancellationReasons =
    maybeError.CancellationReasons ?? maybeError.cancellationReasons;
  if (Array.isArray(cancellationReasons)) {
    return cancellationReasons.some((reason) => {
      if (!reason || typeof reason !== 'object') {
        return false;
      }

      return (
        'Code' in reason &&
        (reason as { Code?: unknown }).Code === 'ConditionalCheckFailed'
      );
    });
  }

  return (
    typeof maybeError.message === 'string' &&
    maybeError.message.includes('ConditionalCheckFailed')
  );
}

export function assertDynamoKeyPart(
  value: string,
  label: string,
  maxBytes = MAX_DYNAMO_KEY_PART_BYTES,
): void {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    if (charCode < 0x20 || charCode === 0x7f) {
      throw new Error(`${label} contains unsupported control characters`);
    }
  }

  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds maximum length of ${maxBytes} bytes`);
  }
}

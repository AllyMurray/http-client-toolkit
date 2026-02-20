import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  batchDeleteWithRetries,
  queryCountAllPages,
  queryCountUpTo,
  isConditionalTransactionFailure,
  assertDynamoKeyPart,
} from './dynamodb-utils.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = 'test-table';

beforeEach(() => {
  ddbMock.reset();
  vi.restoreAllMocks();
});

describe('batchDeleteWithRetries', () => {
  it('deletes all items in a single attempt when no unprocessed items', async () => {
    ddbMock.on(BatchWriteCommand).resolvesOnce({ UnprocessedItems: {} });

    await batchDeleteWithRetries(docClient, TABLE_NAME, [
      { pk: 'k1', sk: 's1' },
    ]);

    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(1);
  });

  it('retries when UnprocessedItems are returned and succeeds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: {
          [TABLE_NAME]: [{ DeleteRequest: { Key: { pk: 'k1', sk: 's1' } } }],
        },
      })
      .resolvesOnce({ UnprocessedItems: {} });

    await batchDeleteWithRetries(docClient, TABLE_NAME, [
      { pk: 'k1', sk: 's1' },
    ]);

    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(2);
  });

  it('throws after exceeding MAX_BATCH_WRITE_RETRIES (8)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const unprocessedResponse = {
      UnprocessedItems: {
        [TABLE_NAME]: [{ DeleteRequest: { Key: { pk: 'k1', sk: 's1' } } }],
      },
    };

    // Attempts 0-8 (9 sends total) all return unprocessed items.
    // On attempt 8 (the 9th iteration), the code checks attempt >= 8 and throws.
    ddbMock.on(BatchWriteCommand).resolves(unprocessedResponse);

    await expect(
      batchDeleteWithRetries(docClient, TABLE_NAME, [{ pk: 'k1', sk: 's1' }]),
    ).rejects.toThrow(
      `Failed to delete all items from table "${TABLE_NAME}" after 9 attempts`,
    );
  });

  it('filters out requests without DeleteRequest.Key during retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: {
          [TABLE_NAME]: [
            { DeleteRequest: { Key: { pk: 'k1', sk: 's1' } } },
            { DeleteRequest: undefined } as never,
          ],
        },
      })
      .resolvesOnce({ UnprocessedItems: {} });

    await batchDeleteWithRetries(docClient, TABLE_NAME, [
      { pk: 'k1', sk: 's1' },
      { pk: 'k2', sk: 's2' },
    ]);

    const secondCall = ddbMock.commandCalls(BatchWriteCommand)[1]!;
    const requestItems = secondCall.args[0].input.RequestItems!;
    expect(requestItems[TABLE_NAME]).toHaveLength(1);
  });
});

describe('queryCountAllPages', () => {
  it('returns total count from a single page', async () => {
    ddbMock.on(QueryCommand).resolvesOnce({ Count: 5 });

    const total = await queryCountAllPages(docClient, {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'test' },
    });

    expect(total).toBe(5);
  });

  it('accumulates counts across multiple pages', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Count: 5, LastEvaluatedKey: { pk: 'next' } })
      .resolvesOnce({ Count: 3 });

    const total = await queryCountAllPages(docClient, {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'test' },
    });

    expect(total).toBe(8);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it('defaults Count to 0 when not present in response', async () => {
    ddbMock.on(QueryCommand).resolvesOnce({});

    const total = await queryCountAllPages(docClient, {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'test' },
    });

    expect(total).toBe(0);
  });
});

describe('queryCountUpTo', () => {
  it('returns { count: 0, reachedLimit: true } when maxCount is 0', async () => {
    const result = await queryCountUpTo(
      docClient,
      {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'test' },
      },
      0,
    );

    expect(result).toEqual({ count: 0, reachedLimit: true });
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('returns { count: 0, reachedLimit: true } when maxCount is negative', async () => {
    const result = await queryCountUpTo(
      docClient,
      {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'test' },
      },
      -5,
    );

    expect(result).toEqual({ count: 0, reachedLimit: true });
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe('isConditionalTransactionFailure', () => {
  describe('null/falsy and non-object inputs', () => {
    it('returns false for null', () => {
      expect(isConditionalTransactionFailure(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isConditionalTransactionFailure(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isConditionalTransactionFailure('some error')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isConditionalTransactionFailure(42)).toBe(false);
    });

    it('returns false for false', () => {
      expect(isConditionalTransactionFailure(false)).toBe(false);
    });

    it('returns false for 0', () => {
      expect(isConditionalTransactionFailure(0)).toBe(false);
    });
  });

  describe('wrong error name', () => {
    it('returns false when name is not TransactionCanceledException', () => {
      const error = {
        name: 'ValidationException',
        message: 'ConditionalCheckFailed',
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });

    it('returns false when name is undefined', () => {
      const error = { message: 'ConditionalCheckFailed' };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });
  });

  describe('CancellationReasons array-based detection', () => {
    it('returns true when CancellationReasons contains ConditionalCheckFailed', () => {
      const error = {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'None' },
          { Code: 'ConditionalCheckFailed' },
        ],
      };
      expect(isConditionalTransactionFailure(error)).toBe(true);
    });

    it('returns true when cancellationReasons (lowercase) contains ConditionalCheckFailed', () => {
      const error = {
        name: 'TransactionCanceledException',
        cancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      };
      expect(isConditionalTransactionFailure(error)).toBe(true);
    });

    it('returns false when CancellationReasons has no ConditionalCheckFailed', () => {
      const error = {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'None' }],
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });

    it('returns false when CancellationReasons contains non-object elements', () => {
      const error = {
        name: 'TransactionCanceledException',
        CancellationReasons: [null, undefined, 'string', 42],
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });

    it('returns false when CancellationReasons contains false', () => {
      const error = {
        name: 'TransactionCanceledException',
        CancellationReasons: [false, 0, ''],
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });
  });

  describe('message-based fallback (no CancellationReasons array)', () => {
    it('returns true when message contains ConditionalCheckFailed', () => {
      const error = {
        name: 'TransactionCanceledException',
        message:
          'Transaction cancelled, please refer to the reasons for specific reasons [ConditionalCheckFailed]',
      };
      expect(isConditionalTransactionFailure(error)).toBe(true);
    });

    it('returns false when message does not contain ConditionalCheckFailed', () => {
      const error = {
        name: 'TransactionCanceledException',
        message: 'Transaction cancelled for some other reason',
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });

    it('returns false when message is not a string', () => {
      const error = {
        name: 'TransactionCanceledException',
        message: 12345,
      };
      expect(isConditionalTransactionFailure(error)).toBe(false);
    });
  });
});

describe('assertDynamoKeyPart', () => {
  describe('control character validation', () => {
    it('throws for a string containing a null character (0x00)', () => {
      expect(() => assertDynamoKeyPart('abc\x00def', 'pk')).toThrow(
        'pk contains unsupported control characters',
      );
    });

    it('throws for a string containing a tab character (0x09)', () => {
      expect(() => assertDynamoKeyPart('abc\tdef', 'sk')).toThrow(
        'sk contains unsupported control characters',
      );
    });

    it('throws for a string containing a newline character (0x0a)', () => {
      expect(() => assertDynamoKeyPart('abc\ndef', 'pk')).toThrow(
        'pk contains unsupported control characters',
      );
    });

    it('throws for a string containing character 0x1f (last char below 0x20)', () => {
      expect(() => assertDynamoKeyPart('abc\x1fdef', 'pk')).toThrow(
        'pk contains unsupported control characters',
      );
    });

    it('throws for a string containing the DEL character (0x7f)', () => {
      expect(() => assertDynamoKeyPart('abc\x7fdef', 'pk')).toThrow(
        'pk contains unsupported control characters',
      );
    });

    it('allows a string with character 0x20 (space)', () => {
      expect(() => assertDynamoKeyPart('abc def', 'pk')).not.toThrow();
    });

    it('allows a string with character 0x7e (tilde, just before DEL)', () => {
      expect(() => assertDynamoKeyPart('abc~def', 'pk')).not.toThrow();
    });
  });
});

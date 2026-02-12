import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTable,
  ensureTable,
  DEFAULT_TABLE_NAME,
  TABLE_SCHEMA,
} from './table.js';

const ddbMock = mockClient(DynamoDBClient);

describe('table utilities', () => {
  let rawClient: DynamoDBClient;

  beforeEach(() => {
    ddbMock.reset();
    rawClient = new DynamoDBClient({});
  });

  describe('constants', () => {
    it('exports default table name', () => {
      expect(DEFAULT_TABLE_NAME).toBe('http-client-toolkit');
    });

    it('exports table schema with pk/sk and GSI', () => {
      expect(TABLE_SCHEMA.KeySchema).toEqual([
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ]);
      expect(TABLE_SCHEMA.GlobalSecondaryIndexes).toHaveLength(1);
      expect(TABLE_SCHEMA.GlobalSecondaryIndexes[0]?.IndexName).toBe('gsi1');
    });
  });

  describe('createTable', () => {
    it('sends CreateTableCommand and waits for ACTIVE', async () => {
      ddbMock
        .on(CreateTableCommand)
        .resolvesOnce({})
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await createTable(rawClient, 'my-table');

      expect(ddbMock).toHaveReceivedCommandTimes(CreateTableCommand, 1);
      expect(ddbMock).toHaveReceivedCommandTimes(DescribeTableCommand, 1);
      expect(ddbMock).toHaveReceivedCommandWith(CreateTableCommand, {
        TableName: 'my-table',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('uses default table name when none provided', async () => {
      ddbMock
        .on(CreateTableCommand)
        .resolvesOnce({})
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await createTable(rawClient);

      expect(ddbMock).toHaveReceivedCommandWith(CreateTableCommand, {
        TableName: DEFAULT_TABLE_NAME,
      });
    });

    it('polls until table becomes ACTIVE', async () => {
      ddbMock
        .on(CreateTableCommand)
        .resolvesOnce({})
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'CREATING' } })
        .resolvesOnce({ Table: { TableStatus: 'CREATING' } })
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await createTable(rawClient, 'my-table', { delayMs: 10 });

      // 1 create + 3 describe polls
      expect(ddbMock).toHaveReceivedCommandTimes(CreateTableCommand, 1);
      expect(ddbMock).toHaveReceivedCommandTimes(DescribeTableCommand, 3);
    });

    it('throws when table does not become active within max attempts', async () => {
      ddbMock
        .on(CreateTableCommand)
        .resolvesOnce({})
        .on(DescribeTableCommand)
        .resolves({ Table: { TableStatus: 'CREATING' } });

      await expect(
        createTable(rawClient, 'slow-table', { maxAttempts: 3, delayMs: 10 }),
      ).rejects.toThrow('did not become active');
    });
  });

  describe('ensureTable', () => {
    it('returns immediately if table is ACTIVE', async () => {
      ddbMock
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await ensureTable(rawClient, 'my-table');

      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('waits for table to become ACTIVE if not yet ready', async () => {
      ddbMock
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'CREATING' } })
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await ensureTable(rawClient, 'my-table');

      expect(ddbMock.calls()).toHaveLength(2);
    });

    it('creates table if ResourceNotFoundException is thrown', async () => {
      ddbMock
        .on(DescribeTableCommand)
        .rejectsOnce(
          new ResourceNotFoundException({
            message: 'Table not found',
            $metadata: {},
          }),
        )
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });
      ddbMock.on(CreateTableCommand).resolvesOnce({});

      await ensureTable(rawClient, 'new-table');

      expect(ddbMock.calls()).toHaveLength(3);
    });

    it('uses default table name when none provided', async () => {
      ddbMock
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'ACTIVE' } });

      await ensureTable(rawClient);

      expect(ddbMock).toHaveReceivedCommandWith(DescribeTableCommand, {
        TableName: DEFAULT_TABLE_NAME,
      });
    });

    it('rethrows non-ResourceNotFoundException errors', async () => {
      ddbMock.on(DescribeTableCommand).rejectsOnce(new Error('Access denied'));

      await expect(ensureTable(rawClient, 'my-table')).rejects.toThrow(
        'Access denied',
      );
    });
  });
});

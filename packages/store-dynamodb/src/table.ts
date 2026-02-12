import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  type DynamoDBClient,
  type KeySchemaElement,
  type AttributeDefinition,
  type GlobalSecondaryIndex,
} from '@aws-sdk/client-dynamodb';

export const DEFAULT_TABLE_NAME = 'http-client-toolkit';

export const TABLE_SCHEMA: {
  KeySchema: Array<KeySchemaElement>;
  AttributeDefinitions: Array<AttributeDefinition>;
  GlobalSecondaryIndexes: Array<GlobalSecondaryIndex>;
} = {
  KeySchema: [
    { AttributeName: 'pk', KeyType: 'HASH' },
    { AttributeName: 'sk', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'pk', AttributeType: 'S' },
    { AttributeName: 'sk', AttributeType: 'S' },
    { AttributeName: 'gsi1pk', AttributeType: 'S' },
    { AttributeName: 'gsi1sk', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'gsi1',
      KeySchema: [
        { AttributeName: 'gsi1pk', KeyType: 'HASH' },
        { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
};

export async function createTable(
  client: DynamoDBClient,
  tableName: string = DEFAULT_TABLE_NAME,
  options?: { maxAttempts?: number; delayMs?: number },
): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      KeySchema: TABLE_SCHEMA.KeySchema,
      AttributeDefinitions: TABLE_SCHEMA.AttributeDefinitions,
      BillingMode: 'PAY_PER_REQUEST',
      GlobalSecondaryIndexes: TABLE_SCHEMA.GlobalSecondaryIndexes,
    }),
  );

  // Wait for table to become active
  await waitForTable(client, tableName, options?.maxAttempts, options?.delayMs);
}

export async function ensureTable(
  client: DynamoDBClient,
  tableName: string = DEFAULT_TABLE_NAME,
): Promise<void> {
  try {
    const response = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (response.Table?.TableStatus === 'ACTIVE') {
      return;
    }
    // Table exists but not active yet — wait for it
    await waitForTable(client, tableName);
  } catch (error: unknown) {
    if (error instanceof ResourceNotFoundException) {
      await createTable(client, tableName);
      return;
    }
    throw error;
  }
}

async function waitForTable(
  client: DynamoDBClient,
  tableName: string,
  maxAttempts: number = 30,
  delayMs: number = 1000,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (response.Table?.TableStatus === 'ACTIVE') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Table ${tableName} did not become active within ${maxAttempts * delayMs}ms`,
  );
}

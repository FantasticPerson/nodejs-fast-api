import { joinOpenApiPath, toOpenApiPath } from './path.js';

export function buildOpenApiDocument({ endpoints, datasources, config }) {
  const paths = {};
  const tags = [];
  const datasourceMap = new Map(datasources.map((item) => [item.id, item]));

  for (const endpoint of endpoints.filter((item) => item.enabled)) {
    const urlPath = joinOpenApiPath(config.openapiPath, toOpenApiPath(endpoint.path));
    const operation = {
      summary: endpoint.name,
      description: endpoint.description || `数据源：${datasourceMap.get(endpoint.datasourceId)?.name || endpoint.datasourceId}`,
      operationId: endpoint.id,
      tags: endpoint.group ? [endpoint.group] : ['default'],
      parameters: buildParameters(endpoint),
      requestBody: buildRequestBody(endpoint),
      responses: {
        200: {
          description: '成功',
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true }
            }
          }
        }
      }
    };
    if (config.openapiToken) operation.security = [{ ApiKeyAuth: [] }];
    if (endpoint.group && !tags.includes(endpoint.group)) tags.push(endpoint.group);
    paths[urlPath] ||= {};
    paths[urlPath][endpoint.method.toLowerCase()] = operation;
  }

  const document = {
    openapi: '3.0.3',
    info: {
      title: 'Node Magic API',
      version: config.version || '1.0.0',
      description: '由 Node Magic API Studio 从 SQL 定义自动生成的接口文档。'
    },
    servers: [{ url: '/' }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-token'
        }
      }
    }
  };
  if (config.openapiToken) document.security = [{ ApiKeyAuth: [] }];
  return document;
}

function buildParameters(endpoint) {
  const output = [];
  for (const param of endpoint.params || []) {
    if (param.in === 'body') continue;
    output.push({
      name: param.name,
      in: param.in,
      required: param.in === 'path' ? true : Boolean(param.required),
      description: param.description || undefined,
      schema: schemaFor(param.type)
    });
  }
  if (endpoint.pagination?.enabled) {
    if (!output.some((item) => item.name === 'page' && item.in === 'query')) {
      output.push({ name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } });
    }
    if (!output.some((item) => item.name === 'pageSize' && item.in === 'query')) {
      output.push({
        name: 'pageSize',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: endpoint.pagination.maxPageSize || 100, default: 20 }
      });
    }
  }
  return output;
}

function buildRequestBody(endpoint) {
  const bodyParams = (endpoint.params || []).filter((param) => param.in === 'body');
  if (!bodyParams.length) return undefined;
  const properties = {};
  const required = [];
  for (const param of bodyParams) {
    properties[param.name] = {
      ...schemaFor(param.type),
      description: param.description || undefined,
      default: param.defaultValue ?? undefined
    };
    if (param.required) required.push(param.name);
  }
  return {
    required: Boolean(required.length),
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties,
          ...(required.length ? { required } : {})
        }
      }
    }
  };
}

function schemaFor(type) {
  switch (type) {
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'json':
      return { type: 'object', additionalProperties: true };
    case 'array':
      return { type: 'array', items: { type: 'string' } };
    default:
      return { type: 'string' };
  }
}

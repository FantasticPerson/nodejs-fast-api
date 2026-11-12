import { buildCrudDefinitions } from '../generator.js';

export class CrudService {
  constructor({ datasourceService, endpointService }) {
    this.datasourceService = datasourceService;
    this.endpointService = endpointService;
  }

  async build(datasourceId, tableName, options = {}) {
    const datasource = await this.datasourceService.resolveById(datasourceId);
    const table = await this.datasourceService.getTableInfo(datasourceId, tableName);
    return buildCrudDefinitions({
      datasource,
      table,
      pathBase: options.pathBase,
      methods: options.methods
    });
  }

  async preview(datasourceId, tableName, options = {}) {
    return this.build(datasourceId, tableName, options);
  }

  async generate(datasourceId, tableName, options = {}) {
    const generated = await this.build(datasourceId, tableName, options);
    const endpoints = await this.endpointService.createMany(generated.endpoints);
    return { pathBase: generated.pathBase, endpoints };
  }
}

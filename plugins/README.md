# 服务端插件目录

把可信的 `.js` 或 `.mjs` 文件放在此目录。服务启动时按文件名加载，脚本接口通过 `ctx.plugins.<名称>.<函数>()` 调用。

插件名称默认取文件名，也可以在模块中导出 `name` 覆盖。模块必须导出 `actions` 对象，值必须是函数。

```javascript
export const name = 'pricing';

export const actions = {
  async calculate(input, context) {
    return {
      total: Number(input.amount || 0) * 2,
      endpoint: context.endpoint.name
    };
  }
};
```

脚本调用：

```javascript
return await ctx.plugins.pricing.calculate({ amount: 100 });
```

插件函数的第二个参数是受控上下文：

- `params`：接口参数。
- `request`：请求 query/body/path/headers。
- `endpoint`：接口 `id` 和 `name`。
- `db`：`query`、`queryOne`、`execute`。
- `http`：`fetch`，受接口开关和 `SCRIPT_HTTP_ALLOWLIST` 限制。
- `logger`：插件日志接口。

插件属于可信服务端代码，可导入 Node.js 模块。不要在插件中打印密码、令牌或完整请求头。修改插件后需要重启 Node.js 进程。

加载失败的文件不会阻止 SQL 接口和已加载插件工作，错误会出现在管理台启动数据和共享脚本页。

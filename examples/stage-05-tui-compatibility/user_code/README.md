# 先跑使用者路径

```bash
npm run example:tui-plugin
node out/tui/myssh.cjs --validate-plugin .dev/third-party-market/sample-command-book/terminal.json
node out/tui/myssh.cjs --install-plugin sample-command-book --registry file:///absolute/path/to/.dev/third-party-market/registry.json
```

第一条输出本机的实际 registry 和 entry 路径，替换第三条的地址。预期 `PLUGIN_OK sample-command-book · commands`。
在插件菜单启用后，连接合成服务选择 `hello`；命令只填入 Shell，由使用者按 Enter 执行。

作者安装发行 tgz 后，可直接从 `myssh-tui/plugin` 导入 validator；示例中的仓库相对导入只用于源码示例。
复用原 React 插件的业务数据构建 terminal.json，React 组件保留给桌面；不添加任意命令自动执行或 JS 加载权限。
当前宿主提供 commands/monitor/mysql/wsl，其他业务需要新增合同，不能用字段伪造能力。

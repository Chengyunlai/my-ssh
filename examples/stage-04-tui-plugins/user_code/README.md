# 使用者主线

`main.mjs` 从构建后的公开 MySQL 模块导入 MysqlSession（包出口 `myssh-tui/mysql`），
以回环测试端口创建连接，执行 `SELECT 'MYSQL_OK 你好' AS message`，打印第一格，最后 close。
用户代码不导入服务 fixture，也不操作私有协议对象。

`npm run example:mysql` 的脚本负责测试服务生命周期和 MYSSH_EXAMPLE_DB_PORT；
真实使用时提供自己的 MysqlProfile，并按需启用 TLS。Example 只使用固定虚拟账号。

断点：MysqlSession.connect 观察 profile.port；query 观察 SQL 和收到的列/行；
用户代码 console.log 观察 `MYSQL_OK 你好`。生成包同时提供 ESM/CJS 入口和声明文件。

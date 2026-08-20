# MySSH 开发辅助命令
# 用法: make <target>   (make help 查看全部)

.PHONY: help install dev lint test typecheck build icon dist clean check release-patch release-minor release-major

help: ## 显示所有可用命令
	@printf 'MySSH 可用命令:\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-16s %s\n", $$1, $$2}'
	@printf '\n发布流程: 打 tag vX.Y.Z 推送后由 CI 自动打包并发布 GitHub Releases\n'

install: ## 安装依赖(npm ci,基于 lockfile 可复现)
	npm ci

dev: ## 启动开发模式(热更新)
	npm run dev

lint: ## 静态代码检查
	npm run lint

test: ## 运行单元测试
	npm test

typecheck: ## 类型检查(main + renderer)
	npm run typecheck

build: ## 构建到 out/
	npm run build

icon: ## 重建 macOS 打包图标(100% 不透明,修复直角边/毛边)
	node scripts/prepare-macos-icon.mjs

dist: icon ## 打包安装产物(macOS dmg + zip,输出到 dist/)
	npm run dist

clean: ## 清理构建产物
	rm -rf out dist

check: ## 提交前检查:lint + 类型检查 + 测试 + 构建
	npm run lint && npm run typecheck && npm test && npm run build

release-patch: ## 发补丁版本(v0.1.0 -> v0.1.1)并推送 tag
	npm version patch && git push --follow-tags

release-minor: ## 发次版本(v0.1.0 -> v0.2.0)并推送 tag
	npm version minor && git push --follow-tags

release-major: ## 发主版本(v0.1.0 -> v1.0.0)并推送 tag
	npm version major && git push --follow-tags

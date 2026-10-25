# Changelog

## 0.3.0

- 发布准备：补 `README.md`、`repository`/`homepage`/`bugs`/`author`/`keywords`，版本升至 0.3.0。
- 剪映导出改为加密草稿（`aoguai/pyJianYingDraft` fork 的 `JianyingDraftCryptoCodec`），适配剪映 11.6。
- `requirements.txt` 指向 fork 的 codeload zip，避免误装 PyPI 官方版。
- 移除插件内嵌 `skills/`，技能改为独立仓库分发，避免插件市场把包误判为技能集。
- 移除无效的 `devDependencies`。

## 0.2.3

- 20 个 `autocut_*` 工具：项目/检索/审阅/人声/时间线/剪映导出。
- 本地素材索引、Top-K 匹配、BGM/音效规划、OTIO 导出。

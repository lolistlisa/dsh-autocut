# dsh-autocut

DeepSeek Harness（DSH）的中长视频自动剪辑插件：把「文案 + 口播 + 本地/在线素材」变成可继续精修的多轨时间线，并可直接导出**剪映专业版草稿**或 OTIO。

20 个 `autocut_*` 工具，所有中间产物都是 `.autocut/` 下可编辑的 JSON/SRT/OTIO，不改写原始文案与录音。

> 状态：Windows 优先；剪映专业版 11.6 实测可打开加密草稿；MIT License。

## 它做什么

- **文案分段**：LLM 按语义切句段，段号稳定；提供字符数校验，防止改写。
- **素材检索**：本地目录递归索引（ffprobe 读时长/分辨率）；可选 Pexels/Pixabay 在线检索；网页参考素材登记链接与许可。
- **配乐**：可选 Jamendo CC 曲库按叙事段落检索，标注商用/NC；也支持本地 BGM。
- **人工审阅**：生成 `review.html`，勾选素材/配乐后导出 `selections.json`。
- **人声**：faster-whisper 字级时间码；压缩长停顿、保守去喘气、响度统一；无录音时按字数估时并明确标注。
- **时间线**：视频/音频/字幕多轨装配，输出 `timeline.json` + `timeline.otio` + SRT。
- **审片**：FFmpeg 渲染 `preview.mp4`，烧录字幕。
- **交付**：新建剪映加密草稿（不覆盖已有草稿）；或导出 OTIO 进达芬奇/Premiere 等。
- **局部重剪**：换镜头/换配乐/改音效只重跑下游，人工锁定优先。

## 环境要求

| 项 | 要求 |
|---|---|
| DSH | 桌面端 0.2.x（`engines.dsh >=0.2.0-0 <0.3.0`） |
| OS | Windows 10/11（剪映导出依赖 Windows DLL；OTIO 部分跨平台） |
| Node | ≥ 22.12（DSH 自带即可） |
| Python | 3.10–3.12，建议直接用 DSH 运行时 Python |
| FFmpeg | `ffmpeg` + `ffprobe` 真实二进制，配置 `FFMPEG_PATH` / `FFPROBE_PATH` |
| 剪映 | 专业版 11.x；`videoeditor.dll` 用于草稿加密 |
| 密钥 | `DEEPSEEK_API_KEY` 必需（结构化/检索词/规划）；Pexels/Pixabay/Jamendo 可选 |

## 安装

### A. DSH 插件市场

在 DSH 插件市场搜索 **AutoCut**（上架后可用），一键安装。

### B. CLI

使用 DSH 自带的 `dsh`：

```bash
dsh plugin --profile desktop add "github:lolistlisa/dsh-autocut"
```

安装后**完全退出 DSH**（含托盘），再启动。

### C. 本地开发

```bash
dsh plugin --profile desktop add "file:C:/path/to/dsh-autocut"
```

## Python 依赖

装到 **DSH 实际调用的那个 Python**（`PYTHON_PATH`，或 `%USERPROFILE%\.dsh\dsh-runtimes\...\python.exe`）：

```powershell
python -m pip install -r requirements.txt
```

> 关键：剪映 11.x 的草稿是加密的。**PyPI 上的 `pyJianYingDraft` 不支持加密**，必须用 `aoguai` fork。上面的 `requirements.txt` 已指向 fork；手动安装等价于：
>
> ```powershell
> python -m pip install "https://codeload.github.com/aoguai/pyJianYingDraft/zip/refs/heads/main"
> ```
>
> 如果 `pip install git+https://github.com/...` 失败（国内网络常见），用上面的 codeload zip 地址。

验证：

```powershell
python -c "import pyJianYingDraft as d; print([n for n in dir(d) if 'Crypto' in n])"
```

应看到 `JianyingDraftCryptoCodec` 与 `DraftCryptoConfig`。

## 剪映导出准备

```powershell
# 指向包含 videoeditor.dll 的安装目录（可用 JY_INSTALL_DIR 覆盖自动探测）
[Environment]::SetEnvironmentVariable("JY_INSTALL_DIR", "F:\JianyingPro\11.6.0.14552", "User")
```

- 自动探测常见路径（`%LOCALAPPDATA%\JianyingPro\Apps`、`C:\Program Files\JianyingPro`、`F:\JianyingPro` 等）；找不到时用 `JY_INSTALL_DIR`。
- 草稿目录默认 `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft`，可用 `JY_USER_DATA_DIR` 覆盖。
- `autocut_export_jianying` 必须显式传 `draft_dir`；只**新建**草稿，不修改已有草稿。
- 其他剪映版本未验证；11.6.0.14552 已实测能打开。

## 密钥

全部用用户级环境变量，不要写进项目文件：

| 变量 | 用途 | 必需 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 文案结构化、检索词、音效/配乐规划 | 是 |
| `PEXELS_API_KEY` | 在线视频素材 | 否 |
| `PIXABAY_API_KEY` | 在线视频素材 | 否 |
| `JAMENDO_CLIENT_ID` | CC 配乐检索 | 否 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 真实 ffmpeg/ffprobe | 是（渲染/索引） |
| `PYTHON_PATH` | 插件调用的 Python | 建议设置 |

配完重启 DSH（环境变量在进程启动时读取）。

## 快速开始（11 阶段）

```text
autocut_init      → autocut_analyze
autocut_research  → autocut_research_music
autocut_review    → 浏览器勾选 → .autocut/selections.json
autocut_prepare_selections(download=true)
autocut_transcribe → autocut_voice    # 无录音：autocut_estimate_timing
autocut_index → autocut_match
autocut_sound → autocut_timeline
autocut_preview
autocut_export_jianying
```

产物：

```text
<project>/
  .autocut/
    project.json
    script_graph.json
    online_materials.json
    music_candidates.json
    review.html
    selections.json
    voice_edit.json / clean_voice.wav
    asset_catalog.json
    asset_matches.json
    sound_plan.json
    timeline.json / timeline.otio
    preview.mp4
  exports/...
```

## 工具清单（20）

- 项目：`autocut_init` `autocut_analyze` `autocut_status` `autocut_run`
- 检索：`autocut_research` `autocut_research_plan` `autocut_import_research` `autocut_research_music` `autocut_review` `autocut_prepare_selections`
- 声音：`autocut_transcribe` `autocut_estimate_timing` `autocut_voice` `autocut_sound`
- 画面：`autocut_index` `autocut_match` `autocut_timeline` `autocut_override`
- 输出：`autocut_preview` `autocut_export_jianying`

## 已知限制

- **不渲染最终成片**：`preview.mp4` 是审片用；转场、花字样式、精细特效要在剪映/NLE 里完成。
- **剪映导出仅 Windows**：依赖 `videoeditor.dll`；非 11.x 版本可能打不开，生成的是新草稿模板。
- **在线素材需要 Key**：Pexels 可能暂停新 Key 发放；没有 Key 时在线阶段为空，本地链路不受影响。
- **版权责任在用户**：插件只登记链接与许可，不绕过授权；CC-BY 需署名，NC 曲目不能商用。
- **部分效果是元数据/关键帧**：闪避、缩放、强调点需在剪映里复核；不同版本可能丢失。
- **29.97/23.976 等非整数帧率未做 NTSC 处理**，默认按整数帧率。

## 隐私

- 文案/检索词会发送到 DeepSeek API；媒体文件留在本地，除非你明确选择下载在线素材。
- 密钥只从环境变量读取，不写入项目或日志。

## 开发

```powershell
node --check index.js
npm pack --dry-run
```

## License

MIT

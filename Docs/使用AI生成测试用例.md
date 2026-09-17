# 使用 AI 生成 TestBench 测试用例

本文档面向希望借助 AI 创建自定义测试用例的 TestBench 用户。把本文档和一组真实日志一起提供给 AI，AI 就能按照 TestBench 当前支持的格式生成可导入配置。

> AI 生成的规则只能辅助整理日志特征，不能替代真实设备验证。导入后请至少用一组正常日志和一组异常日志检查结果。

## 一、推荐流程

1. 准备测试目标，例如“检测登录接口失败”或“确认 SDK 初始化完成”。
2. 从 TestBench 导出一段同时包含正常和异常场景的日志；敏感信息先脱敏。
3. 把本文档、测试目标、应用包名和样例日志一起提供给 AI。
4. 要求 AI 只返回一个 JSON 对象，不要返回 Markdown 代码围栏或解释文字。
5. 把结果保存为 `.json` 文件，在 TestBench 的“设置与配置 → 通用 → 导入配置”中导入。
6. 新建“测试用例监控”Tab，选择目标应用并分别回放正常、异常场景。

导入采用合并模式，不会清空本地已有配置。作用域和规则完全相同的用例会视为重复项，并保留本地版本。

## 二、可直接交给 AI 的提示词

把下面内容复制给 AI，并在末尾补充你的目标、包名和样例日志：

```text
请根据我提供的测试目标和 Android logcat 样例，为 TestBench 生成可导入的测试用例配置。

要求：
1. 严格遵守随附的《使用 AI 生成 TestBench 测试用例》中的字段、枚举和状态语义。
2. 只能使用样例日志中能够稳定观察到的 Tag、级别和消息特征，不要虚构日志。
3. 优先使用 Tag 精确匹配，再叠加必要的消息条件；不要只使用“失败”“error”等宽泛关键词。
4. 同时分析正常样例和异常样例，尽量排除会导致误报的共同内容。
5. 需要完整成功闭环时使用 pass 规则并设置 requirePass=true；只监控异常时不要设置 requirePass。
6. 只有存在明确起点和合理等待时间时才能使用 absence。
7. 所有 group.children 必须至少包含一个有效条件。
8. 正则表达式按 JavaScript 正则语法编写，并正确进行 JSON 转义。
9. id 使用小写英文、数字和下划线，保证唯一且含义稳定。
10. 最终只输出一个可解析的 JSON 对象，不要输出 Markdown 代码围栏、注释或解释。JSON 顶层格式必须是：
{
  "version": 2,
  "testCases": [生成的测试用例],
  "savedFilters": []
}

在生成前先在内部检查：每条规则应命中哪些样例、不会命中哪些反例、最终状态是什么。如果证据不足，不要猜测；将对应测试用例的 enabled 设为 false，并在 description 中写明需要补充的日志证据。

测试目标：
（填写）

目标应用包名：
（填写；适用于所有应用时写“所有应用”）

正常日志样例：
（粘贴）

异常日志样例：
（粘贴）
```

## 三、导入文件格式

AI 应输出以下顶层结构：

```json
{
  "version": 2,
  "testCases": [],
  "savedFilters": []
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 是 | 当前填写 `2` |
| `testCases` | 是 | 要导入的测试用例数组 |
| `savedFilters` | 是 | 不生成过滤器时保持空数组 |

不要让 AI 输出 TestBench 的完整本机配置，也不要让它修改主题、应用清单、常用搜索或 Tag 等无关设置。

## 四、测试用例结构

```json
{
  "id": "login_request_failed",
  "name": "登录接口异常",
  "description": "登录接口返回失败或请求抛出异常时判定有问题",
  "group": "登录",
  "enabled": true,
  "scope": {
    "global": false,
    "apps": ["com.example.game"]
  },
  "rules": []
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 稳定且唯一，建议使用小写英文、数字和下划线 |
| `name` | 是 | 侧栏显示的简短名称 |
| `description` | 是 | 说明监控目标、判定依据和限制 |
| `group` | 建议 | 功能分组，例如“登录”“网络”“广告”“稳定性” |
| `enabled` | 否 | 默认为 `true`；证据不足时可设为 `false` |
| `scope` | 是 | 用例适用范围 |
| `rules` | 是 | 至少包含一条有效规则 |
| `requirePass` | 否 | 为 `true` 时，所有 `pass` 规则未全部命中会显示“疑似” |

### 作用域

只对指定应用生效：

```json
{
  "global": false,
  "apps": ["com.example.game"]
}
```

对 TestBench 中选择的所有应用生效：

```json
{
  "global": true,
  "apps": [],
  "excludedApps": ["com.example.demo"]
}
```

`global=true` 表示该用例适用于所有应用，不表示读取所有系统进程日志。测试用例监控仍只处理当前所选应用及其历史 PID 的日志。

## 五、规则和条件

一条规则的基本结构：

```json
{
  "effect": "error",
  "description": "登录接口返回失败",
  "expr": {
    "kind": "group",
    "op": "and",
    "children": [
      {
        "kind": "cond",
        "cond": {
          "field": "tag",
          "op": "equals",
          "value": "Unity"
        }
      },
      {
        "kind": "cond",
        "cond": {
          "field": "message",
          "op": "contains",
          "value": "Login failed"
        }
      }
    ]
  }
}
```

### 规则效果

| `effect` | 命中后的状态 | 适用场景 |
|---|---|---|
| `error` | 有问题 | 明确失败、崩溃、数据错误 |
| `warn` | 疑似 | 可能恢复、需要人工确认的风险 |
| `pass` | 通过条件 | 初始化完成、请求成功等正向证据 |

同一个用例只要命中任意 `error` 就显示“有问题”；没有错误但命中 `warn` 时显示“疑似”；存在 `pass` 规则时，所有 `pass` 规则都命中才显示“通过”。纯异常监控用例在没有异常时保持“监控中”，不会自动显示“通过”。

### 条件字段

| `field` | 说明 | 示例 |
|---|---|---|
| `tag` | logcat Tag | `Unity`、`AndroidRuntime` |
| `message` | 日志正文，包含合并后的多行内容和调用栈 | `FATAL EXCEPTION` |
| `level` | 单字母日志级别 | `V`、`D`、`I`、`W`、`E`、`F`、`A` |

### 条件操作符

| `op` | 说明 |
|---|---|
| `contains` | 包含文本 |
| `not_contains` | 不包含文本 |
| `equals` | 完全相等 |
| `not_equals` | 不相等 |
| `regex` | 匹配 JavaScript 正则表达式 |

文本匹配默认不区分大小写。正则同样不区分大小写。JSON 中的反斜杠需要写两次，例如正则 `\bFatal signal\s+\d+` 在 JSON 中应写成 `"\\bFatal signal\\s+\\d+"`。

### AND / OR 条件树

`and` 要求全部子条件成立，`or` 要求任一子条件成立。两者可以嵌套：

```json
{
  "kind": "group",
  "op": "and",
  "children": [
    {
      "kind": "cond",
      "cond": {
        "field": "tag",
        "op": "equals",
        "value": "Unity"
      }
    },
    {
      "kind": "group",
      "op": "or",
      "children": [
        {
          "kind": "cond",
          "cond": {
            "field": "message",
            "op": "contains",
            "value": "request failed"
          }
        },
        {
          "kind": "cond",
          "cond": {
            "field": "message",
            "op": "contains",
            "value": "request exception"
          }
        }
      ]
    }
  ]
}
```

禁止生成空的 `children`。空 `and` 组会错误地匹配每一条日志。

### 出现次数

`minCount` 表示本轮测试累计命中至少 N 次后才触发：

```json
{
  "effect": "warn",
  "description": "接口连续出现多次失败，需要关注",
  "minCount": 3,
  "expr": {
    "kind": "cond",
    "cond": {
      "field": "message",
      "op": "contains",
      "value": "request failed"
    }
  }
}
```

`minCount` 是整次测试的累计次数，不表示连续发生，也没有时间窗口。

### 缺失判定

只有同时具备“明确起点”和“合理等待时间”的流程才使用 `absence`：

```json
{
  "effect": "error",
  "description": "初始化开始后 60 秒内未完成",
  "expr": {
    "kind": "cond",
    "cond": {
      "field": "message",
      "op": "contains",
      "value": "SDK initialization completed"
    }
  },
  "absence": {
    "anchor": {
      "kind": "cond",
      "cond": {
        "field": "message",
        "op": "contains",
        "value": "SDK initialization started"
      }
    },
    "withinSec": 60
  }
}
```

锚点出现后开始计时；时间内出现 `expr` 表示条件得到满足，不触发规则；超时仍未出现才触发该规则。不要同时设置 `absence` 和 `minCount`。

## 六、完整可导入示例

下面的文件会新增一个仅适用于 `com.example.game` 的登录闭环用例：

```json
{
  "version": 2,
  "testCases": [
    {
      "id": "example_login_flow",
      "name": "登录流程",
      "description": "登录开始后应在 30 秒内成功；明确失败日志直接判定有问题",
      "group": "登录",
      "enabled": true,
      "requirePass": true,
      "scope": {
        "global": false,
        "apps": ["com.example.game"]
      },
      "rules": [
        {
          "effect": "error",
          "description": "登录接口明确返回失败",
          "expr": {
            "kind": "group",
            "op": "and",
            "children": [
              {
                "kind": "cond",
                "cond": {
                  "field": "tag",
                  "op": "equals",
                  "value": "Unity"
                }
              },
              {
                "kind": "cond",
                "cond": {
                  "field": "message",
                  "op": "contains",
                  "value": "[Login] request failed"
                }
              }
            ]
          }
        },
        {
          "effect": "error",
          "description": "登录开始后 30 秒内未成功",
          "expr": {
            "kind": "group",
            "op": "and",
            "children": [
              {
                "kind": "cond",
                "cond": {
                  "field": "tag",
                  "op": "equals",
                  "value": "Unity"
                }
              },
              {
                "kind": "cond",
                "cond": {
                  "field": "message",
                  "op": "contains",
                  "value": "[Login] success"
                }
              }
            ]
          },
          "absence": {
            "anchor": {
              "kind": "group",
              "op": "and",
              "children": [
                {
                  "kind": "cond",
                  "cond": {
                    "field": "tag",
                    "op": "equals",
                    "value": "Unity"
                  }
                },
                {
                  "kind": "cond",
                  "cond": {
                    "field": "message",
                    "op": "contains",
                    "value": "[Login] started"
                  }
                }
              ]
            },
            "withinSec": 30
          }
        },
        {
          "effect": "pass",
          "description": "登录成功",
          "expr": {
            "kind": "group",
            "op": "and",
            "children": [
              {
                "kind": "cond",
                "cond": {
                  "field": "tag",
                  "op": "equals",
                  "value": "Unity"
                }
              },
              {
                "kind": "cond",
                "cond": {
                  "field": "message",
                  "op": "contains",
                  "value": "[Login] success"
                }
              }
            ]
          }
        }
      ]
    }
  ],
  "savedFilters": []
}
```

示例中的日志文本和包名仅用于展示格式，不能直接用于真实项目。AI 必须根据用户提供的实际日志替换它们。

## 七、生成后的检查清单

导入前检查：

- 输出是单个合法 JSON 对象，没有代码围栏、注释或尾随逗号。
- 每个用例的 `id` 唯一，名称和描述能说明业务含义。
- 非全局用例至少包含一个真实包名。
- 每个 `rules` 至少有一条规则，每个 `group.children` 至少有一个条件。
- Tag、消息关键字和日志级别都能在真实样例中找到。
- `error` 只对应明确异常，可能恢复的情况使用 `warn`。
- `requirePass=true` 的用例至少有一条 `pass` 规则。
- `absence` 同时具备可靠锚点、目标条件和合理超时时间。
- 正则中的反斜杠已正确进行 JSON 转义。

导入后验证：

- 正常流程不会命中 `error` 或 `warn`。
- 异常流程能命中预期规则，并可从侧栏定位到证据日志。
- 成功闭环的全部 `pass` 信号出现后才显示“通过”。
- 重置测试后旧命中不会影响新一轮测试。
- 切换到不在作用域内的应用时，该用例不会显示。

## 八、当前能力边界

- 规则只能匹配 `message`、`tag` 和 `level`，不能直接匹配 PID、线程或任意 JSON 字段；JSON 内容需要通过消息文本或正则匹配。
- `minCount` 只统计整次测试的累计次数，不支持“最近 N 秒内连续 M 次”。
- 多条 `pass` 规则只证明各成功日志在本轮都出现过，不能自动判断它们是否属于同一个请求 ID 或业务对象。
- 没有稳定起点时，不能严谨判断“整个测试期间从未出现某日志”。
- AI 无法仅凭需求描述知道真实日志格式。缺少正常和异常日志样例时，应先补充证据，不应让 AI 猜测。

更深入的内置用例设计、发布和源码验证流程，请阅读[测试用例维护说明](测试用例维护说明.md)。

/**
 * 发给模型的固定 prompt 文本。这些字符串不走 UI 的 TranslationKey（不展示在界面上），
 * 但会按界面语言切换，避免英文用户切到 en-US 后模型仍收到中文指令。
 */
export type PromptLocale = 'zh-CN' | 'en-US'

export const promptLocale = (locale: string): PromptLocale =>
  locale === 'en-US' ? 'en-US' : 'zh-CN'

export const BASE_SYSTEM_PROMPTS: Record<PromptLocale, string> = {
  'zh-CN': '该助手为DeepSeek，由深度求索公司创造。',
  'en-US': 'You are DeepSeek, created by DeepSeek AI.',
}

export const COMPRESS_PREFIXES: Record<PromptLocale, string> = {
  'zh-CN': '[此前对话摘要（本地生成，仅用于本次请求）]\n',
  'en-US': '[Earlier conversation summary (generated locally, for this request only)]\n',
}

export const COMPRESS_LABELS: Record<PromptLocale, Record<string, string>> = {
  'zh-CN': { user: '用户', assistant: '助手', context: '上下文' },
  'en-US': { user: 'User', assistant: 'Assistant', context: 'Context' },
}

export const TOOL_PROMPTS: Record<
  string,
  Record<PromptLocale, { description: string; expression?: string }>
> = {
  amap_place_search: {
    'zh-CN': {
      description: '高德地图 POI 搜索：按关键词查找地点（餐饮、加油站、景点等），返回名称、地址与坐标。回答位置类问题时应优先调用本工具；结果会自动以静态地图卡片展示给用户。',
    },
    'en-US': {
      description: 'Amap POI search: find places by keyword (restaurants, gas stations, attractions). Prefer this tool for location questions; results are shown to the user as an automatic static map card.',
    },
  },
  amap_geocode: {
    'zh-CN': {
      description: '高德地理编码：把结构化地址转换为经纬度坐标与区划代码。需要坐标或展示位置时使用。',
    },
    'en-US': {
      description: 'Amap geocoding: convert a structured address to coordinates and district code. Use when coordinates or a map display are needed.',
    },
  },
  amap_weather: {
    'zh-CN': {
      description: '高德实时天气：查询指定城市的当前天气（温度、风向、风力）。城市用中文名。',
    },
    'en-US': {
      description: 'Amap live weather: current weather for a city by its Chinese name (temperature, wind).',
    },
  },
  amap_route_planning: {
    'zh-CN': {
      description: '高德路线规划：查询两地之间的驾车或步行路线，返回距离与耗时摘要。地址用中文名；路线会自动以地图卡片展示。',
    },
    'en-US': {
      description: 'Amap route planning: driving or walking route between two places by Chinese address, returning distance and duration. The route is shown to the user as an automatic map card.',
    },
  },
  get_current_time: {
    'zh-CN': {
      description: '获取用户本机的当前日期、时间与时区。回答涉及「今天」「现在」等问题时使用。',
    },
    'en-US': {
      description:
        'Get the user local date, time and timezone. Use when the question mentions today or now.',
    },
  },
  calculate: {
    'zh-CN': {
      description: '计算一个数学表达式，支持 + - * / ^ 与括号。用于需要精确数值的运算。',
      expression: '例如 (12 + 8) * 3 / 4',
    },
    'en-US': {
      description: 'Evaluate a math expression with + - * / ^ and parentheses for exact results.',
      expression: 'e.g. (12 + 8) * 3 / 4',
    },
  },
  get_page_context: {
    'zh-CN': {
      description: '读取当前页面的标题、站点地址与用户选中的文字，用于解释用户正在看的内容。',
    },
    'en-US': {
      description: 'Read the current page title, site address and selected text to explain what the user is viewing.',
    },
  },
}

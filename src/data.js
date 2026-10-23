export const navItems = [
  { route: "home", label: "首页", shortLabel: "首页" },
  { route: "coach", label: "AI 睡前聊天", shortLabel: "陪伴" },
  { route: "recommendation", label: "AI 声音推荐", shortLabel: "声音" },
  { route: "session", label: "Sleep Session", shortLabel: "播放" },
  { route: "feedback", label: "Sleep Feedback", shortLabel: "反馈" },
  { route: "profile", label: "Sleep Profile", shortLabel: "画像" },
  { route: "mixer", label: "声音混音器", shortLabel: "混音" },
  { route: "records", label: "睡眠记录", shortLabel: "记录" },
  { route: "settings", label: "设置", shortLabel: "设置" },
];

export const stateOptions = [
  "很累",
  "有点焦虑",
  "脑子停不下来",
  "工作压力大",
  "情绪不好",
  "身体很累但睡不着",
  "状态很好，只想安静睡觉",
];

export const soundAssets = [
  {
    id: "light-rain",
    name: "雨声",
    category: "自然环境",
    role: "稳定背景层",
  },
  {
    id: "wind",
    name: "风声",
    category: "自然环境",
    role: "空气感与遮蔽",
  },
  {
    id: "brown-noise",
    name: "棕噪声",
    category: "噪声",
    role: "低频稳定层",
  },
  {
    id: "ambient-pad",
    name: "柔和音乐",
    category: "音乐",
    role: "柔和情绪层",
  },
  {
    id: "stream",
    name: "溪流",
    category: "自然环境",
    role: "轻微流动感",
  },
  {
    id: "pink-noise",
    name: "粉红噪声",
    category: "噪声",
    role: "温和遮蔽",
  },
  {
    id: "fireplace",
    name: "壁炉",
    category: "室内环境",
    role: "安全感纹理",
  },
  {
    id: "fan",
    name: "风扇",
    category: "室内环境",
    role: "恒定机械声",
  },
  {
    id: "distant-train",
    name: "远处火车",
    category: "室内环境",
    role: "低变化陪伴",
  },
  {
    id: "ocean",
    name: "海浪",
    category: "自然环境",
    role: "缓慢周期感",
  },
  {
    id: "forest",
    name: "森林",
    category: "自然环境",
    role: "低亮度环境",
  },
];

export const sessionPhases = [
  {
    time: "0-3m",
    title: "Sleep Preparation",
    copy: "AI 语音帮助用户从工作或学习状态切换到休息状态。",
  },
  {
    time: "3-10m",
    title: "Relaxation",
    copy: "逐渐减少 AI 语音，增加稳定环境声音。",
  },
  {
    time: "10-30m",
    title: "Sleep",
    copy: "主要播放稳定环境声音，减少声音变化。",
  },
  {
    time: "30m+",
    title: "Deep Sleep Transition",
    copy: "整体音量逐渐降低，最终停止或保持极低音量。",
  },
];
